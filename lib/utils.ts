import { EnumEncoding, EnumPureSchema, EnumSchema, EnumToJS, List, PureSchema, Ref, ref, Schema, SchemaEncoding, SchemaToJS, StructEncoding, StructPureSchema, StructSchema, StructToJS, SType } from "./schema.js"

import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

// const merge1 = <T>(a: T | null | undefined, b: T | null | undefined, mergeFn: (a: T, b: T) => T): T | null | undefined => (
//   a == null ? b
//     : b == null ? a
//     : mergeFn(a, b)
// )

const mergeObjects = <T>(a: Record<string, T>, b: Record<string, T>, mergeFn: (a: T, b: T) => T): Record<string, T> => {
  const result: Record<string, T> = {}
  for (const key of mergedKeys(a, b)) {
    const aa = a[key]
    const bb = b[key]

    result[key] = aa == null ? bb
      : bb == null ? aa
      : mergeFn(aa, bb)
  }

  return result
}

const objMap = <A, B>(obj: Record<string, A>, mapFn: (a: A, key: string) => B): Record<string, B> => {
  const result: Record<string, B> = {}
  for (const k in obj) {
    result[k] = mapFn(obj[k], k)
  }
  return result
}

function mergeStructs(a: StructPureSchema, b: StructPureSchema): StructPureSchema {
  // console.log('merge', a, b)
  // Merge them.
  return {
    type: 'struct',
    fields: mergeObjects(a.fields, b.fields, (af, bf) => {
      // Check the fields are compatible.
      if (!typesShallowEq(af.type, bf.type)) throw Error('Incompatible types in struct field')
      // Keep either.
      return af
    })
  }
}

function mergeEnums(a: EnumPureSchema, b: EnumPureSchema): EnumPureSchema {
  return {
    type: 'enum',
    variants: mergeObjects(a.variants, b.variants, (aa, bb) => {
      return {
        associatedData: aa.associatedData == null ? bb.associatedData
          : bb.associatedData == null ? aa.associatedData
          : mergeStructs(aa.associatedData, bb.associatedData)
      }
    })
  }
}

export function mergeSchemas(a: PureSchema | Schema, b: PureSchema | Schema): PureSchema {
  if (a.id != b.id) throw Error('Incompatible schemas')
  if (!typesShallowEq(a.root, b.root)) throw Error('Incompatible root elements')

  // I'm going to use A's naming system. (Its possible for both schemas to use different type names).
  //
  // And I'm going to copy all types from both schemas.
  return {
    id: a.id,
    root: a.root, // Ok since a.root shallow eq b.root.
    types: mergeObjects(a.types, b.types, (aa, bb) => {
      if (aa.type !== bb.type) throw Error(`Cannot merge ${aa.type} with ${bb.type}`) // enums and structs can't mix.

      if (aa.type === 'struct') {
        return structEq(aa, bb as StructPureSchema)
          ? aa
          : mergeStructs(aa, bb as StructPureSchema)
      } else if (aa.type === 'enum') {
        return mergeEnums(aa, bb as EnumPureSchema)
      } else {
        let check: never = aa
        throw Error('unexpected type: ' + aa)
      }
    })
  }
}

const simpleEncodingForStruct = (s: StructPureSchema): StructEncoding => {
  const fields = Object.keys(s.fields)
  return {
    type: 'struct',
    fieldOrder: fields,
    optionalOrder: fields,
  }
}

/** This function generates a trivial schema encoding for the specified schema. It will not be optimized */
export function simpleSchemaEncoding(schema: PureSchema): SchemaEncoding {
  return {
    id: schema.id,
    types: objMap(schema.types, (schemaType) => {
      switch (schemaType.type) {
        case 'struct': {
          return simpleEncodingForStruct(schemaType)
        }

        case 'enum': {
          return {
            type: 'enum',
            variantOrder: Object.keys(schemaType.variants),
            variants: objMap(schemaType.variants, v => {
              return v.associatedData ? {
                associatedData: simpleEncodingForStruct(v.associatedData)
              } : {}
            })
          }
        }
      }
    })
  }
}

/** The resulting JS map assumes we know all fields, everything is nullable and nothing is renamed. */
export function simpleJsMap(schema: PureSchema): SchemaToJS {
  return {
    id: schema.id,
    types: objMap(schema.types, (s): StructToJS | EnumToJS => {
      switch (s.type) {
        case 'struct': {
          return <StructToJS>{
            type: 'struct',
            known: true,
            fields: objMap(s.fields, () => ({known: true}))
          }
        }

        case 'enum': {
          return <EnumToJS>{
            type: 'enum',
            variants: objMap(s.variants, s => {
              return s.associatedData ? {
                associatedData: <StructToJS>{
                  type: 'struct',
                  known: true,
                  fields: objMap(s.associatedData.fields, () => ({known: true}))
                }
              } : {}
            })
          }
        }
      }
    })
  }
}

const combineStruct = (s: StructPureSchema, e: StructEncoding, j: StructToJS): StructSchema => {
  return <StructSchema>{
    type: 'struct',
    known: j.known,
    fieldOrder: e.fieldOrder,
    optionalOrder: e.optionalOrder,
    fields: objMap(s.fields, (sf, f) => ({
      ...sf,
      ...j.fields[f],
    }))
  }
}

export function combine(schema: PureSchema, encoding: SchemaEncoding, toJs: SchemaToJS): Schema {
  if (schema.id !== encoding.id || encoding.id !== toJs.id) throw Error('Mismatched schemas')

  const result: Schema = {
    id: schema.id,
    root: schema.root,
    types: objMap(schema.types, (s, name): StructSchema | EnumSchema => {

      switch (s.type) {
        case 'struct': {
          const e = encoding.types[name] as StructEncoding
          const j = (toJs.types[name] ?? {known: false, fields: {}}) as StructToJS

          return combineStruct(s, e, j)
        }

        case 'enum': {
          const e = encoding.types[name] as EnumEncoding
          const j = toJs.types[name] as EnumToJS

          return <EnumSchema>{
            type: 'enum',
            variantOrder: e.variantOrder,
            variants: objMap(s.variants, (v, name) => {
              // TODO: Put null checks on this stuff.
              return v.associatedData ? {
                associatedData: combineStruct(v.associatedData,
                  e.variants[name].associatedData!,
                  j.variants[name].associatedData!
                )
              } : {}
            })
          }
        }
      }
    })
  }

  return result
}

export function simpleFullSchema(schema: PureSchema): Schema {
  return combine(schema,
    simpleSchemaEncoding(schema),
    simpleJsMap(schema)
  )
}





export const isRef = (x: SType): x is {type: 'ref', key: string} => (
  typeof x !== 'string' && x.type === 'ref'
)

export const typesShallowEq = (a: SType, b: SType): boolean => {
  if (a === b) return true
  if (typeof a === 'string' || typeof b === 'string') return false
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'ref':
      return a.key === (b as Ref).key
    case 'list':
      return typesShallowEq(a.fieldType, (b as List).fieldType)
    // Other cases (when added) will generate a type error.
  }
}

export const mergedKeys = <T = any>(a: Record<string, T>, b: Record<string, T>): Iterable<string> => (
  new Set([...Object.keys(a), ...Object.keys(b)])
)

export const structEq = (a: StructPureSchema, b: StructPureSchema): boolean => {
  for (const k of mergedKeys(a.fields, b.fields)) {
    let af = a.fields[k]
    let bf = b.fields[k]
    if (af == null || bf == null) return false

    if (!typesShallowEq(af.type, bf.type)) return false
  }

  // console.log('struct eq')

  return true
}

type Oracle = Record<string, StructPureSchema>
export const typesEq = (a: SType, b: SType, aOracle: Oracle, bOracle: Oracle): boolean => {
  if (a === b) return true
  if (typeof a === 'string' || typeof b === 'string') return false
  if (a.type !== b.type) return false

  switch (a.type) {
    case 'ref':
      if (a.key !== (b as Ref).key) return false
      return structEq(aOracle[a.key], bOracle[a.key])
    case 'list':
      return typesEq(a.fieldType, (b as List).fieldType, aOracle, bOracle)
    // Other cases (when added) will generate a type error.
  }
}




// ***** Testing code ******

const testMergeSchema = () => {
  const a: PureSchema = {
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

  const b: PureSchema = {
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

const testSimpleSchemaInference = () => {
  const schema: PureSchema = {
    id: 'Example',
    root: ref('Contact'),
    types: {
      Contact: {
        type: 'struct',
        fields: {
          name: {type: 'string'},
          address: {type: 'string'},
        }
      },

      Shape: {
        type: 'enum',
        variants: {
          Line: {},
          Square: {
            associatedData: {
              type: 'struct',
              fields: { x: {type: 'f32'}, y: {type: 'f32'} }
            }
          }
        }
      }
    }
  }

  // console.log('encoding', simpleSchemaEncoding(schema))
  // console.log('js', simpleJsMap(schema))


  console.log(simpleFullSchema(schema))
}

// testMergeSchema()
// testSimpleSchemaInference()