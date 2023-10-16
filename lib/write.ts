import { MAX_BIGINT_LEN, MAX_INT_LEN, encodeInto, encodeIntoBN, zigzagEncode, zigzagEncodeBN } from "bijective-varint"
import { mixBit } from "./utils.js"
import { EnumObject, EnumSchema, IntPrimitive, Primitive, Schema, AppSchema, SType, WrappedPrimitive, EnumVariant } from "./schema.js"
import { assert, chooseRootType, enumVariantsInUse, canonicalizeType, intEncoding, isPrimitive, ref } from "./utils.js"
import { extendSchema } from './extendschema.js'
import { metaSchema } from "./metaschema.js"

// import assert from 'assert/strict'
// import {Console} from 'node:console'
// const console = new Console({
//   stdout: process.stdout,
//   stderr: process.stderr,
//   inspectOptions: {depth: null}
// })

interface WriteBuffer {
  buffer: Uint8Array,
  pos: number,
  ids: Map<string, number>
}

const nextPowerOf2 = (v: number): number => {
  v--
  v |= v >> 1
  v |= v >> 2
  v |= v >> 4
  v |= v >> 8
  v |= v >> 16
  return v + 1
}

const ensureCapacity = (b: WriteBuffer, amt: number) => {
  const capNeeded = b.pos + amt
  if (b.buffer.byteLength < capNeeded) {
    // Grow the array.
    let newLen = Math.max(nextPowerOf2(capNeeded), 64)
    const newBuffer = new Uint8Array(newLen)
    newBuffer.set(b.buffer)
    b.buffer = newBuffer
  }
}

const writeVarInt = (w: WriteBuffer, num: number) => {
  ensureCapacity(w, MAX_INT_LEN)
  w.pos += encodeInto(num, w.buffer, w.pos)
}
const writeVarIntBN = (w: WriteBuffer, num: bigint) => {
  ensureCapacity(w, MAX_BIGINT_LEN)
  w.pos += encodeIntoBN(num, w.buffer, w.pos)
}

const encoder = new TextEncoder()

const writeString = (w: WriteBuffer, str: string) => {
  // This allocates, which isn't ideal. Could use encodeInto instead but doing it this way makes the
  // length prefix much easier to place.
  const strBytes = encoder.encode(str)
  ensureCapacity(w, MAX_INT_LEN + strBytes.length)
  w.pos += encodeInto(strBytes.length, w.buffer, w.pos)
  w.buffer.set(strBytes, w.pos)
  w.pos += strBytes.length
}

function checkPrimitiveType(val: any, type: Primitive) {
  // console.log('val', val, 'type', type)
  switch (type) {
    case 'u8': case 'u16': case 'u32': case 'u64': case 'u128':
    case 's8': case 's16': case 's32': case 's64': case 's128':
    case 'f32': case 'f64':
      assert(typeof val === 'number' || typeof val === 'bigint', 'Expected number. Got ' + typeof val);
      break
    case 'bool': assert(typeof val === 'boolean', 'Expected bool. Got ' + typeof val); break
    case 'string': case 'id': assert(typeof val === 'string', 'Expected string. Got ' + typeof val); break
    case 'binary': assert(val instanceof Uint8Array, 'Expected number. Got ' + typeof val); break // TODO: Allow more binary types.
    default: let unused: never = type; throw Error(`Expected primitive type. Got: ${type}`)
  }
}

// Using max+1 because JS numbers (doubles) can accurately store powers of 2.
const maxPlus1Num = {
  u8: 256,
  u16: 2**16,
  u32: 2**32,
  u64: 2**64,
  u128: 2**128,

  s8: 128,
  s16: 2**15,
  s32: 2**31,
  s64: 2**63,
  s128: 2**127,
}

function writeInt(w: WriteBuffer, val: number | bigint, type: IntPrimitive) {
  const encoding = intEncoding(type)
  if (encoding === 'le') {
    if (type.type !== 'u8' && type.type !== 's8') throw Error('NYI: Little endian encoding for numberic ' + type.type)
    w.buffer[w.pos++] = Number(val)
  } else {
    const isSigned = type.type[0] === 's'
    // console.log('writing', val, 'type', typeof val, 'signed', isSigned, 'x', isSigned ? zigzagEncodeBN(BigInt(val)) : val)

    if (val >= maxPlus1Num[type.type]) throw Error(`Number ${val} too big for container size ${type.type}`)
    // The test is < not <= because 2s compliment supports from [-2^n .. 2^n-1]
    if (isSigned && val < -maxPlus1Num[type.type]) throw Error(`Number ${val} too negative for container size ${type.type}`)
    if (!isSigned && val < 0) throw Error(`Negative number ${val} cannot be stored with unsized type ${type.type}`)

    // Writing a varint.
    if (typeof val === 'bigint') {
      writeVarIntBN(w, isSigned ? zigzagEncodeBN(val) : val)
    } else if (typeof val === 'number') {
      writeVarInt(w, isSigned ? zigzagEncode(val) : val)
    } else throw Error('Cannot encode type as a number')
  }
}

/**
 * Each struct is stored in 2 blocks of data:
 *
 * - Bits: All fields which only have 2 states. Eg, booleans, enums with 2 variants. Also, all optional flags.
 * - Bytes: All fields which don't fit in a bit.
 *
 * All the bits are packed together at the start of the struct definition.
 *
 * When we encode, we do it in 2 passes:
 *
 * 1. Scan the struct and encode all bit fields.
 * 2. Scan the struct and encode everything else.
 *
 * Note some fields may not need *any* bits to store them (eg enums with only 1 variant).
 */
function encodeFields(w: WriteBuffer, schema: Schema, val: any, variant: EnumVariant) {
  // console.log('encodeFields', variant, val)
  if (variant.encode) val = variant.encode(val)

  if (typeof val !== 'object' || Array.isArray(val) || val == null) throw Error('Expected struct with fields. Got: ' + JSON.stringify(val))

  // let encodingBits = true

  // Bits are stored in LSB0.
  let bitPattern = 0 // only 8 bits are used, then we flush.
  let nextBit = 0

  const flushBits = () => {
    if (nextBit > 0) { // Flush if there are any bits set.
      // console.log('flushing bits', bitPattern, 'bits:', nextBit)
      ensureCapacity(w, 1)
      w.buffer[w.pos] = bitPattern
      w.pos += 1
      bitPattern = 0
      nextBit = 0
    }
  }

  const writeBit = (b: boolean) => {
    // console.log('writeBit', b)
    if (nextBit >= 8) flushBits()
    bitPattern |= (b ? 1 : 0) << nextBit
    nextBit++
  }

  // First write the bit block.
  const writePass = (writeBit: ((b: boolean) => void) | null, writeThing: ((v: any, type: SType) => void) | null) => {
    if (variant.fields) for (const [k, field] of variant.fields.entries()) {
      if (field.skip) continue

      const fieldName = field.renameFieldTo ?? k
      let v = val[fieldName]

      // External fields always use the raw field name.
      if (field.foreign && v === undefined && val._foreign) v = val._foreign[k]

      // console.log('field', k, 'inline', field.inline, 'encoding', field.type, 'hasValue', v != null, 'value', v)
      if (field.optional) {
        const hasValue = v != null
        writeBit?.(hasValue)
        if (!hasValue) continue
      } else {
        // If the field is missing, fill it in with the default value.
        if (v == null && field.defaultValue != null) {
          v = typeof field.defaultValue === 'function'
            ? field.defaultValue(val)
            : field.defaultValue
        }
        if (v == null) throw Error(`null or missing field '${fieldName}' required by encoding`)
      }

      // TODO: Also write bits for enums with 2 in-use fields!
      if (field.inline) {
        // console.log('write inlined', k)
        if (field.type.type === 'bool') writeBit?.(v)
        else throw Error('Inlining non-boolean fields not supported')
      } else {
        writeThing?.(v, field.type)
      }
    }
  }

  writePass(writeBit, null)
  // console.log('bits', bitPattern, bitsUsed)
  flushBits()
  // console.log(w.buffer, w.pos)
  writePass(null, (v: any, type: SType) => {
    encodeThing(w, schema, v, type, val)
  })
}

// const enumIsEmpty = (obj: EnumObject): boolean => {
//   if (typeof obj === 'string') return true
//   for (const k in obj) {
//     if (k !== 'type') return false
//   }
//   return true
// }

// For now I'm just assuming (requiring) a {type: 'variant', ...} shaped object, or a "variant" with no associated data
function encodeEnum(w: WriteBuffer, schema: Schema, val: EnumObject | any, e: EnumSchema, parent?: any) {
  // const usedVariants = (e.usedVariants ??= enumUsedStates(e))
  const usedVariants = enumVariantsInUse(e)

  // We need to write 2 pieces of data:
  // 1. Which variant we're encoding
  // 2. Any associated data for this variant

  if (e.encode) val = e.encode(val)

  const variantName = e.localStructIsVariant != null ? e.localStructIsVariant
    : typeof val === 'string' ? val
    : e.typeFieldOnParent != null ? parent[e.typeFieldOnParent]
    : val.type === '_foreign' ? val.data.type
    : val.type

  if (typeof variantName != 'string') {
    console.error('When encoding val:', val)
    throw Error('Invalid enum variant name: ' + variantName)
  }

  const associatedData = e.localStructIsVariant != null ? val
    : typeof val === 'string' ? {}
    : val.type === '_foreign' ? val.data
    : val

  const variant = e.variants.get(variantName)
  // console.log('WRITE variant', variantName, variant)
  if (variant == null) throw Error(`Unrecognised enum variant: "${variantName}"`)

  // console.log('encodeEnum', e, variantName, 'fields', variant.fields, 'val', val)

  if (usedVariants.length >= 2) {
    const variantNum = usedVariants.indexOf(variantName)
    if (variantNum < 0) throw Error(`No encoding for ${variantName}`)
    writeVarInt(w, variantNum)
  }

  if (variant.fields) {
    // console.log('Encode associated data')
    encodeFields(w, schema, associatedData, variant)
  }
}

function encodeThing(w: WriteBuffer, schema: Schema, val: any, type: SType, parent?: any) {
  // console.log('encodething', 'pos', w.pos, 'type', type, 'val', val)
  switch (type.type) {
    case 'ref': {
      const innerType = schema.types[type.key]
      if (innerType == null) throw Error(`Schema contains a ref to missing type '${type.key}'`)
      encodeEnum(w, schema, val, innerType, parent)
      return
    }
    case 'list': {
      if (!Array.isArray(val)) throw Error('Cannot encode item as list')
      writeVarInt(w, val.length)
      // TODO: Consider special-casing bit arrays.
      // const fieldType = extendType(type.fieldType)
      for (const v of val) {
        encodeThing(w, schema, v, type.fieldType)
      }
      return
    }
    case 'map': {
      // Maps can also be provided as a list of [k,v] entries.
      const entries = Array.isArray(val) ? val
        : val instanceof Map ? Array.from(val.entries()) // TODO: Remove this allocation.
        : Object.entries(val)
      writeVarInt(w, entries.length)
      const keyType = canonicalizeType(type.keyType)
      const valType = canonicalizeType(type.valType)
      for (let entry of entries) {
        if (type.encodeEntry) entry = type.encodeEntry(entry)
        encodeThing(w, schema, entry[0], keyType)
        encodeThing(w, schema, entry[1], valType)
      }
      return
    }
  }

  // Fall through to processing primitives. (Everything else is a primitive type)
  checkPrimitiveType(val, type.type)

  switch (type.type) {
    case 'bool': {
      ensureCapacity(w, 1)
      w.buffer[w.pos++] = val
      return
    }

    case 'f32': {
      ensureCapacity(w, 4)

      // f32 values are stored natively as 4 byte IEEE floats. It'd be nice
      // to just write directly to the buffer, but unaligned writes aren't
      // supported by Float32Array.
      const dataView = new DataView(w.buffer.buffer, w.buffer.byteOffset + w.pos, 4)
      // Coerce bigint -> number.
      dataView.setFloat32(0, typeof val === 'number' ? val : Number(val), true)
      w.pos += 4
      return
    }
    case 'f64': {
      ensureCapacity(w, 8)

      const dataView = new DataView(w.buffer.buffer, w.buffer.byteOffset + w.pos, 8)
      dataView.setFloat64(0, typeof val === 'number' ? val : Number(val), true)
      w.pos += 8
      return
    }

    case 'u8': case 's8':
    case 'u16': case 'u32': case 'u64': case 'u128':
    case 's16': case 's32': case 's64': case 's128':
      writeInt(w, val, type); return;

    case 'string': {
      writeString(w, val)
      return
    }

    case 'binary': {
      let valBuffer = val as Uint8Array

      ensureCapacity(w, 9 + valBuffer.byteLength)
      w.pos += encodeInto(valBuffer.byteLength, w.buffer, w.pos)
      w.buffer.set(valBuffer, w.pos)
      w.pos += valBuffer.byteLength
      return
    }

    case 'id': {
      // IDs are encoded as either a string or a number, depending on whether we've seen this ID before.
      const existingId = w.ids.get(val)
      if (existingId == null) {
        // Encode it as a string, but with an extra 0 bit mixed into the length.
        // This code is lifted from writeString(). It'd be nice to share this code, but .. that'd be gross too.
        const strBytes = encoder.encode(val)
        ensureCapacity(w, 9 + strBytes.length)
        let n = mixBit(strBytes.length, false)
        w.pos += encodeInto(n, w.buffer, w.pos)
        w.buffer.set(strBytes, w.pos)
        w.pos += strBytes.length

        let id = w.ids.size
        w.ids.set(val, id)
      } else {
        let n = mixBit(existingId, true)
        writeVarInt(w, n)
      }
      return
    }

    default:
      let exhaustiveCheck: never = type
      throw Error('Unknown type: ' + type)
  }
  // Unreachable.
}

const createWriteBuf = (buffer: Uint8Array = new Uint8Array(32), pos: number = 0): WriteBuffer => ({
  buffer, pos, ids: new Map([['Default', 0]])
})

const consumeWriteBuf = (writer: WriteBuffer): Uint8Array => writer.buffer.slice(0, writer.pos)

export function writeRawInto(schema: Schema, data: any, buffer: Uint8Array | undefined, pos: number = 0, ofType?: string | SType): Uint8Array {
  const writer = createWriteBuf(buffer, pos)

  encodeThing(writer, schema, data, chooseRootType(schema, ofType))

  return consumeWriteBuf(writer)
}

export function writeRaw(schema: Schema, data: any, ofType?: string | SType): Uint8Array {
  return writeRawInto(schema, data, undefined, 0, ofType)
}

/**
 * Write the given data into the given bufffer. Note the returned buffer may differ
 * (due to running out of space). So make sure you use the returned Uint8Array!!
 */
export function writeInto(schema: Schema, data: any, buffer: Uint8Array | undefined, pos: number = 0, ofType?: string | SType): Uint8Array {
  const writer = createWriteBuf(buffer, pos)
  const magicBytes = encoder.encode("SB11")
  writer.buffer.set(magicBytes, writer.pos)
  writer.pos += 4

  // console.log(schema)
  encodeThing(writer, metaSchema, schema, metaSchema.root!)
  writer.ids.clear()
  encodeThing(writer, schema, data, chooseRootType(schema, ofType))

  return consumeWriteBuf(writer)
}

export function write(schema: Schema, data: any, ofType?: string | SType): Uint8Array {
  return writeInto(schema, data, undefined, 0, ofType)
}

export function writeAppSchema(schema: AppSchema, data: any): Uint8Array {
  return write(extendSchema(schema), data)
}

// Is it worth having this method at all?
export function writeLocalSchema(schema: Schema, buffer?: Uint8Array, pos?: number): Uint8Array {
  return writeRawInto(metaSchema, schema, buffer, pos)
}
