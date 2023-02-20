import { SimpleEnumSchema, SimpleStructSchema, EnumSchema, List, MapType, SimpleSchema, Ref, Schema, StructSchema, SType } from "./schema.js"

import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

// const takeOrMerge = <T>(a: T?, b: T?, mergeFn: (a: T, b: T) => T): T => (
//   a == null ? b!
//   : b == null ? a!
//   : mergeFn(a, b)
// )

const mergeObjects = <T>(a: Record<string, T>, b: Record<string, T>, mergeFn: (a: T, b: T) => T): Record<string, T> => {
  const result: Record<string, T> = {}
  for (const key of mergedKeys(a, b)) {
    const aa = a[key]
    const bb = b[key]

    // result[key] = takeOrMerge(aa, bb, mergeFn)
    result[key] = aa == null ? bb
      : bb == null ? aa
      : mergeFn(aa, bb)
  }

  return result
}

const mergeObjectsAll = <T>(a: Record<string, T>, b: Record<string, T>, mergeFn: (a: T | null, b: T | null) => T): Record<string, T> => {
  const result: Record<string, T> = {}
  for (const key of mergedKeys(a, b)) {
    const aa = a[key] ?? null
    const bb = b[key] ?? null

    result[key] = mergeFn(aa, bb)
  }

  return result
}

export const mergedKeys = <T = any>(a: Record<string, T>, b: Record<string, T>): Iterable<string> => (
  new Set([...Object.keys(a), ...Object.keys(b)])
)

const objMap = <A, B>(obj: Record<string, A>, mapFn: (a: A, key: string) => B): Record<string, B> => {
  const result: Record<string, B> = {}
  for (const k in obj) {
    result[k] = mapFn(obj[k], k)
  }
  return result
}

function mergeStructs(remote: StructSchema, local: StructSchema): StructSchema {
  // console.log('merge', a, b)
  // Merge them.
  return {
    type: 'struct',
    foreign: local.foreign ?? false,
    fields: mergeObjectsAll(remote.fields, local.fields, (remoteF, localF) => {
      // Check the fields are compatible.
      if (remoteF && localF && !typesShallowEq(remoteF.type, localF.type)) {
        throw Error('Incompatible types in struct field')
      }

      return {
        type: localF?.type ?? remoteF!.type,
        foreign: localF ? (localF.foreign ?? false) : true,
        defaultValue: localF?.defaultValue,
        optional: remoteF?.optional ?? true, // A field being optional is part of the encoding.
        mappedToJS: localF?.foreign ?? true,
      }
    }),
    encodingOrder: remote.encodingOrder,
  }
}

function mergeEnums(remote: EnumSchema, local: EnumSchema): EnumSchema {
  // I would use mergeObjects from above, but if one (or both) of the enums is closed, we need to make sure
  // fields aren't added when they aren't valid.

  if (local.numericOnly && !remote.numericOnly) {
    // TODO: Not sure what to do in this case.
    console.warn("numericOnly does not match. Remote schema may include associated data.")
  }

  const result: EnumSchema = {
    type: 'enum',
    foreign: local.foreign ?? false,
    numericOnly: local.numericOnly,
    // I think this behaviour is correct...
    closed: remote.closed || local.closed,
    variants: {},
    encodingOrder: remote.encodingOrder,
  }

  for (const key of mergedKeys(remote.variants, local.variants)) {
    const remoteV = remote.variants[key]
    const localV = local.variants[key]

    if (remoteV == null && remote.closed) throw Error('Cannot merge enums: Cannot add variant to closed enum')
    if (localV == null && local.closed) throw Error('Cannot merge enums: Cannot add variant to closed enum')

    result.variants[key] = remoteV == null ? { foreign: false, ...localV}
      : localV == null ? { ...remoteV, foreign: true } // TODO: Recursively set foreign flag in associated data.
      : {
          foreign: localV.foreign ?? false,
          associatedData: remoteV.associatedData == null ? localV.associatedData
            : localV.associatedData == null ? remoteV.associatedData
            : mergeStructs(remoteV.associatedData, localV.associatedData)
        }
  }

  return result
}


/**
 * Merge the schema found on disk with the local schema.
 *
 * This will use the encoding information from remote, and the JS mapping
 * information from the local schema.
 *
 * The set of types in the result will be the union of both. It is illegal
 * for a type or field with the same name to have different types.
 */
export function mergeSchemas(remote: Schema, local: Schema): Schema {
  if (remote.id != local.id) throw Error('Incompatible schemas')
  if (!typesShallowEq(remote.root, local.root)) throw Error('Incompatible root elements')

  return {
    id: local.id,
    root: local.root,
    types: mergeObjectsAll(remote.types, local.types, (aa, bb): StructSchema | EnumSchema => {
      if (aa == null) return bb!
      if (bb == null) return {
        ...aa,
        foreign: true,
      }

      if (aa.type !== bb.type) throw Error(`Cannot merge ${aa.type} with ${bb.type}`) // enums and structs can't mix.

      if (aa.type === 'struct') {
        return mergeStructs(aa, bb as StructSchema)
        // return structEq(aa, bb as StructSchema)
        //   ? aa
        //   : mergeStructs(aa, bb as StructSchema)
      } else if (aa.type === 'enum') {
        return mergeEnums(aa, bb as EnumSchema)
      } else {
        let check: never = aa
        throw Error('unexpected type: ' + aa)
      }
    })
  }
}

function extendStruct(s: SimpleStructSchema): StructSchema {
  return {
    type: 'struct',
    fields: objMap(s.fields, f => ({
      type: f.type,
      defaultValue: f.defaultValue,
      optional: f.optional ?? true,
    })),
    encodingOrder: Object.keys(s.fields),
  }
}

function extendEnum(s: SimpleEnumSchema): EnumSchema {
  return {
    type: 'enum',
    closed: s.closed ?? false,
    numericOnly: s.numericOnly,
    typeFieldOnParent: s.typeFieldOnParent,
    variants: objMap(s.variants, v => ({
      associatedData: v?.associatedData != null ? extendStruct(v.associatedData) : undefined,
    })),
    encodingOrder: Object.keys(s.variants)
  }
}

export function extendSchema(schema: SimpleSchema): Schema {
  return {
    id: schema.id,
    root: schema.root,
    types: objMap(schema.types, s => (
      s.type === 'enum' ? extendEnum(s) : extendStruct(s)
    ))
  }

  // return combine(schema,
  //   simpleSchemaEncoding(schema),
  //   simpleJsMap(schema)
  // )
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
    case 'map':
      const bb = b as MapType
      return a.keyType === bb.keyType && typesShallowEq(a.valType, bb.valType)
    // Other cases (when added) will generate a type error.
  }
}

// export const structEq = (a: StructSchema | SimpleStructSchema, b: StructSchema | SimpleStructSchema): boolean => {
//   for (const k of mergedKeys(a.fields, b.fields)) {
//     let af = a.fields[k]
//     let bf = b.fields[k]
//     if (af == null || bf == null) return false

//     if (!typesShallowEq(af.type, bf.type)) return false
//   }

//   // console.log('struct eq')

//   return true
// }

// type Oracle = Record<string, StructSchema | SimpleStructSchema>
// export const typesEq = (a: SType, b: SType, aOracle: Oracle, bOracle: Oracle): boolean => {
//   if (a === b) return true
//   if (typeof a === 'string' || typeof b === 'string') return false
//   if (a.type !== b.type) return false

//   switch (a.type) {
//     case 'ref':
//       if (a.key !== (b as Ref).key) return false
//       return structEq(aOracle[a.key], bOracle[a.key])
//     case 'list':
//       return typesEq(a.fieldType, (b as List).fieldType, aOracle, bOracle)
//     case 'map':
//       const bb = b as MapType
//       return a.keyType === bb.keyType && typesEq(a.valType, bb.valType, aOracle, bOracle)
//     // Other cases (when added) will generate a type error.
//   }
// }

export const ref = (key: string): {type: 'ref', key: string} => ({type: 'ref', key})

export const enumOfStringsSimple = (...variants: string[]): SimpleEnumSchema => ({
  type: 'enum',
  closed: false,
  numericOnly: true,
  variants: Object.fromEntries(variants.map(v => [v, null]))
})

export const enumOfStrings = (...variants: string[]): EnumSchema => ({
  type: 'enum',
  closed: false,
  numericOnly: true,
  variants: Object.fromEntries(variants.map(v => [v, {}])),
  encodingOrder: variants,
})

export const hasOptionalFields = (s: StructSchema): boolean => (
  // Could be more efficient, but eh.
  s.encodingOrder.findIndex(f => s.fields[f].optional) > -1
)

// ***** Testing code ******

const testMergeSchema = () => {
  const remote: Schema = extendSchema({
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
      Color: enumOfStringsSimple('Red', 'Green'),
    }
  })

  const local: Schema = extendSchema({
    id: 'Example',
    root: ref('Contact'),
    types: {
      Contact: {
        type: 'struct',
        fields: {
          name: {type: 'string', defaultValue: 'Bruce'},
          phoneNo: {type: 'string'},
        }
      },
      Color: enumOfStringsSimple('Green', 'Blue'),
    }
  })

  console.log(mergeSchemas(remote, local))
}

const testSimpleSchemaInference = () => {
  const schema = <SimpleSchema>{
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
        numericOnly: false,
        variants: {
          Line: null,
          Square: {
            associatedData: {
              type: 'struct',
              fields: { x: {type: 'f32'}, y: {type: 'f32'} }
            }
          }
        }
      },

      Color: enumOfStringsSimple('Green', 'Red', 'Purple')
    }
  }

  // console.log('encoding', simpleSchemaEncoding(schema))
  // console.log('js', simpleJsMap(schema))


  console.log(extendSchema(schema))
}

// testMergeSchema()
// testSimpleSchemaInference()
