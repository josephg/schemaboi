// import fs from 'fs'
import assert from 'assert/strict'
import {mixBit, varintEncodeInto, zigzagEncode} from './varint.js'
import fs from 'fs'
import { Schema, ref, enumOfStrings, Enum, Struct, metaSchema, SType } from './schema.js'

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

// const assert = (a: boolean, msg?: string) => {
//   if (!a) {
//     throw Error(msg ?? 'Assertion failed')
//   }
// }

function findEnumVariant(val: string | Record<string, any>, type: Enum, parent?: any): number {
  for (let i = 0; i < type.variants.length; i++) {
    const variant = type.variants[i]

    // So the val can either be a string (with the key of the variant)
    // or its an object with a 'type:' field matching one of the variant arms.
    if (typeof val === 'string') {
      if (val === variant.key) return i
    } else if (typeof val === 'object' && val != null && (type.typeOnParent ? parent : val).type === variant.key) {
      // We might need to check inner fields...
      return i
    }
  }

  console.error('Value:', val)
  throw Error('Variant missing in schema')
}

const checkType = (val: any, type: SType | Struct | Enum, parent?: any) => {
  if (typeof type === 'object' && type != null) {
    if (type.type === 'ref') throw Error('References not checked in checkType')

    if (type.type === 'struct') {
      assert(typeof val === 'object' && val != null && !Array.isArray(val))
    } else if (type.type === 'list') {
      assert(Array.isArray(val))
    } else if (type.type === 'enum') {
      findEnumVariant(val, type, parent)
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
      case 'string': case 'id': assert(typeof val === 'string'); break
      default: throw Error(`case missing in checkType: ${type}`)
    }
  }
}

const toBinary = (schema: Schema, data: any): Uint8Array => {
  let w: WriteBuffer = {
    buffer: new Uint8Array(32),
    pos: 0,
    ids: new Map()
  }

  encodeInto(w, metaSchema.types, metaSchema.root, schema)
  console.log('schema', schema.id, 'size', w.pos)
  const schemaPos = w.pos
  encodeInto(w, schema.types, schema.root, data)
  console.log('data size', w.pos - schemaPos)
  console.log('total size', w.pos)

  return w.buffer.slice(0, w.pos)
}

function encodeInto(w: WriteBuffer, oracle: Record<string, Struct | Enum>, type: SType | Struct | Enum, val: any, parent?: any) {
  while (typeof type === 'object' && type != null && type.type === 'ref') {
    const actualType = oracle[type.key]
    // console.log(type)
    if (actualType == null) throw Error('Missing type: ' + type.key)

    type = actualType
  }

  checkType(val, type, parent)

  if (typeof type === 'object') {
    if (type.type === 'struct') {
      if (type.encodeOptional === 'bitfield') {
        // EncodeOptional=bitfield encodes the set of fields each object has in a bitfield at the start of the struct definition.

        if (type.fields.length >= 53) throw Error('Cannot encode more than 52 fields due to javascript badness')
        let optionalBits = 0

        for (const field of type.fields) {
          if (field.localOnly) continue
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
          optionalBits = mixBit(optionalBits, !hasField)
          // console.log('optional bits', optionalBits)
        }

        // Ok on to writing it.
        writeVarInt(w, optionalBits)
      } else if (type.encodeOptional !== 'none') throw Error('unknown encodeOptional value')

      // let numFieldsEncoded = 0
      // const encoded = []
      for (const field of type.fields) {
        if (field.localOnly) continue
        let v = val[field.key]

        if (v === undefined) {
          if (field.encodeMissingAsDefault) {
            v = field.default
          } else {
            if (type.encodeOptional === 'none') {
              throw Error('Cannot encode value: encodeOptional: none and object has missing fields')
            }

            continue
          }
        } else {
          // encoded.push(field.key)
          // numFieldsEncoded += 1
        }

        // Recurse.
        // console.log('recursing', field.key, v)
        encodeInto(w, oracle, field.valType, v, val)
      }

      // const numFields = Object.keys(val).length
      const missingKeys = Object.keys(val)
        .filter(k => k !== 'type' && (type as Struct).fields.find(f => f.key === k) == null)
      if (missingKeys.length > 0) {
        // console.log('keys', Object.keys(val), 'encoded', encoded)
        // console.warn('Did not encode all fields in object: missing', missingKeys, val, type) //, numFields, numFieldsEncoded)
        console.warn('Did not encode all fields in object: missing', missingKeys, val)
      }
    } else if (type.type === 'list') {
      // Length prefixed list of entries.
      // TODO: Consider special-casing bit arrays.
      writeVarInt(w, val.length)
      for (const v of val) {
        encodeInto(w, oracle, type.fieldType, v)
      }
    } else if (type.type === 'enum') {
      const variantNum = findEnumVariant(val, type, parent)
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
        throw Error('nyi')
    }
  }
}

const exampleTest = () => {
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


const metaSchemaTest = () => {
  let out = toBinary(metaSchema, metaSchema)
  console.log('meta', out)

  fs.writeFileSync('metaschema.scb', out)
}

// metaSchemaTest()

const tldrawTest = () => {
  const testSchema: Schema = {
    id: 'Shape',
    // root: ref('Shape'),
    root: {type: 'list', fieldType: ref('Shape')},
    types: {
      Shape: {
        type: 'struct',
        encodeOptional: 'none', // Change me?
        fields: [
          {key: 'x', valType: 'f32'},
          {key: 'y', valType: 'f32'},
          {key: 'rotation', valType: 'f32'},
          {key: 'id', valType: 'id'},
          {key: 'parentId', valType: 'id'},
          {key: 'index', valType: 'string'},
          // {key: 'type', valType: enumOfStrings(['geo', 'arrow', 'text'])},
          {key: 'typeName', valType: enumOfStrings(['shape'])},
          {key: 'props', valType: ref('Props')},
        ]
      },

      Props: {
        type: 'enum',
        typeOnParent: true,
        variants: [
          {key: 'text', associatedData: {
            type: 'struct',
            encodeOptional: 'none',
            fields: [
              {key: 'opacity', valType: 'string'},
              {key: 'color', valType: enumOfStrings(['light-blue', 'light-red', 'black', 'light-green', 'yellow', 'light-violet'])},
              {key: 'size', valType: enumOfStrings(['l', 'xl'])},
              {key: 'w', valType: 'uint'},
              {key: 'text', valType: 'string'},
              {key: 'font', valType: 'string'},
              {key: 'align', valType: enumOfStrings(['middle', 'start', 'end'])},
              {key: 'autoSize', valType: 'bool'},
            ]
          }},

          {key: 'geo', associatedData: {
            type: 'struct',
            encodeOptional: 'none',
            fields: [
              {key: 'w', valType: 'f32'},
              {key: 'h', valType: 'f32'},
              {key: 'geo', valType: enumOfStrings(['ellipse', 'rectangle'])},
              {key: 'color', valType: enumOfStrings(['light-blue', 'light-red', 'black', 'light-green', 'yellow', 'light-violet'])},
              {key: 'fill', valType: enumOfStrings(['pattern', 'none'])},
              {key: 'dash', valType: enumOfStrings(['draw'])},
              {key: 'size', valType: enumOfStrings(['l', 'xl'])},
              {key: 'opacity', valType: 'string'}, // Why is this a string?
              {key: 'font', valType: 'string'}, // Or enumOfStrings(['draw'])
              {key: 'text', valType: 'string'},
              {key: 'align', valType: enumOfStrings(['middle', 'start', 'end'])},
              {key: 'growY', valType: 'uint'},
            ]
          }},

          {key: 'arrow', associatedData: {
            type: 'struct',
            encodeOptional: 'none',
            fields: [
              {key: 'opacity', valType: 'string'}, // Why is this a string?
              {key: 'dash', valType: enumOfStrings(['draw'])},
              {key: 'size', valType: enumOfStrings(['l', 'xl'])},
              {key: 'fill', valType: enumOfStrings(['pattern', 'none'])},
              {key: 'color', valType: enumOfStrings(['light-blue', 'light-red', 'black', 'light-green', 'yellow', 'light-violet'])},
              {key: 'w', valType: 'f32'},
              {key: 'h', valType: 'f32'},
              {key: 'bend', valType: 'f32'},

              {key: 'start', valType: ref('ArrowEnd')},
              {key: 'end', valType: ref('ArrowEnd')},

              {key: 'arrowheadStart', valType: enumOfStrings(['arrow', 'none'])},
              {key: 'arrowheadEnd', valType: enumOfStrings(['arrow', 'none'])},
            ]
          }}
        ]
      },

      // Props: {
      //   type: 'struct',
      //   encodeOptional: 'bitfield',
      //   fields: [
      //     {key: 'opacity', valType: 'string'},
      //     {key: 'color', valType: enumOfStrings(['light-blue', 'light-red', 'black', 'light-green', 'yellow', 'light-violet'])},
      //     {key: 'size', valType: enumOfStrings(['l', 'xl'])},
      //     {key: 'w', valType: 'uint'},
      //     {key: 'text', valType: 'string'},
      //     {key: 'font', valType: 'string'},
      //     {key: 'align', valType: enumOfStrings(['middle', 'start', 'end'])},
      //     {key: 'autoSize', valType: 'bool'},

      //     // These only show up sometimes.
      //     {key: 'arrowheadStart', valType: enumOfStrings(['arrow', 'none'])},
      //     {key: 'arrowheadEnd', valType: enumOfStrings(['arrow', 'none'])},
      //     {key: 'dash', valType: enumOfStrings(['draw'])},
      //     {key: 'fill', valType: enumOfStrings(['pattern', 'none'])},
      //     {key: 'geo', valType: enumOfStrings(['ellipse', 'rectangle'])},
      //     {key: 'growY', valType: 'uint'},
      //     {key: 'bend', valType: 'f32'},
      //     {key: 'h', valType: 'f32'},

      //     // Arrows
      //     {key: 'start', valType: ref('ArrowEnd')},
      //     {key: 'end', valType: ref('ArrowEnd')},
      //   ]
      // },

      ArrowEnd: {
        type: 'struct',
        encodeOptional: 'none',
        fields: [
          {key: 'x', valType: 'f32'},
          {key: 'y', valType: 'f32'},
          {key: 'binding', valType: 'id'},
          {key: 'anchor', valType: {
            type: 'struct', encodeOptional: 'none',
            fields: [
              {key: 'x', valType: 'f32'},
              {key: 'y', valType: 'f32'}
            ]
          }}
        ]
      }
    }
  }

  console.log('\n\n')
  const shapes = JSON.parse(fs.readFileSync('./tldraw-example.json', 'utf8')).data.shape
  // console.log(shapes)
  const out = toBinary(testSchema, shapes)
  console.log('Output length', out.length)
  fs.writeFileSync('tld.scb', out)

}

tldrawTest()