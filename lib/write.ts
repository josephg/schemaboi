import { mixBit, varintEncodeInto, zigzagEncode } from "./varint.js"
import { EnumObject, EnumSchema, Primitive, Schema, SimpleSchema, StructField, StructSchema, SType } from "./schema.js"
import { any, countIter, countMatching, extendSchema, filterIter, firstIndexOf, hasAssociatedData, hasOptionalFields, mapIter, ref } from "./utils.js"

import assert from 'assert/strict'
import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

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
  ensureCapacity(w, 9)
  w.pos += varintEncodeInto(num, w.buffer, w.pos)
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
    case 'uint': case 'sint': case 'f32': case 'f64':
      assert(typeof val === 'number'); break
    case 'bool': assert(typeof val === 'boolean'); break
    case 'string': case 'id': assert(typeof val === 'string'); break
    default: throw Error(`case missing in checkType: ${type}`)
  }
}

function encodePrimitive(w: WriteBuffer, val: any, type: Primitive) {
  checkPrimitiveType(val, type)

  switch (type) {
    case 'bool': {
      ensureCapacity(w, 1)
      w.buffer[w.pos] = val
      w.pos += 1
      break
    }

    case 'f32': {
      ensureCapacity(w, 4)

      // f32 values are stored natively as 4 byte IEEE floats. It'd be nice
      // to just write directly to the buffer, but unaligned writes aren't
      // supported by Float32Array.
      const dataView = new DataView(w.buffer.buffer, w.buffer.byteOffset + w.pos, 4)
      dataView.setFloat32(0, val, true)
      w.pos += 4
      break
    }
    case 'f64': {
      ensureCapacity(w, 8)

      const dataView = new DataView(w.buffer.buffer, w.buffer.byteOffset + w.pos, 8)
      dataView.setFloat64(0, val, true)
      w.pos += 8
      break
    }

    case 'sint': val = zigzagEncode(val) // And flow down.
    case 'uint': {
      writeVarInt(w, val)
      break
    }

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

const tryGetEnum = (t: SType, schema: Schema): EnumSchema | null => {
  if (typeof t !== 'object' || t.type !== 'ref') return null
  const inner = schema.types[t.key]
  return inner.type === 'enum' ? inner : null
}

const enumUsedStates = (e: EnumSchema): number => (
  // Probably better done in 1 pass.
  countMatching(e.variants.values(), v => !v.unused)
)

/**
 * There's a few ways we can encode data, and we need to decide at this point how we'll do it.
 *
 * Essentially we have up to 2 pieces of data for each field:
 *
 * - Is the field *present*?
 * - Whats the field's value?
 *
 * For efficiency, structs are encoded in two parts: A bit block, and a value block. The bit block
 * stores packed bits for small fields and optional encoding information. Basically, everything that needs
 * 2 bits or less to store. The value block stores everything else.
 *
 * We need to decide how this data will be stored. We can count the number of different states at play. If there is:
 *
 * - 1 state, we don't need to store anything to know the state of the field. Eg, if a numeric enum only has 1 variant.
 * - 2 states, we'll use a single bit. Eg, an optional enum with 1 variant, or a required boolean
 * - up to 4 states: We can use 2 bits in the bit block
 * - More states than that, store the field in the value block.
 *
 * This method essentially returns 3 bits:
 *
 * - Are we storing whether this field is optional?
 * - Are we storing the field's value in the bit block?
 * - Are we storing the field's value in the value block?
 *
 * Note for enums, we always store associated data in the value block regardless
 *
 * 0b000: 1 state, nothing needs to be stored.
 * 0b001: Required field, stored in the value block. Eg required string
 * 0b010: Required field with 2 states, stored in optional block (eg bool)
 * 0b011: Enum with 2 states
 * 0b100: Optional field, but if present it only has 1 valid state anyway.
 * 0b101: Optional field with multi-bit data. Eg, optional string
 * 0b110: Optional field stored in bit block. Eg, optional enum with 2 states.
 * 0b111: Optional enum with 2 states
 */
// const encodingStrategy = (f: StructField, schema: Schema): number => {
//   if (f.encoding === 'unused') return 0b000

//   if (f.type === 'bool') return f.encoding === 'required' ? 0b010 : 0b110

//   const e = tryGetEnum(f.type, schema)
//   if (e) {
//     // const hasData = !e.numericOnly && any(e.variants.values(), v => hasAssociatedData(v.associatedData))
//     const states = filterIter(e.variants.values(), v => !v.unused)
//   }

//   return f.encoding === 'required' ? 0b001 : 0b101
// }


// const enum Foo {
//   StoreOptional = 4,
//   StoreValueInBits = 2,
//   StoreValueInValueBlock = 1,
// }

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
      if (field.encoding === 'unused') continue

      const fieldName = field.renameFieldTo ?? k
      let v = val[fieldName]

      // console.log('field', k, 'inline', field.inline, 'encoding', field.encoding, 'hasValue', v != null, 'value', v)
      if (field.encoding === 'optional') {
        const hasValue = v != null
        writeBit?.(hasValue)
        if (!hasValue) continue
      } else {
        // If the field is missing, fill it in with the default value.
        v ??= field.defaultValue
        if (v == null) throw Error(`null or missing field '${fieldName}' required by encoding`)
      }

      // TODO: Also write bits for enums with 2 in-use fields!
      if (field.inline) {
        // console.log('write inlined', k)
        if (field.type === 'bool') writeBit?.(v)
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
  const usedVariants = [...
    mapIter(
      filterIter(e.variants.entries(), ([_k, v]) => !v.unused),
      ([k]) => k)
  ]

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
  if (typeof type === 'object') { // Animal, mineral or vegetable...
    switch (type.type) {
      case 'ref': {
        const innerType = schema.types[type.key]
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
          encodePrimitive(w, k, type.keyType)
          encodeThing(w, schema, v, type.valType)
        }
        break
      }
      default:
        const exhaustiveCheck: never = type;
        throw new Error('unhandled case');
    }
  } else {
    encodePrimitive(w, val, type)
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


const simpleTest = () => {
  const schema: Schema = {
    id: 'Example',
    root: ref('Contact'),
    types: {
      Contact: {
        type: 'struct',
        fields: new Map([
          ['name', {type: 'string', encoding: 'optional'}],
          ['age', {type: 'uint', encoding: 'required'}]
          // address: {type: 'string'},
        ])
      }
    }
  }

  const data = {name: 'seph', age: 21}

  console.log(toBinary(schema, data))
}



const kitchenSinkTest = () => {
  const schema: SimpleSchema = {
    id: 'Example',
    root: ref('Contact'),
    types: {
      Contact: {
        type: 'struct',
        fields: {
          name: {type: 'string'},
          age: {type: 'uint'},
          addresses: {type: {type: 'list', fieldType: 'string'}},
          // address: {type: 'string'},
          favoriteColor: {type: {type: 'ref', key: 'Color'}},
          worstColor: {type: {type: 'ref', key: 'Color'}},
          hairColor: {type: {type: 'ref', key: 'Color'}},
        }
      },

      Color: {
        type: 'enum',
        numericOnly: false,
        variants: {
          Blue: {},
          Red: {},
          RGB: {
            associatedData: {
              type: 'struct',
              fields: {
                r: {type: 'uint'},
                g: {type: 'uint'},
                b: {type: 'uint'},
              }
            }
          }
        }
      }
    }
  }

  const data = {
    name: 'seph',
    age: 21,
    addresses: ['123 Example St', '456 Somewhere else'],
    favoriteColor: 'Red',
    hairColor: {type: 'Blue'},
    worstColor: {type: 'RGB', r: 10, g: 50, b: 100},
  }

  console.log('schema', extendSchema(schema))
  console.log(toBinary(extendSchema(schema), data))
}

// simpleTest()
// kitchenSinkTest()

