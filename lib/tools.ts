// import { Enum, Primitive, ref, Schema, Struct, SType } from "./schema.js";

import { ref } from "./schema.js"
import {Console} from 'node:console'
import { bytesUsed, varintDecode, zigzagDecode } from "./varint.js"
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

export type Primitive = 'uint' | 'sint' | 'f32' | 'f64' | 'bool' | 'string' | 'binary' | 'id'

export type SType = Primitive
  // | {type: 'list', fieldType: SType}
  | {type: 'ref', key: string} // Reference to another type in the type oracle.
  // | MapType

export interface StructSchema {
  type: 'struct'
  fields: Record<string, {
    type: SType,
  }>
  // default?
}

type Oracle = Record<string, StructSchema>
export interface Schema {
  id: string,
  root: SType
  types: Oracle
  // types: Record<string, Struct | Enum>
}


// *** File to schema mapping ***

export interface StructEncoding {
  // Any fields not listed here are not included in the file data, and should be null, default or error.
  //
  // The order here is important. Fields are listed in the order that their data is written to the file.
  //
  // TODO: Bit pack adjacent booleans.
  fieldOrder: string[],
  optionalOrder: string[],
}

export interface SchemaEncoding {
  id: string,
  types: Record<string, StructEncoding>
}



// *** Schema to javascript mapping ***

export interface SchemaToJS {
  id: string,
  // TODO.
  types: Record<string, {
    fields: Record<string, {
      defaultValue?: any, // If the field is missing in the data set, use this value instead of null.
      fieldName?: string, // Overrides the field's key name in schema
    }>
  }>
}




// **************************


const isRef = (x: SType): x is {type: 'ref', key: string} => (
  typeof x !== 'string' && x.type === 'ref'
)

const typesShallowEq = (a: SType, b: SType): boolean => {
  if (a === b) return true
  if (typeof a === 'string' || typeof b === 'string') return false
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'ref':
      return a.key === b.key
    // Other cases (when added) will generate a type error.
  }
}

const mergedKeys = <T = any>(a: Record<string, T>, b: Record<string, T>): Iterable<string> => (
  new Set([...Object.keys(a), ...Object.keys(b)])
)

const structEq = (a: StructSchema, b: StructSchema): boolean => {
  for (const k of mergedKeys(a.fields, b.fields)) {
    let af = a.fields[k]
    let bf = b.fields[k]
    if (af == null || bf == null) return false

    if (!typesShallowEq(af.type, bf.type)) return false
  }

  // console.log('struct eq')

  return true
}

const typesEq = (a: SType, b: SType, aOracle: Oracle, bOracle: Oracle): boolean => {
  if (a === b) return true
  if (typeof a === 'string' || typeof b === 'string') return false
  if (a.type !== b.type) return false

  switch (a.type) {
    case 'ref':
      if (a.key !== b.key) return false
      return structEq(aOracle[a.key], bOracle[a.key])
    // Other cases (when added) will generate a type error.
  }
}

function mergeStructs(a: StructSchema, b: StructSchema): StructSchema {
  console.log('merge', a, b)
  // Merge them.
  const out: StructSchema = {
    type: 'struct',
    fields: {}
  }

  // console.log('merge structs', a.fields, b.fields, mergedKeys(a.fields, b.fields))
  for (const f of mergedKeys(a.fields, b.fields)) {
    const af = a.fields[f]
    const bf = b.fields[f]
    // console.log('f', f, af, bf)

    if (af == null) out.fields[f] = bf
    else if (bf == null) out.fields[f] = af
    else {
      // Check the fields are compatible.
      if (!typesShallowEq(af.type, bf.type)) throw Error('Incompatible types in struct field')
      // Keep either.
      out.fields[f] = af
    }
  }

  return out
}

function mergeSchemas(a: Schema, b: Schema): Schema {
  if (a.id != b.id) throw Error('Incompatible schemas')
  if (!typesShallowEq(a.root, b.root)) throw Error('Incompatible root elements')

  // I'm going to use A's naming system. (Its possible for both schemas to use different type names).
  //
  // And I'm going to copy all types from both schemas.
  const out: Schema = {
    id: a.id,
    root: a.root, // Ok since a.root shallow eq b.root.
    types: {}
  }

  for (const key of mergedKeys(a.types, b.types)) {
    const aa = a.types[key]
    const bb = b.types[key]

    if (aa == null) out.types[key] = bb
    else if (bb == null || structEq(aa, bb)) out.types[key] = aa
    else out.types[key] = mergeStructs(aa, bb)
  }

  return out
}



interface Reader {
  pos: number,
  data: DataView
}

function readVarInt(r: Reader): number {
  const buf = new Uint8Array(r.data.buffer, r.pos + r.data.byteOffset)
  r.pos += bytesUsed(buf)
  return varintDecode(buf)
}

const textDecoder = new TextDecoder('utf-8')

function readString(r: Reader): string {
  const len = readVarInt(r)
  // r.data.
  const base = r.data.byteOffset + r.pos
  const buf = r.data.buffer.slice(base, base+len)
  r.pos += len
  return textDecoder.decode(buf)
}



interface ReadState {
  encoding: SchemaEncoding
  schema: Schema
  toJs: SchemaToJS
  reader: Reader
}


function readStruct(state: ReadState, key: string, schema: StructSchema): Record<string, any> | null {
  const toJs = state.toJs.types[key]
  // I'm still not sure what we should do in this case. We may still need the data
  //
  // There are essentially 3 options:
  // 1. Skip the data, returning nothing. But when used in a load-then-save use case,
  //    this will discard any foreign data.
  // 2. Parse the data but return it in a special way - eg {_external: {/* unknown fields */}}
  // 3. Return the array buffer containing the data, but don't parse it.

  if (toJs == null) throw Error('NYI no toJs for struct')

  const encoding = state.encoding.types[key]
  if (encoding == null) throw Error('Missing encoding information for schema type ' + key)

  const result: Record<string, any> | null = toJs == null ? null : {}

  if (encoding.optionalOrder.length > 0) throw Error('nyi optional fields')

  const expectedJsFields = new Set(Object.keys(toJs.fields))

  for (const f of encoding.fieldOrder) {
    // We always read all the fields, since we need to update the read position regardless of if we use the output.
    const type = schema.fields[f]
    if (type == null) throw Error('Missing field in schema')

    const thing = readThing(state, type.type)

    const toJsField = toJs.fields[f]
    if (toJsField != null) {
      if (toJsField.fieldName != null) result![toJsField.fieldName] = thing
      else result![f] = thing
    } else {
      console.warn('Unknown field', f, 'in struct', key)
      if (result!._external == null) result!._external = {}
      result!._external[f] = thing
    }

    expectedJsFields.delete(f)
  }

  for (const f of expectedJsFields) {
    // Any fields here are fields the application expects but are missing from the file's schema.
    const toJsField = toJs.fields[f]
    const val = toJsField.defaultValue != null ? toJsField.defaultValue : null
    const name = toJsField.fieldName ?? f
    result![name] = val
  }

  return result
}

function readThing(state: ReadState, type: SType): any {
  if (typeof type === 'string') {
    switch (type) {
      case 'uint': return readVarInt(state.reader)
      case 'sint': return zigzagDecode(readVarInt(state.reader))
      case 'string': return readString(state.reader)
      default: throw Error('NYI readThing for ' + type)
    }
  } else {
    switch (type.type) {
      case 'ref': {
        const inner = state.schema.types[type.key]
        if (inner.type === 'struct') return readStruct(state, type.key, inner)
        // Else compile error!
        break
      }
    }
  }
}

function readData(encoding: SchemaEncoding, schema: Schema, toJs: SchemaToJS, data: Uint8Array): any {
  if (encoding.id !== schema.id || schema.id !== toJs.id) {
    throw Error('Inconsistent schema ID in input')
  }

  const reader: Reader = {
    pos: 0,
    data: new DataView(data.buffer, data.byteOffset, data.byteLength)
  }

  const state: ReadState = {
    encoding, schema, toJs, reader
  }

  return readThing(state, schema.root)
}


{
  const b = new Uint8Array([ 123, 4, 115, 101, 112, 104 ])
  const r: Reader = {
    pos: 0,
    data: new DataView(b.buffer, b.byteOffset, b.byteLength)
  }

  // console.log(readVarInt(r), readString(r), r)
}



const testMergeSchema = () => {
  const a: Schema = {
    id: 'Example',
    root: ref('Contact'),
    types: {
      Contact: {
        type: 'struct',
        fields: {
          name: {type: 'string'},
          address: {type: 'string'},
        }
      }
    }
  }

  const b: Schema = {
    id: 'Example',
    root: ref('Contact'),
    types: {
      Contact: {
        type: 'struct',
        fields: {
          name: {type: 'string'},
          phoneNo: {type: 'string'},
        }
      }
    }
  }

  console.log(mergeSchemas(a, b))
}



const testRead = () => {
  const schema: Schema = {
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
        optionalOrder: []
      }
    }
  }

  const toJs: SchemaToJS = {
    id: 'Example',
    types: {
      Contact: {
        fields: {
          name: {},
          age: {}
        }
      }
    }
  }

  const b = new Uint8Array([ 123, 4, 115, 101, 112, 104 ])

  console.log(readData(encoding, schema, toJs, b))
}

// testRead()

const testRead2 = () => {
  const fileSchema: Schema = {
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

  const appSchema: Schema = {
    id: 'Example',
    root: ref('Contact'),
    types: {
      Contact: {
        type: 'struct',
        fields: {
          // name: {type: 'string'},
          age: {type: 'uint'},
          address: {type: 'string'},
        }
      }
    }
  }

  const encoding: SchemaEncoding = {
    id: 'Example',
    types: {
      Contact: {
        fieldOrder: ['age', 'name'],
        optionalOrder: []
      }
    }
  }

  const toJs: SchemaToJS = {
    id: 'Example',
    types: {
      Contact: {
        fields: {
          age: { fieldName: 'yearsOld' },
          address: { defaultValue: 'unknown location' },
        }
      }
    }
  }

  const b = new Uint8Array([ 123, 4, 115, 101, 112, 104 ])

  const mergedSchema = mergeSchemas(appSchema, fileSchema)
  console.log(readData(encoding, mergedSchema, toJs, b))
}

testRead2()
