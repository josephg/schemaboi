// import { Enum, Primitive, ref, Schema, Struct, SType } from "./schema.js";

import { EnumObject, EnumSchema, Schema, SType, Field, IntPrimitive, WrappedPrimitive, AppSchema, EnumVariant } from "./schema.js"
import { bytesUsed, decode, decodeBN, zigzagDecode, zigzagDecodeBN } from "bijective-varint"
import { trimBit } from "./utils.js"
import { intEncoding, enumVariantsInUse, isPrimitive, canonicalizeType, mergeSchemas, fillSchemaDefaults, setEverythingLocal, ref, chooseRootType } from "./utils.js"
import { extendSchema } from './extendschema.js'
import { metaSchema } from "./metaschema.js"
// import {Console} from 'node:console'
// const console = new Console({
//   stdout: process.stdout,
//   stderr: process.stderr,
//   inspectOptions: {depth: null}
// })


interface Reader {
  pos: number,
  data: DataView,
  ids: string[],
}

function readVarInt(r: Reader): number {
  const buf = new Uint8Array(r.data.buffer, r.pos + r.data.byteOffset)
  r.pos += bytesUsed(buf)
  return decode(buf)
}
function readVarIntBN(r: Reader): bigint {
  const buf = new Uint8Array(r.data.buffer, r.pos + r.data.byteOffset)
  r.pos += bytesUsed(buf)
  return decodeBN(buf)
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

function readFields(r: Reader, schema: Schema, variant: EnumVariant): Record<string, any> | null {
  // I'm still not sure what we should do in this case. We may still need the data!
  //
  // There are essentially 3 options:
  // 1. Skip the data, returning nothing. But when used in a load-then-save use case,
  //    this will discard any foreign data.
  // 2. Parse the data but return it in a special way - eg {_foreign: {/* unknown fields */}}
  // 3. Return the array buffer containing the data, but don't parse it.
  // if (variant.foreign) {
  //   console.error('in struct:', variant)
  //   throw Error(`Foreign variant is not locally recognised! TODO - handle this better here`)
  // }

  if (variant.fields == null || variant.fields.size == 0) throw Error('readFields should not be called for empty variant')

  let bitPattern = 0
  let nextBit = 8
  const readNextBit = (): boolean => {
    if (nextBit >= 8) {
      // Read next byte
      bitPattern = r.data.getUint8(r.pos)
      r.pos++
      nextBit = 0
    }

    // Bits are stored in LSB0 order. We read the bits from least to most significant in
    // each byte, then move on.
    // console.log('bits', bitPattern, 1 << nextBit)
    let bit = !!(bitPattern & (1 << nextBit))
    nextBit++
    return !!bit
  }

  // We still need to parse the fields, even if its not locally known to advance the read position.
  // const result: Record<string, any> | null = struct.foreign ? null : {}
  const result: Record<string, any> = {}
  const missingFields = new Set<string>()

  const storeVal = (k: string, field: Field, v: any) => {
    // TODO: There's a sorta bug here: We haven't read all the other fields of the object.
    v ??= typeof field.defaultValue === 'function'
      ? field.defaultValue(result)
      : (field.defaultValue ?? null)
    if (field.foreign) {
      console.warn(`Warning: foreign field '${k}' in struct`)
      result._foreign ??= {}
      result._foreign[k] = v
    } else {
      result[field.renameFieldTo ?? k] = v
    }
  }

  // We read the data in 2 passes: First we read all the bits (booleans and optionals), then we read
  // the data itself.
  if (variant.fields != null) for (const [k, field] of variant.fields.entries()) {
    let hasValue = field.skip ? false
      : field.optional ? readNextBit()
      : true

    // console.log('read', k, hasValue)
    if (!hasValue) missingFields.add(k)

    // TODO: Consider also encoding enums with 2 in-use fields like this!
    if (field.inline && !field.skip) {
      if (field.type.type === 'bool') storeVal(k, field, hasValue ? readNextBit() : null)
      else throw Error('Cannot read inlined field of non-bool type')
    }
  }

  // console.log('missing fields', missingFields)

  // Now read the data itself.
  if (variant.fields != null) for (const [k, field] of variant.fields.entries()) {
    // We don't pass over skipped fields because we still need to fill them in with a specified default value.
    if (field.inline) continue // Inlined fields have already been read.

    const hasValue = !field.skip && !missingFields.has(k)
    const v = hasValue ? readThing(r, schema, field.type, result) : null
    storeVal(k, field, v)
  }

  return variant.decode ? variant.decode(result!) : result
}

function readEnum(r: Reader, schema: Schema, e: EnumSchema, parent?: any): EnumObject | any {
  const usedVariants = enumVariantsInUse(e)

  if (usedVariants.length == 0) throw Error('Cannot decode enum with no variants')

  // Enums with only 1 variant don't store their variant number at all.
  const variantNum = usedVariants.length === 1 ? 0 : readVarInt(r)

  if (variantNum >= usedVariants.length) throw Error('Could not look up variant ' + variantNum)

  const variantName = usedVariants[variantNum]
  // console.log('VV', variantNum, variantName)

  const variant = e.variants.get(variantName)!
  // console.log('READ variant', variant, schema)
  // Only decode the struct if the encoding names fields.

  const associatedData = variant.fields != null && variant.fields.size > 0
    ? readFields(r, schema, variant)
    : null

  // console.log('associated data', associatedData)

  // TODO: The logic for this feels kinda sketch.
  if (e.numericOnly && associatedData != null) throw Error('Cannot decode associated data with numeric enum')

  if (e.decode) {
    return e.decode(variantName, associatedData)
  } else if (e.localStructIsVariant != null) {
    if (variantName !== e.localStructIsVariant) throw Error('NYI - Bubble up foreign enum')
    return associatedData
  } else if (variant.foreign) {
    // The data isn't mapped to a local type. Encode it as {type: '_foreign', data: {...}}.

    // TODO: Only encode foreign variants if the enum allows us to do this!
    return {type: '_foreign', data: {type: variantName, ...associatedData}}
  } else if (e.typeFieldOnParent != null) {
    if (parent == null) throw Error('Cannot write type field on null parent')
    parent[e.typeFieldOnParent] = variantName
    return associatedData ?? {}
  } else if (!e.numericOnly) {
    return {type: variantName, ...associatedData}
  } else {
    // TODO: Make this configurable! Apps should never be surprised by this.
    return variantName
  }
}

function readNumeric(r: Reader, type: IntPrimitive): number | bigint {
  const encoding = intEncoding(type)
  const isSigned = type.type[0] === 's'

  if (encoding === 'varint') {
    if (type.decodeAsBigInt) {
      // We don't actually care what the inner type is.
      const n = readVarIntBN(r)
      return isSigned ? zigzagDecodeBN(n) : n
    } else {
      const n = readVarInt(r)
      return isSigned ? zigzagDecode(n) : n
    }
  } else {
    let n: number
    switch (type.type) {
      case 'u8': n = r.data.getUint8(r.pos++); break
      case 's8': n = r.data.getInt8(r.pos++); break
      default: throw Error('Not implemented: Little endian encoding for int type: ' + type.type)
    }
    return type.decodeAsBigInt ? BigInt(n) : n
  }
}

function readPrimitive(r: Reader, type: WrappedPrimitive | IntPrimitive): any {
  switch (type.type) {

    case 'u8': case 's8':
    case 'u16': case 'u32': case 'u64': case 'u128':
    case 's16': case 's32': case 's64': case 's128':
      return readNumeric(r, type)

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
    case 'string': return readString(r)
    case 'binary': {
      const len = readVarInt(r)
      // r.data.
      const base = r.data.byteOffset + r.pos
      const buf = r.data.buffer.slice(base, base+len)
      r.pos += len
      return buf
    }
    case 'id': {
      // IDs are encoded as either a string or a number, depending on whether we've seen this ID before.
      let [seenBefore, n] = trimBit(readVarInt(r))
      if (seenBefore) {
        // n stores the index of the string in the cached ID list.
        if (n > r.ids.length) throw Error('Invalid ID: Length exceeds seen IDs')
        return r.ids[n]
      } else {
        // The data model stores a string with length n.
        const base = r.data.byteOffset + r.pos
        const buf = r.data.buffer.slice(base, base+n)
        r.pos += n
        let val = textDecoder.decode(buf)
        r.ids.push(val)
        return val
      }


    }
    // default: throw Error('NYI readThing for ' + type)
    default:
      const expectNever: never = type
  }
}

function readThing(r: Reader, schema: Schema, type: SType, parent?: any): any {
  switch (type.type) {
    case 'ref': {
      const inner = schema.types[type.key]
      if (inner.foreign) throw Error('Cannot read foreign struct ' + type.key)
      return readEnum(r, schema, inner, parent)
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
      const length = readVarInt(r)
      const keyType = canonicalizeType(type.keyType)
      const valType = canonicalizeType(type.valType)
      if (type.decodeForm == null || type.decodeForm == 'object') {
        if (keyType.type !== 'string' && keyType.type !== 'id') throw Error('Cannot read map with non-string keys in javascript. Use Map decodeFrom.')
        const result: Record<string, any> = {}
        for (let i = 0; i < length; i++) {
          let k = readPrimitive(r, keyType)
          let v = readThing(r, schema, valType)
          if (type.decodeEntry) [k, v] = type.decodeEntry([k, v])
          result[k] = v
        }
        return result
      } else {
        const entries: [number | string | boolean, any][] = []
        for (let i = 0; i < length; i++) {
          let k = readThing(r, schema, keyType)
          let v = readThing(r, schema, valType)
          if (type.decodeEntry) [k, v] = type.decodeEntry([k, v])
          entries.push([k, v])
        }
        return type.decodeForm == 'entryList'
          ? entries
          : new Map(entries)
      }
    }
    default:
      if (isPrimitive(type.type)) return readPrimitive(r, type)
      else throw Error(`Attempt to read unknown type: ${type.type}`)
  }
}

const createReader = (data: Uint8Array): Reader => ({
  pos: 0,
  data: new DataView(data.buffer, data.byteOffset, data.byteLength),
  ids: ['Default']
})

/**
 * This is a low level method for reading data. It simply reads the incoming data
 * using the provided schema.
 */
export function readRaw(schema: Schema, data: Uint8Array, reqType?: string | SType): any {
  return readThing(createReader(data), schema, chooseRootType(schema, reqType))
}

export function read(localSchema: Schema | null, data: Uint8Array, reqType?: string | SType): [Schema, any] {
  // A SB file starts with "SB10" for schemaboi version 1.0.
  const magic = textDecoder.decode(data.slice(0, 4))
  if (magic !== 'SB11') throw Error('Magic bytes do not match: Expected SBXX.')

  const reader = createReader(data)
  reader.pos += 4 // Skip the magic bytes.

  // Read the schema.
  const remoteSchema: Schema = readThing(reader, metaSchema, metaSchema.root!)
  // console.log('rs', remoteSchema.types.Any.variants.get('int'))
  // console.log(remoteSchema)
  const mergedSchema = localSchema == null ? remoteSchema : mergeSchemas(remoteSchema, localSchema)
  if (localSchema == null) setEverythingLocal(mergedSchema)

  // Read the data.
  reader.ids.length = 0
  return [mergedSchema, readThing(reader, mergedSchema, chooseRootType(mergedSchema, reqType))]
}

export function readAppSchema(appSchema: AppSchema, data: Uint8Array): [Schema, any] {
  const localSchema = extendSchema(appSchema)
  return read(localSchema, data)
}

export function readWithoutSchema(data: Uint8Array): [Schema, any] {
  return read(null, data)
}
