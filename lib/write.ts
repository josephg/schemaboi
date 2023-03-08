import { MAX_BIGINT_LEN, MAX_INT_LEN, mixBit, varintEncodeInto, varintEncodeIntoBN, zigzagEncode, zigzagEncodeBN } from "./varint.js"
import { EnumObject, EnumSchema, IntPrimitive, Primitive, Schema, AppSchema, StructSchema, SType, WrappedPrimitive } from "./schema.js"
import { assert, enumVariantsInUse, extendSchema, intEncoding, isPrimitive, ref } from "./utils.js"

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
  w.pos += varintEncodeInto(num, w.buffer, w.pos)
}
const writeVarIntBN = (w: WriteBuffer, num: bigint) => {
  ensureCapacity(w, MAX_BIGINT_LEN)
  w.pos += varintEncodeIntoBN(num, w.buffer, w.pos)
}

const encoder = new TextEncoder()

const writeString = (w: WriteBuffer, str: string) => {
  // This allocates, which isn't ideal. Could use encodeInto instead but doing it this way makes the
  // length prefix much easier to place.
  const strBytes = encoder.encode(str)
  ensureCapacity(w, 9 + strBytes.length)
  w.pos += varintEncodeInto(strBytes.length, w.buffer, w.pos)
  w.buffer.set(strBytes, w.pos)
  w.pos += strBytes.length
}

function checkPrimitiveType(val: any, type: Primitive) {
  // console.log('val', val, 'type', type)
  switch (type) {
    case 'u8': case 'u16': case 'u32': case 'u64': case 'u128':
    case 's8': case 's16': case 's32': case 's64': case 's128':
      case 'f32': case 'f64':
      assert(typeof val === 'number' || typeof val === 'bigint'); break
    case 'bool': assert(typeof val === 'boolean'); break
    case 'string': case 'id': assert(typeof val === 'string'); break
    case 'binary': assert(val instanceof Uint8Array); break // TODO: Allow more binary types.
    default: let unused: never = type; throw Error(`case missing in checkType: ${type}`)
  }
}

function writeInt(w: WriteBuffer, val: number | bigint, type: IntPrimitive) {
  const encoding = intEncoding(type)
  if (encoding === 'le') {
    if (type.type !== 'u8' && type.type !== 's8') throw Error('NYI: Little endian encoding for numberic ' + type.type)
    w.buffer[w.pos++] = Number(val)
  } else {
    const isSigned = type.type[0] === 's'
    // console.log('writing', val, 'type', typeof val, 'signed', isSigned, 'x', isSigned ? zigzagEncodeBN(BigInt(val)) : val)

    // Writing a varint.
    if (typeof val === 'bigint') {
      writeVarIntBN(w, isSigned ? zigzagEncodeBN(val) : val)
    } else if (typeof val === 'number') {
      writeVarInt(w, isSigned ? zigzagEncode(val) : val)
    } else throw Error('Cannot encode type as a number')
  }
}

function encodePrimitive(w: WriteBuffer, val: any, type: WrappedPrimitive | IntPrimitive) {
  checkPrimitiveType(val, type.type)

  switch (type.type) {
    case 'bool': {
      ensureCapacity(w, 1)
      w.buffer[w.pos++] = val
      break
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
      break
    }
    case 'f64': {
      ensureCapacity(w, 8)

      const dataView = new DataView(w.buffer.buffer, w.buffer.byteOffset + w.pos, 8)
      dataView.setFloat64(0, typeof val === 'number' ? val : Number(val), true)
      w.pos += 8
      break
    }

    case 'u8': case 's8':
    case 'u16': case 'u32': case 'u64': case 'u128':
    case 's16': case 's32': case 's64': case 's128':
      writeInt(w, val, type); break;

    case 'string': {
      writeString(w, val)
      break
    }

    case 'binary': {
      let valBuffer = val as Uint8Array

      ensureCapacity(w, 9 + valBuffer.byteLength)
      w.pos += varintEncodeInto(valBuffer.byteLength, w.buffer, w.pos)
      w.buffer.set(valBuffer, w.pos)
      w.pos += valBuffer.byteLength
      break
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
        w.pos += varintEncodeInto(n, w.buffer, w.pos)
        w.buffer.set(strBytes, w.pos)
        w.pos += strBytes.length

        let id = w.ids.size
        w.ids.set(val, id)
      } else {
        let n = mixBit(existingId, true)
        writeVarInt(w, n)
      }
      break
    }

    default:
      let exhaustiveCheck: never = type
      throw Error('nyi type: ' + type)
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
function encodeStruct(w: WriteBuffer, schema: Schema, val: any, struct: StructSchema) {
  if (struct.encode) val = struct.encode(val)

  if (typeof val !== 'object' || Array.isArray(val) || val == null) throw Error('Invalid struct')

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
    for (const [k, field] of struct.fields.entries()) {
      if (field.skip) continue

      const fieldName = field.renameFieldTo ?? k
      let v = val[fieldName]

      // External fields always use the raw field name.
      if (field.foreign && v === undefined && val._foreign) v = val._foreign[k]

      // console.log('field', k, 'inline', field.inline, 'encoding', field.encoding, 'hasValue', v != null, 'value', v)
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
function encodeEnum(w: WriteBuffer, schema: Schema, val: EnumObject, e: EnumSchema, parent?: any) {
  // const usedVariants = (e.usedVariants ??= enumUsedStates(e))
  const usedVariants = enumVariantsInUse(e)

  // We need to write 2 pieces of data:
  // 1. Which variant we're encoding
  // 2. Any associated data for this variant

  const variantName = typeof val === 'string' ? val
    : e.typeFieldOnParent != null ? parent[e.typeFieldOnParent]
    : val.type === '_unknown' ? val.data.type
    : val.type

  const associatedData = typeof val === 'string' ? {}
    : val.type === '_unknown' ? val.data
    : val

  const variant = e.variants.get(variantName)
  // console.log('WRITE variant', variantName, variant)
  if (variant == null) throw Error(`Unrecognised enum variant: "${variantName}"`)

  if (usedVariants.length >= 2) {
    const variantNum = usedVariants.indexOf(variantName)
    if (variantNum < 0) throw Error(`No encoding for ${variantName}`)
    writeVarInt(w, variantNum)
  }

  if (variant.associatedData) {
    // console.log('Encode associated data')
    encodeStruct(w, schema, associatedData, variant.associatedData)
  }
}

function encodeThing(w: WriteBuffer, schema: Schema, val: any, type: SType, parent?: any) {
  switch (type.type) {
    case 'ref': {
      const innerType = schema.types[type.key]
      if (innerType == null) throw Error(`Schema contains a ref to missing type '${type.key}'`)
      switch (innerType.type) {
        case 'struct':
          // console.log('encode ref', type.key)
          encodeStruct(w, schema, val, innerType)
          break
        case 'enum':
          encodeEnum(w, schema, val, innerType, parent)
          break
        default:
          const exhaustiveCheck: never = innerType
      }

      break
    }
    case 'list': {
      if (!Array.isArray(val)) throw Error('Cannot encode item as list')
      writeVarInt(w, val.length)
      // TODO: Consider special-casing bit arrays.
      for (const v of val) {
        encodeThing(w, schema, v, type.fieldType)
      }
      break
    }
    case 'map': {
      // Maps can also be provided as a list of [k,v] entries.
      const entries = Array.isArray(val) ? val
        : val instanceof Map ? Array.from(val.entries()) // TODO: Remove this allocation.
        : Object.entries(val)
      writeVarInt(w, entries.length)
      for (const [k, v] of entries) {
        encodeThing(w, schema, k, type.keyType)
        encodeThing(w, schema, v, type.valType)
      }
      break
    }
    default:
      if (!isPrimitive(type.type)) throw Error(`Unknown type '${type.type}' while encoding`)
      encodePrimitive(w, val, type)
      break
  }
}

export function toBinary(schema: Schema, data: any): Uint8Array {
  const writer: WriteBuffer = {
    buffer: new Uint8Array(32),
    pos: 0,
    ids: new Map()
  }

  encodeThing(writer, schema, data, schema.root)

  return writer.buffer.slice(0, writer.pos)
}
