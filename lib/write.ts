import { mixBit, varintEncodeInto, zigzagEncode } from "./varint.js"
import { Primitive, PureSchema, ref, Schema, SchemaEncoding, SchemaToJS, StructPureSchema, StructSchema, SType } from "./schema.js"
import assert from 'assert/strict'

import {Console} from 'node:console'
import { combine, simpleFullSchema } from "./utils.js"
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

    default: throw Error('nyi type: ' + type)
  }
}

//  = simpleSchemaEncoding(schema)
function encodeStruct(w: WriteBuffer, schema: Schema, val: Record<string, any>, struct: StructSchema) {
  if (typeof val !== 'object' || Array.isArray(val) || val == null) throw Error('Invalid struct')

  if (struct.optionalOrder.length) {
    if (struct.optionalOrder.length > 53) throw Error('Cannot encode more than 52 optional fields. File an issue if this causes problems')
    let optionalBits = 0

    // If any fields are optional, all the data is prefixed by a set of optional bits describing which fields exist.
    for (const k of struct.fieldOrder) {
      const fieldName = struct.fields[k].renameFieldTo ?? k
      const fieldMissing = val[fieldName] === undefined
      optionalBits = mixBit(optionalBits, fieldMissing)
    }

    writeVarInt(w, optionalBits)
  }

  const optionalFields = new Set(struct.optionalOrder)

  for (const k of struct.fieldOrder) {
    const fieldName = struct.fields[k].renameFieldTo ?? k
    let v = val[fieldName]
    if (v == null) {
      // NOTE: I could fill in the default value in this case. Not sure if that would be the right call.
      if (!optionalFields.has(k)) throw Error('null or missing field required by encoding')
      continue // Skipped as per optionalOrder above.
    }

    const type = struct.fields[k].type

    encodeThing(w, schema, v, type)
  }
}

function encodeThing(w: WriteBuffer, schema: Schema, val: any, type: SType) {
  if (typeof type === 'object') { // Animal, mineral or vegetable...
    switch (type.type) {
      case 'ref': {
        const rootType = type.key
        encodeStruct(w, schema, val, schema.types[rootType])
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
      default:
        const exhaustiveCheck: never = type;
        throw new Error('unhandled case');
    }
  } else {
    encodePrimitive(w, val, type)
  }
}

const isRef = (x: SType): x is {type: 'ref', key: string} => (
  typeof x !== 'string' && x.type === 'ref'
)

function toBinary(schema: Schema, data: any): Uint8Array {
  const writer: WriteBuffer = {
    buffer: new Uint8Array(32),
    pos: 0,
    ids: new Map()
  }

  encodeThing(writer, schema, data, schema.root)

  return writer.buffer.slice(0, writer.pos)
}


const simpleTest = () => {
  const pureSchema: PureSchema = {
    id: 'Example',
    root: ref('Contact'),
    types: {
      Contact: {
        type: 'struct',
        fields: {
          name: {type: 'string'},
          age: {type: 'uint'}
          // address: {type: 'string'},
        }
      }
    }
  }

  const encoding: SchemaEncoding = {
    id: 'Example',
    types: {
      Contact: {
        fieldOrder: ['age', 'name'],
        optionalOrder: ['name']
      }
    }
  }

  const toJs: SchemaToJS = {
    id: 'Example',
    types: {
      Contact: {
        known: true,
        fields: {
          name: {known: true},
          age: {known: true}
        }
      }
    }
  }

  const schema = combine(pureSchema, encoding, toJs)
  const data = {name: 'seph', age: 21}

  console.log(toBinary(schema, data))
}



const kitchenSinkTest = () => {
  const schema: PureSchema = {
    id: 'Example',
    root: ref('Contact'),
    types: {
      Contact: {
        type: 'struct',
        fields: {
          name: {type: 'string'},
          age: {type: 'uint'},
          addresses: {type: {type: 'list', fieldType: 'string'}}
          // address: {type: 'string'},
        }
      }
    }
  }

  const data = {name: 'seph', age: 21, addresses: ['123 Example St', '456 Somewhere else']}

  console.log(toBinary(simpleFullSchema(schema), data))
}

simpleTest()
// kitchenSinkTest()

