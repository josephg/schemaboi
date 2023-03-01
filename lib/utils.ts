import { SimpleEnumSchema, SimpleStructSchema, EnumSchema, List, MapType, SimpleSchema, Ref, Schema, StructSchema, SType, StructField, EnumVariant } from "./schema.js"

import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

const mergeObjects = <T>(a: Record<string, T>, b: Record<string, T>, mergeFn: (a: T, b: T) => T): Record<string, T> => {
  const result: Record<string, T> = {}
  for (const key of mergedObjKeys(a, b)) {
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
  for (const key of mergedObjKeys(a, b)) {
    const aa = a[key] ?? null
    const bb = b[key] ?? null

    result[key] = mergeFn(aa, bb)
  }

  return result
}

const mergeMapsAll = <T>(a: Map<string, T>, b: Map<string, T>, mergeFn: (a: T | null, b: T | null) => T): Map<string, T> => {
  const result = new Map<string, T>()
  for (const key of mergedMapKeys(a, b)) {
    const aa = a.get(key) ?? null
    const bb = b.get(key) ?? null

    result.set(key, mergeFn(aa, bb))
  }

  return result
}

export const mergedObjKeys = (a: Record<string, any>, b: Record<string, any>): Iterable<string> => (
  new Set([...Object.keys(a), ...Object.keys(b)])
)

export const mergedMapKeys = <K>(a: Map<K, any>, b: Map<K, any>): Iterable<K> => (
  // TODO: Remove this list allocation.
  new Set([...a.keys(), ...b.keys()])
)

const objMap = <A, B>(obj: Record<string, A>, mapFn: (a: A, key: string) => B): Record<string, B> => {
  const result: Record<string, B> = {}
  for (const k in obj) {
    result[k] = mapFn(obj[k], k)
  }
  return result
}

const objMapToMap = <A, B>(obj: Record<string, A> | Map<string, A>, mapFn: (a: A, key: string) => B): Map<string, B> => {
  const result: Map<string, B> = new Map()
  if (obj instanceof Map) {
    for (const [k, v] of obj.entries()) {
      result.set(k, mapFn(v, k))
    }
  } else {
    for (const k in obj) {
      result.set(k, mapFn(obj[k], k))
    }
  }
  return result
}

function mergeStructs(remote: StructSchema, local: StructSchema): StructSchema {
  // console.log('merge', a, b)
  // Merge them.
  return {
    type: 'struct',
    foreign: local.foreign ?? false,
    fields: mergeMapsAll(remote.fields, local.fields, (remoteF, localF): StructField => {
      // Check the fields are compatible.
      if (remoteF && localF && !typesShallowEq(remoteF.type, localF.type)) {
        throw Error('Incompatible types in struct field')
      }

      return {
        type: localF?.type ?? remoteF!.type,
        foreign: localF ? (localF.foreign ?? false) : true,
        defaultValue: localF?.defaultValue,
        // optional: remoteF?.optional ?? true, // A field being optional is part of the encoding.
        // mappedToJS: localF?.foreign ?? true,

        // TODO: This makes sense for *reading* merged data, but it won't let us write.
        skip: remoteF ? (remoteF.skip ?? false) : true,
        optional: remoteF ? remoteF.optional : false, // If remoteF is null, this field doesn't matter.
        // encoding: remoteF?.encoding ?? 'unused',

        renameFieldTo: localF?.renameFieldTo,
      }
    }),
    // encodingOrder: remote.encodingOrder,
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
    variants: new Map,
    // encodingOrder: remote.encodingOrder,
  }

  for (const key of mergedMapKeys(remote.variants, local.variants)) {
    const remoteV = remote.variants.get(key)
    const localV = local.variants.get(key)

    if (remoteV == null && remote.closed) throw Error('Cannot merge enums: Cannot add variant to closed enum')
    if (localV == null && local.closed) throw Error('Cannot merge enums: Cannot add variant to closed enum')

    result.variants.set(key, remoteV == null ? { foreign: false, ...localV, skip: true }
      : localV == null ? { ...remoteV, foreign: true } // TODO: Recursively set foreign flag in associated data.
      : {
          foreign: localV.foreign ?? false,
          skip: remoteV.skip ?? false,
          associatedData: remoteV.associatedData == null ? localV.associatedData
            : localV.associatedData == null ? remoteV.associatedData
            : mergeStructs(remoteV.associatedData, localV.associatedData)
        }
    )
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
    fields: objMapToMap(s.fields, f => ({
      type: f.type,
      defaultValue: f.defaultValue,
      inline: f.type === 'bool' ? true : false, // Inline booleans.
      optional: f.optional ?? false,
      skip: false,
      // encoding: f.optional ? 'optional' : 'required',
      renameFieldTo: f.renameFieldTo,
    })),
    // encodingOrder: Object.keys(s.fields),
  }
}

function extendEnum(s: SimpleEnumSchema): EnumSchema {
  return {
    type: 'enum',
    closed: s.closed ?? false,
    numericOnly: s.numericOnly,
    typeFieldOnParent: s.typeFieldOnParent,
    variants: objMapToMap(s.variants, (v): EnumVariant => ({
      associatedData: v?.associatedData != null ? extendStruct(v.associatedData) : undefined,
      skip: false,
    })),
    // encodingOrder: Object.keys(s.variants)
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
  variants: new Map(variants.map(v => [v, {}])),
  // encodingOrder: variants,
})

export function *filterIter<V>(iter: IterableIterator<V>, pred: (v: V) => boolean): IterableIterator<V> {
  for (const v of iter) {
    if (pred(v)) yield v
  }
}

export function *mapIter<A, B>(iter: IterableIterator<A>, mapFn: (v: A) => B): IterableIterator<B> {
  for (const a of iter) {
    yield mapFn(a)
  }
}

// export function countIter<V>(iter: IterableIterator<V>): number {
//   let count = 0
//   for (const _v of iter) count += 1
//   return count
// }
// export function countMatching<V>(iter: IterableIterator<V>, pred: (v: V) => boolean): number {
//   let count = 0
//   for (const v of iter) if (pred(v)) count += 1
//   return count
// }

// export function any<V>(iter: IterableIterator<V>, pred: (v: V) => boolean): boolean {
//   for (const v of iter) {
//     if (pred(v)) return true
//   }
//   return false
// }

// export function firstIndexOf<V>(iter: IterableIterator<V>, pred: (v: V) => boolean): number {
//   let i = 0;
//   for (const v of iter) {
//     if (pred(v)) return i
//     ++i
//   }
//   return -1
// }

// export const hasOptionalFields = (s: StructSchema): boolean => (
//   // Could be more efficient, but eh.
//   any(s.fields.values(), v => v.encoding === 'optional')
// )

// export const hasAssociatedData = (s: StructSchema | null | undefined): boolean => (
//   s == null
//     ? false
//     : any(s.fields.values(), f => f.encoding !== "unused")
// )

export const enumVariantsInUse = (e: EnumSchema): string[] => (
  [...
    mapIter(
      filterIter(e.variants.entries(), ([_k, v]) => !v.skip),
      ([k]) => k)
  ]
)
