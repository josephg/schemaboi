// import fs from 'fs'
import assert from 'assert/strict'
import {varintEncode, varintEncodeInto, zigzagEncode} from './varint.js'

type Primitive = 'uint' | 'sint' | 'f32' | 'f64' | 'bool'

type SType = 'string' | 'binary' | Primitive | ListType | ObjType

interface ListType {
  type: 'list',
  fieldType: SType
}

type OnMissing = 'default' | 'elide'

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

interface ObjType {
  type: 'object'
  fields: Field[]
  encodeOptional: 'bitfield'
}

interface Schema {

}




// Example

let shape: ObjType = {
  type: 'object',
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

// const assert = (a: boolean, msg?: string) => {
//   if (!a) {
//     throw Error(msg ?? 'Assertion failed')
//   }
// }

const checkType = (val: any, type: SType) => {
  switch (type) {
    case 'uint':
    case 'sint':
    case 'f32':
    case 'f64': assert(typeof val === 'number'); break
    case 'bool': assert(typeof val === 'boolean'); break
    case 'string': assert(typeof val === 'string'); break
    default: throw Error(`case missing in checkType: ${type}`)
  }
}

const encoder = new TextEncoder()

const toBinary = (schema: ObjType, data: any): Uint8Array => {
  let w: WriteBuffer = {
    buffer: new Uint8Array(32),
    pos: 0
  }

  if (schema.encodeOptional !== 'bitfield') throw Error('NYI')
  // First we need to find and encode the optional data bits
  if (schema.fields.length >= 53) throw Error('Cannot encode more than 52 fields due to javascript badness')
  let optionalBits = 0

  for (const field of schema.fields) {
    const hasDefault = field.default !== undefined
    if (field.encodeMissingAsDefault != null && hasDefault) throw Error('Cannot set encodeMissingAsDefault when field has no default')

    if (hasDefault) {
      field.encodeMissingAsDefault ??= (
        field.valType === 'bool'
        || field.valType === 'uint'
        || field.valType === 'sint'
        || field.valType === 'string'
        || field.valType === 'binary')

      if (field.encodeMissingAsDefault === true) continue
    }

    let hasField = data[field.key] !== undefined
    console.log('opt', field.key, hasField)
    optionalBits = (optionalBits * 2) + (+hasField)

    console.log('optional bits', optionalBits)
  }

  // Ok on to writing it.
  writeVarInt(w, optionalBits)

  for (const field of schema.fields) {
    let val = data[field.key]
    checkType(val, field.valType)

    switch (field.valType) {
      case 'bool': {
        ensureCapacity(w, 1)
        w.buffer[w.pos] = val
        w.pos += 1
        break
      }

      // case 'uint':
      // case 'sint':
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
      case 'sint': zigzagEncode(val) // And flow down.
      case 'uint': {
        writeVarInt(w, val)
        break
      }
      case 'string': {
        // This allocates, which isn't ideal. Could use encodeInto instead but this makes the
        // length prefix much easier to place.
        const strBytes = encoder.encode(val)
        ensureCapacity(w, 9 + strBytes.length)
        w.pos += varintEncodeInto(strBytes.length, w.buffer, w.pos)
        w.buffer.set(strBytes, w.pos)
        w.pos += strBytes.length
        break
      }

      default:
        throw Error('nyi')
    }
  }

  return w.buffer.slice(0, w.pos)
}


{
  let testShape: ObjType = {
    type: 'object',
    encodeOptional: 'bitfield',
    fields: [
      {key: 'x', valType: 'f32'},
      {key: 'id', valType: 'string', default: ''},
    ]
  }

  console.log(toBinary(testShape, {x: 12.32, id: 'oh hai'}))

  // console.log(testShape)
}