// import { Enum, Primitive, ref, Schema, Struct, SType } from "./schema.js";

import { EnumObject, EnumSchema, Primitive, PureSchema, ref, Schema, SchemaEncoding, SchemaToJS, StructSchema, SType } from "./schema.js"
import {Console} from 'node:console'
import { bytesUsed, trimBit, varintDecode, zigzagDecode } from "./varint.js"
import { combine, mergeSchemas } from "./utils.js"
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})


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

function readStruct(r: Reader, schema: Schema, struct: StructSchema): Record<string, any> | null {
  // I'm still not sure what we should do in this case. We may still need the data!
  //
  // There are essentially 3 options:
  // 1. Skip the data, returning nothing. But when used in a load-then-save use case,
  //    this will discard any foreign data.
  // 2. Parse the data but return it in a special way - eg {_external: {/* unknown fields */}}
  // 3. Return the array buffer containing the data, but don't parse it.
  if (!struct.mappedToJS) throw Error('NYI struct is not locally recognised!')

  // We still need to parse the struct, even if its not locally known to advance the read position.
  const result: Record<string, any> | null = !struct.mappedToJS ? null : {}

  // This is an inefficient way to do this, but it'll work fine.
  const missingFields = new Set<string>()
  if (struct.optionalOrder.length > 0) {
    let optionalBits = readVarInt(r)
    // console.log('optional bits', optionalBits)
    for (const f of struct.optionalOrder) {
      const [fieldMissing, next] = trimBit(optionalBits)
      optionalBits = next

      if (fieldMissing) missingFields.add(f)
    }
  }

  // This is just for debugging.
  const expectedJsFields = new Set(Object.keys(struct.fields).filter(k => struct.fields[k].mappedToJS))

  // console.log('missing fields', missingFields)
  for (const f of struct.fieldOrder) {
    // We always read all the fields, since we need to update the read position regardless of if we use the output.
    const type = struct.fields[f]
    if (type == null) throw Error('Missing field in schema')

    const thing = missingFields.has(f)
      ? (type.defaultValue ?? null) // The field is optional and missing from the result.
      : readThing(r, schema, type.type)

    if (type.mappedToJS) {
      result![type.renameFieldTo ?? f] = thing
    } else {
      console.warn('Unknown field', f, 'in struct')
      result!._external ??= {}
      result!._external[f] = thing
    }

    expectedJsFields.delete(f)
  }

  for (const f of expectedJsFields) {
    // Any fields here are fields the application expects but are missing from the file's schema.
    const type = struct.fields[f]
    result![type.renameFieldTo ?? f] = type.defaultValue ?? null
  }

  return result
}

function readEnum(r: Reader, schema: Schema, e: EnumSchema): EnumObject {
  // const [hasFields, variantNum] = trimBit(readVarInt(r))
  const variantNum = readVarInt(r)

  const variantName = e.variantOrder[variantNum]
  if (variantName == null) throw Error('Could not look up variant ' + variantNum)

  const variant = e.variants[variantName]
  // Only decode the struct if the encoding names fields.
  if (variant.associatedData != null && variant.associatedData.fieldOrder.length > 0) {
    const data = readStruct(r, schema, variant.associatedData)
    return {type: variantName, ...data}
  } else {
    // TODO: Make this configurable!
    return variantName
  }
}

function readPrimitive(r: Reader, type: Primitive): any {
  switch (type) {
    case 'uint': return readVarInt(r)
    case 'sint': return zigzagDecode(readVarInt(r))
    case 'string': return readString(r)
    case 'f32': {
      const result = r.data.getFloat32(r.pos, true)
      r.pos += 4
      return result
    }
    case 'f64': {
      const result = r.data.getFloat64(r.pos, true)
      r.pos += 8
      return result
    }
    case 'bool': {
      const bit = r.data.getUint8(r.pos) !== 0
      r.pos++
      return bit
    }
    case 'binary': {
      const len = readVarInt(r)
      // r.data.
      const base = r.data.byteOffset + r.pos
      const buf = r.data.buffer.slice(base, base+len)
      r.pos += len
      return buf
    }
    case 'id': throw Error('Reader for IDs not implemented')
    // default: throw Error('NYI readThing for ' + type)
    default:
      const expectNever: never = type
  }
}

function readThing(r: Reader, schema: Schema, type: SType): any {
  if (typeof type === 'string') {
    return readPrimitive(r, type)
  } else {
    switch (type.type) {
      case 'ref': {
        const inner = schema.types[type.key]
        if (inner.type === 'struct') return readStruct(r, schema, inner)
        else if (inner.type === 'enum') return readEnum(r, schema, inner)
        else { const exhaustiveCheck: never = inner }
        break
      }
      case 'list': {
        const length = readVarInt(r)
        // console.log('length', length)
        const result = []
        for (let i = 0; i < length; i++) {
          result.push(readThing(r, schema, type.fieldType))
        }
        return result
      }
      case 'map': {
        if (type.keyType !== 'string') throw Error('Cannot read map with non-string keys in javascript')
        const length = readVarInt(r)
        const result: Record<string, any> = {}
        for (let i = 0; i < length; i++) {
          const k = readPrimitive(r, type.keyType)
          const v = readThing(r, schema, type.valType)
          result[k] = v
        }
        return result
      }
      default:
        const expectNever: never = type
    }
  }
}

export function readData(schema: Schema, data: Uint8Array): any {
  const reader: Reader = {
    pos: 0,
    data: new DataView(data.buffer, data.byteOffset, data.byteLength)
  }

  return readThing(reader, schema, schema.root)
}


// ***** Testing code ******



const testRead = () => {
  const schema: Schema = {
    id: 'Example',
    root: ref('Contact'),
    types: {
      Contact: {
        type: 'struct',
        mappedToJS: true,
        fieldOrder: ['age', 'name'],
        optionalOrder: [],

        fields: {
          name: {type: 'string', mappedToJS: true},
          age: {type: 'uint', mappedToJS: true}
          // address: {type: 'string'},
        }
      }
    }
  }

  const data = new Uint8Array([ 123, 4, 115, 101, 112, 104 ])

  console.log(readData(schema, data))
}

const testRead2 = () => {
  const fileSchema: PureSchema = {
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

  const appSchema: PureSchema = {
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
        type: 'struct',
        fieldOrder: ['age', 'name'],
        optionalOrder: []
      }
    }
  }

  const toJs: SchemaToJS = {
    id: 'Example',
    types: {
      Contact: {
        type: 'struct',
        mappedToJS: true,
        fields: {
          age: { mappedToJS: true, renameFieldTo: 'yearsOld' },
          address: { mappedToJS: true, defaultValue: 'unknown location' },
        }
      }
    }
  }

  const b = new Uint8Array([ 123, 4, 115, 101, 112, 104 ])

  const mergedSchema = mergeSchemas(appSchema, fileSchema)
  const fullSchema = combine(mergedSchema, encoding, toJs)
  console.log(readData(fullSchema, b))
}

// testRead()
// testRead2()
