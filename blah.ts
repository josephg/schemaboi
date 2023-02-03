// import fs from 'fs'
import assert from 'assert/strict'
import {varintEncode, varintEncodeInto, zigzagEncode} from './varint.js'
import fs from 'fs'

type Primitive = 'uint' | 'sint' | 'f32' | 'f64' | 'bool'

type SType = 'string' | 'binary' | Primitive
  | {type: 'list', fieldType: SType}
  | {type: 'ref', key: string} // Reference to another type in the type oracle.
  | Struct
  | Enum
  | Map


// type OnMissing = 'default' | 'elide'

interface Field {
  key: string
  valType: SType,
  default?: any,

  /**
   * If true, any time this field is missing from the object being encoded, we encode the field's default value instead.
   *
   * This has no effect when there's no default value for the field.
  */
  encodeMissingAsDefault?: boolean
  // onMissing: OnMissing,
}

interface Struct {
  type: 'struct'
  fields: Field[]
  encodeOptional: 'bitfield' | 'none'
}


interface EnumVariant {
  key: string
  associatedData?: Struct | {type: 'ref', key: string}
}

interface Enum {
  type: 'enum'
  variants: EnumVariant[]
}

interface Map {
  type: 'map',
  keyType: Primitive | 'string' | 'binary',
  valType: SType
}

interface Schema {
  id: string,
  root: SType
  types: Record<string, Struct | Enum>
}


const enumOfStrings = (strings: string[]): Enum => ({
  type: 'enum',
  variants: strings.map(s => ({key: s}))
})

const ref = (key: string): {type: 'ref', key: string} => ({type: 'ref', key})
const metaSchema: Schema = {
  id: '_sbmeta',
  root: ref('Schema'),

  types: {
    Schema: {
      type: 'struct',
      encodeOptional: 'bitfield',
      fields: [
        {key: 'id', valType: 'string'},
        {key: 'root', valType: ref('SType')},
        {key: 'types', valType: {
          type: 'map',
          keyType: 'string',
          valType: ref('SType')}
        },
      ]
    },

    Ref: {
      type: 'struct',
      encodeOptional: 'bitfield',
      fields: [
        {key: 'key', valType: 'string'},
      ]
    },

    EnumVariant: {
      type: 'struct',
      encodeOptional: 'bitfield',
      fields: [
        {key: 'key', valType: 'string'},
        {key: 'associatedData', valType: {
          type: 'enum',
          variants: [
            {key: 'struct', associatedData: ref('Struct')},
            {key: 'ref', associatedData: {
              type: 'struct',
              encodeOptional: 'bitfield',
              fields: [
                {key: 'key', valType: 'string'},
              ]
            }},
          ]
        }}
      ]
    },

    Enum: {
      type: 'struct',
      encodeOptional: 'bitfield',
      fields: [
        // {key: 'type', valType: enumOfStrings(['enum'])},
        {key: 'variants', valType: {type: 'list', fieldType: ref('EnumVariant')}}
      ]
    },

    Struct: {
      type: 'struct',
      encodeOptional: 'bitfield',
      fields: [
        {key: 'fields', valType: {type: 'list', fieldType: ref('Field')}},
        {key: 'encodeOptional', valType: enumOfStrings(['bitfield', 'none'])}
      ]
    },

    Field: {
      type: 'struct',
      encodeOptional: 'bitfield',
      fields: [
        {key: 'key', valType: 'string'},
        {key: 'valType', valType: ref('SType')},
        //  TODO: Default!
        {key: 'encodeMissingAsDefault', valType: 'bool'},
      ]
    },

    Map: {
      type: 'struct',
      encodeOptional: 'bitfield',
      fields: [
        {key: 'keyType', valType: enumOfStrings(['uint', 'sint', 'f32', 'f64', 'bool', 'string', 'binary'])},
        {key: 'valType', valType: ref('SType')}
      ]
    },

    SType: {
      type: 'enum',
      variants: [
        {key: 'uint'},
        {key: 'sint'},
        {key: 'f32'},
        {key: 'f64'},
        {key: 'bool'},
        {key: 'string'},
        {key: 'binary'},
        {key: 'list', associatedData: {
          type: 'struct',
          encodeOptional: 'bitfield',
          fields: [
            {key: 'fieldType', valType: ref('SType')} // Recursive.
          ]
        }},

        {key: 'ref', associatedData: {
          type: 'struct',
          encodeOptional: 'bitfield',
          fields: [{key: 'key', valType: 'string'}]
        }},
        {key: 'struct', associatedData: ref('Struct')},
        {key: 'enum', associatedData: ref('Enum')},
        {key: 'map', associatedData: ref('Map')},
      ]
    }
  }
}



// Example

let shape: Schema = {
  id: 'example1',
  root: {type: 'ref', key: 'shape'},
  types: {
    shape: {
      type: 'struct',
      encodeOptional: 'bitfield',
      fields: [
        {key: 'x', valType: 'f32'},
        {key: 'y', valType: 'f32'},
        {key: 'rotation', valType: 'f32'},
        {key: 'id', valType: 'string'},
        // {key: 'props', valType: {
        //   fields: [
        //     {key: 'opacity', valType: 'f32', onMissing: 'default'}
        //   ]
        // }},
      ]
    }
  }
}


let s = {
  x: -97.07478097603735,
  y: 130.0011364384228,
  rotation: 0,
  id: 'shape:3U34c1TI2esoFOO2OlNnO',
  index: 'b0M',
  type: 'text',
  props: {
    opacity: '1',
    color: 'black',
    size: 'xl',
    w: 358,
    text: '{\n' +
      '  position: {\n' +
      '    x: 100,\n' +
      '    y: 100,\n' +
      '  },\n' +
      '  size: {\n' +
      '    w: 50,\n' +
      '    h: 50,\n' +
      '  },\n' +
      '}',
    font: 'draw',
    align: 'start',
    autoSize: true
  },
  typeName: 'shape',
  parentId: 'page:Asc2ckmOb_rT-eRbpd4Ni'
}

interface WriteBuffer {
  buffer: Uint8Array,
  pos: number,
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

// const assert = (a: boolean, msg?: string) => {
//   if (!a) {
//     throw Error(msg ?? 'Assertion failed')
//   }
// }

function findEnumVariant(val: string | Record<string, any>, type: Enum): number {
  for (let i = 0; i < type.variants.length; i++) {
    const variant = type.variants[i]

    // So the val can either be a string (with the key of the variant)
    // or its an object with a 'type:' field matching one of the variant arms.
    if (typeof val === 'string') {
      if (val === variant.key) return i
    } else if (typeof val === 'object' && val != null && val.type === variant.key) {
      // We might need to check inner fields...
      return i
    }
  }

  console.error('Value:', val)
  throw Error('Variant missing in schema')
}

const checkType = (val: any, type: SType | Struct | Enum) => {
  if (typeof type === 'object' && type != null) {
    if (type.type === 'ref') throw Error('References not checked in checkType')

    if (type.type === 'struct') {
      assert(typeof val === 'object' && val != null && !Array.isArray(val))
    } else if (type.type === 'list') {
      assert(Array.isArray(val))
    } else if (type.type === 'enum') {
      findEnumVariant(val, type)
    } else if (type.type === 'map') {
      assert(type.keyType === 'string', 'Non-string keys in maps not implemented yet')
      // TODO: Or should we allow empty maps represented as null?
      assert(typeof val === 'object' && val != null && !Array.isArray(val))
    } else {
      console.error(type)
      throw Error('nyi')
    }
  } else {
    // console.log('val', val, 'type', type)
    switch (type) {
      case 'uint': case 'sint': case 'f32': case 'f64':
        assert(typeof val === 'number'); break
      case 'bool': assert(typeof val === 'boolean'); break
      case 'string': assert(typeof val === 'string'); break
      default: throw Error(`case missing in checkType: ${type}`)
    }
  }
}

const toBinary = (schema: Schema, data: any): Uint8Array => {
  let w: WriteBuffer = {
    buffer: new Uint8Array(32),
    pos: 0
  }

  encodeInto(w, metaSchema.types, metaSchema.root, schema)
  encodeInto(w, schema.types, schema.root, data)

  return w.buffer.slice(0, w.pos)
}

function encodeInto(w: WriteBuffer, oracle: Record<string, Struct | Enum>, type: SType | Struct | Enum, val: any) {
  while (typeof type === 'object' && type != null && type.type === 'ref') {
    const actualType = oracle[type.key]
    // console.log(type)
    if (actualType == null) throw Error('Missing type: ' + type.key)

    type = actualType
  }

  checkType(val, type)

  if (typeof type === 'object') {
    if (type.type === 'struct') {
      if (type.encodeOptional !== 'bitfield') throw Error('NYI')

      // First we need to find and encode the optional data bits
      if (type.fields.length >= 53) throw Error('Cannot encode more than 52 fields due to javascript badness')
      let optionalBits = 0

      for (const field of type.fields) {
        const hasDefault = field.default !== undefined
        if (field.encodeMissingAsDefault != null && hasDefault) throw Error('Cannot set encodeMissingAsDefault when field has no default')

        if (hasDefault) {
          field.encodeMissingAsDefault ??= (
            field.valType === 'bool'
            || field.valType === 'uint'
            || field.valType === 'sint'
            || field.valType === 'string'
            || field.valType === 'binary')

          if (field.encodeMissingAsDefault) continue
        }

        let hasField = val[field.key] !== undefined
        // console.log('opt', field.key, hasField)
        optionalBits = (optionalBits * 2) + (+hasField)

        // console.log('optional bits', optionalBits)
      }

      // Ok on to writing it.
      writeVarInt(w, optionalBits)

      for (const field of type.fields) {
        let v = val[field.key]

        if (v === undefined) {
          if (field.encodeMissingAsDefault) {
            v = field.default
          } else {
            continue
          }
        }

        // Recurse.
        encodeInto(w, oracle, field.valType, v)
      }
    } else if (type.type === 'list') {
      // Length prefixed list of entries.
      // TODO: Consider special-casing bit arrays.
      writeVarInt(w, val.length)
      for (const v of val) {
        encodeInto(w, oracle, type.fieldType, v)
      }
    } else if (type.type === 'enum') {
      const variantNum = findEnumVariant(val, type)
      writeVarInt(w, variantNum)

      let variant = type.variants[variantNum]
      if (variant.associatedData != null) {
        let v = typeof val === 'string' ? {} : val
        encodeInto(w, oracle, variant.associatedData, v)
      }
    } else if (type.type === 'map') {
      // Maps are encoded as a list of (key, value) pairs.
      const entries = Object.entries(val)
      writeVarInt(w, entries.length)
      assert(type.keyType === 'string', 'NYI')
      for (const [k, v] of entries) {
        encodeInto(w, oracle, type.keyType, k)
        encodeInto(w, oracle, type.valType, v)
      }
    } else throw Error('invalid or unknown data type')
  } else {
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

        // let fArr = new Float32Array(w.buffer.buffer, w.buffer.byteOffset + w.pos, 1)
        // fArr[0] = val
        w.pos += 4
        break
      }
      case 'f64': {
        ensureCapacity(w, 8)

        const dataView = new DataView(w.buffer.buffer, w.buffer.byteOffset + w.pos, 8)
        dataView.setFloat64(0, val, true)

        // f32 values are stored natively as 8 byte IEEE floats.
        // let fArr = new Float64Array(w.buffer.buffer, w.buffer.byteOffset + w.pos, 1)
        // fArr[0] = val
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

      default:
        throw Error('nyi')
    }
  }
}

{
  const testSchema: Schema = {
    id: 'example2',
    root: {type: 'ref', key: 'obj'},
    types: {
      obj: {
        type: 'struct',
        encodeOptional: 'bitfield',
        fields: [
          {key: 'x', valType: 'f32'},
          {key: 'id', valType: 'string', default: ''},
          {key: 'child', valType: {type: 'ref', key: 'child'}},
          {key: 'listy', valType: {
            type: 'list',
            fieldType: 'string',
          }},
          {key: 'enum', valType: {type: 'ref', key: 'enum'}},
        ]
      },

      child: {
        type: 'struct',
        encodeOptional: 'bitfield',
        fields: [
          {key: 'a', valType: 'sint', default: -1}
        ]
      },

      enum: {
        type: 'enum',
        variants: [
          {key: 'Red'},
          {key: 'Green'},
          {key: 'Blue'},
          {key: 'Square', associatedData: {
            type: 'struct',
            encodeOptional: 'bitfield',
            fields: [
              {key: 'side', valType: 'f32'}
            ]
          }},
        ]
      }
    }
  }

  let out = toBinary(testSchema, {
    x: 12.32,
    id: 'oh hai',
    child: {a: -10},
    listy: ['hi', 'yo'],
    // enum: 'Red',
    enum: {type: 'Square', side: 2.3}
  })

  console.log(out)

  fs.writeFileSync('out.scb', out)

  // console.log(testShape)
}


{
  let out = toBinary(metaSchema, metaSchema)
  console.log('meta', out)

  fs.writeFileSync('metaschema.scb', out)
}

{

}