import { AppEnumSchema, AppStructSchema, EnumSchema, List, MapType, AppSchema, Ref, Schema, StructSchema, SType, StructField, EnumVariant, StructOrEnum, IntPrimitive, WrappedPrimitive, Primitive } from "./schema.js"

// import {Console} from 'node:console'
// const console = new Console({
//   stdout: process.stdout,
//   stderr: process.stderr,
//   inspectOptions: {depth: null}
// })

export const assert = (a: boolean, msg?: string) => {
  if (!a) throw Error(msg ?? 'Assertion failed')
}

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
    foreign: local.foreign ?? false,
    encode: local.encode,
    decode: local.decode,

    fields: mergeMapsAll(remote.fields, local.fields, (remoteF, localF): StructField => {
      // Check the fields are compatible.
      if (remoteF && localF && !typesShallowEq(remoteF.type, localF.type)) {
        throw Error(`Incompatible types in struct field: '${remoteF.type.type}' != '${localF.type.type}'`)
      }

      return {
        type: localF?.type ?? remoteF!.type,
        defaultValue: localF?.defaultValue,
        foreign: localF ? (localF.foreign ?? false) : true,
        renameFieldTo: localF?.renameFieldTo,
        inline: remoteF ? (remoteF.inline ?? false) : (localF!.inline ?? false),

        // TODO: This makes sense for *reading* merged data, but it won't let us write.
        skip: remoteF ? (remoteF.skip ?? false) : true,
        optional: remoteF ? remoteF.optional : (localF!.optional ?? false), // If remoteF is null, this field doesn't matter.
        // encoding: remoteF?.encoding ?? 'unused',

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
    closed: remote.closed || local.closed,
    numericOnly: local.numericOnly,
    typeFieldOnParent: local.typeFieldOnParent,
    variants: new Map,
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
    root: remote.root,
    types: mergeObjectsAll(remote.types, local.types, (aa, bb): StructOrEnum => {
      if (aa == null) return bb!
      if (bb == null) return {
        ...aa,
        foreign: true,
      }

      if (aa.type !== bb.type) throw Error(`Cannot merge ${aa.type} with ${bb.type}`) // enums and structs can't mix.

      if (aa.type === 'struct') {
        // Gross allocation.
        return { type: 'struct', ... mergeStructs(aa, bb as StructSchema) }
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

const extendType = (t: SType | Primitive): SType => (
  typeof t === 'object' ? t : {type: t}
)

const getType = (t: SType | Primitive): SType['type'] => (
  typeof t === 'object' ? t.type : t
)

function extendStruct(s: AppStructSchema): StructSchema & {type: 'struct'} {
  return {
    type: 'struct',
    fields: objMapToMap(s.fields, f => ({
      type: extendType(f.type),
      defaultValue: f.defaultValue,
      inline: getType(f.type) === 'bool' ? true : false, // Inline booleans.
      optional: f.optional ?? false,
      skip: false,
      // encoding: f.optional ? 'optional' : 'required',
      renameFieldTo: f.renameFieldTo,
    })),
    // encodingOrder: Object.keys(s.fields),
  }
}

function extendEnum(s: AppEnumSchema): EnumSchema {
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

export function extendSchema(schema: AppSchema): Schema {
  return {
    id: schema.id,
    root: extendType(schema.root),
    types: objMap(schema.types, s => (
      s.type === 'enum' ? extendEnum(s) : extendStruct(s)
    ))
  }
}





export const isRef = (x: SType): x is {type: 'ref', key: string} => (
  typeof x !== 'string' && x.type === 'ref'
)

export const typesShallowEq = (a: SType, b: SType): boolean => {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'ref':
      return a.key === (b as Ref).key
    case 'list':
      return typesShallowEq(a.fieldType, (b as List).fieldType)
    case 'map':
      const bb = b as MapType
      return typesShallowEq(a.keyType, bb.keyType) && typesShallowEq(a.valType, bb.valType)
    default: return true // They'd better be primitives!

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

export const enumOfStringsSimple = (...variants: string[]): AppEnumSchema => ({
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



const fillSTypeDefaults = (t: SType) => {
  if (t.type === 'map') {
    t.decodeForm ??= 'object'
    fillSTypeDefaults(t.valType)
  } else if (t.type === 'list') {
    fillSTypeDefaults(t.fieldType)
  } else if (isInt(t)) {
    t.decodeAsBigInt ??= false
    t.numericEncoding ??= intEncoding(t)
  }
}

const fillStructDefaults = (s: StructSchema, foreign: boolean) => {
  s.foreign ??= foreign
  s.encode ??= undefined
  s.decode ??= undefined
  for (const field of s.fields.values()) {
    fillSTypeDefaults(field.type)
    field.defaultValue ??= undefined // ??
    field.foreign ??= foreign
    field.renameFieldTo ??= undefined // ???
    field.inline ??= false
    field.skip ??= false
    field.optional ??= false
  }
}

const fillEnumDefaults = (s: EnumSchema, foreign: boolean) => {
  s.foreign ??= foreign
  s.typeFieldOnParent ??= undefined
  for (const variant of s.variants.values()) {
    variant.associatedData ??= undefined
    variant.foreign ??= foreign
    variant.skip ??= false

    if (variant.associatedData) {
      fillStructDefaults(variant.associatedData, foreign)
    }
  }
}

/** Modifies the schema in-place! */
export function fillSchemaDefaults(s: Schema, foreign: boolean): Schema {
  fillSTypeDefaults(s.root)
  for (const k in s.types) {
    const t = s.types[k]
    switch (t.type) {
      case 'enum': fillEnumDefaults(t, foreign); break
      case 'struct': fillStructDefaults(t, foreign); break
      default: const x: never = t
    }
  }
  return s
}

export const primitiveTypes: Primitive[] = [
  'bool',
  'u8', 'u16', 'u32', 'u64', 'u128',
  's8', 's16', 's32', 's64', 's128',
  'f32', 'f64',
  'string', 'binary', 'id',
]

export const isPrimitive = (s: string): s is Primitive => (
  (primitiveTypes as string[]).indexOf(s) >= 0
)

export const intTypes: IntPrimitive["type"][] = [
  'u8', 'u16', 'u32', 'u64', 'u128',
  's8', 's16', 's32', 's64', 's128',
]

export const isInt = (s: SType): s is IntPrimitive => (
  (intTypes as string[]).indexOf(s.type) >= 0
)
// export const isInt = (s: string): s is IntPrimitive["type"] => (
//   (intTypes as string[]).indexOf(s) >= 0
// )



export const prim = (inner: Primitive): SType => ({type: inner})
export const String: SType = prim('string')
export const Id: SType = prim('id')
export const Bool: SType = prim('bool')


export const intEncoding = (num: IntPrimitive): 'le' | 'varint' => (
  num.numericEncoding ?? ((num.type === 'u8' || num.type === 's8') ? 'le' : 'varint')
)