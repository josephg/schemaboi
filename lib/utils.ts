import { AppEnumSchema, AppStructSchema, EnumSchema, List, MapType, AppSchema, Ref, Schema, SType, Field, EnumVariant, IntPrimitive, WrappedPrimitive, Primitive, AppStructField } from "./schema.js"

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

const mergeMapsAll = <T>(a: Map<string, T> | null | undefined, b: Map<string, T> | null | undefined, mergeFn: (a: T | null, b: T | null) => T): Map<string, T> => {
  const result = new Map<string, T>()
  for (const key of mergedMapKeys(a, b)) {
    const aa = a?.get(key) ?? null
    const bb = b?.get(key) ?? null

    result.set(key, mergeFn(aa, bb))
  }

  return result
}

export const mergedObjKeys = (a: Record<string, any>, b: Record<string, any>): Iterable<string> => (
  new Set([...Object.keys(a), ...Object.keys(b)])
)

const emptyMap: Map<any, any> = new Map()
export const mergedMapKeys = <K>(a: Map<K, any> | null | undefined, b: Map<K, any> | null | undefined): Iterable<K> => (
  // TODO: Remove this list allocation.
  new Set([...(a ?? emptyMap).keys(), ...(b ?? emptyMap).keys()])
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

function mergeFields(remote: Map<string, Field> | undefined, local: Map<string, Field> | undefined): Map<string, Field> {
  // console.log('merge', a, b)
  // Merge them.
  return mergeMapsAll(remote, local, (remoteF, localF): Field => {
    // Check the fields are compatible.
    // if (remoteF && localF && !typesShallowEq(remoteF.type, localF.type)) {
    //   throw Error(`Incompatible types in struct field: '${remoteF.type.type}' != '${localF.type.type}'`)
    // }

    return {
      type: localF == null ? remoteF!.type
        : remoteF == null ? localF!.type
        : mergeTypes(remoteF.type, localF.type),
      defaultValue: localF?.defaultValue,
      foreign: localF ? (localF.foreign ?? false) : true,
      renameFieldTo: localF?.renameFieldTo,
      inline: remoteF ? (remoteF.inline ?? false) : (localF!.inline ?? false),

      // TODO: This makes sense for *reading* merged data, but it won't let us write.
      skip: remoteF ? (remoteF.skip ?? false) : true,
      optional: remoteF ? remoteF.optional : (localF!.optional ?? false), // If remoteF is null, this field doesn't matter.
      // encoding: remoteF?.encoding ?? 'unused',
    }
  })
}

function mergeEnums(remote: EnumSchema, local: EnumSchema): EnumSchema {
  // I would use mergeObjects from above, but if one (or both) of the enums is exhaustive, we need to make sure
  // fields aren't added when they aren't valid.

  if (local.numericOnly && !remote.numericOnly) {
    // TODO: Not sure what to do in this case.
    console.warn("numericOnly does not match. Remote schema may include associated data.")
  }

  const result: EnumSchema = {
    foreign: local.foreign ?? false,
    exhaustive: remote.exhaustive || local.exhaustive,
    numericOnly: local.numericOnly,
    typeFieldOnParent: local.typeFieldOnParent,
    localStructIsVariant: local.localStructIsVariant,
    encode: local.encode ?? undefined,
    decode: local.decode ?? undefined,
    variants: new Map(),
  }

  for (const key of mergedMapKeys(remote.variants, local.variants)) {
    const remoteV = remote.variants.get(key)
    const localV = local.variants.get(key)

    if (remoteV == null && remote.exhaustive) throw Error('Cannot merge enums: Cannot add variant to exhaustive enum')
    if (localV == null && local.exhaustive) throw Error('Cannot merge enums: Cannot add variant to exhaustive enum')

    result.variants.set(key, remoteV == null ? { foreign: false, ...localV }
      : localV == null ? { ...remoteV, foreign: true } // TODO: Recursively set foreign flag in associated data.
      : {
          foreign: localV.foreign ?? false,
          encode: localV.encode,
          decode: localV.decode,
          fields: mergeFields(remoteV.fields, localV.fields),
        }
    )
  }

  return result
}


function mergeTypes(remote: SType | string, local: SType | string): SType {
  remote = canonicalizeType(remote)
  local = canonicalizeType(local)

  if (!typesShallowEq(remote, local)) throw Error('Cannot merge disperate types')

  if (isInt(remote)) {
    return {
      type: remote.type,
      numericEncoding: intEncoding(remote),
      decodeAsBigInt: (local as IntPrimitive).decodeAsBigInt ?? false
    }
  } else if (remote.type === 'list') {
    return {type: 'list', fieldType: mergeTypes(remote.fieldType, (local as List).fieldType) }
  } else if (remote.type === 'map') {
    const l = local as MapType
    return {
      type: 'map',
      keyType: mergeTypes(remote.keyType, l.keyType),
      valType: mergeTypes(remote.valType, l.valType),
      decodeForm: l.decodeForm ?? 'object'
    }
  } else {
    // For refs and simple primitives, we have nothing more to do here.
    return remote
  }
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

  return {
    id: local.id,

    // Ehhh this is a bit of a mess.
    // - If they're both set, try to merge.
    // - If neither is set, leave it null.
    // Changing the default root type in a document isn't supported.
    root: (remote.root == null && local.root == null) ? undefined
      : (remote.root != null && local.root != null) ? mergeTypes(remote.root, local.root)
      : (remote.root ?? local.root), // Or take which ever is set.

    types: mergeObjectsAll(remote.types, local.types, (rem, loc): EnumSchema => {
      if (rem == null) return loc!
      if (loc == null) return {
        // TODO: This is a dangerous pattern. Are you sure all the fields are set right here?
        ...rem,
        foreign: true,
      }

      return mergeEnums(rem, loc)
    })
  }
}

type AndAny<T> = T & Record<string, any>
const cloneType = (t: AndAny<SType> | Primitive | string): SType => (
  typeof t === 'string' ? (isPrimitive(t) ? {type: t} : {type: 'ref', key: t})
    : t.type === 'ref' ? {type: 'ref', key: t.key}
    : t.type === 'list' ? {type: 'list', fieldType: canonicalizeType(t.fieldType)}
    : t.type === 'map' ? {
      type: 'map',
      keyType: canonicalizeType(t.keyType),
      valType: canonicalizeType(t.valType),
      decodeForm: t.decodeForm ?? 'object'
    }
    : isInt(t) ? { type: t.type, numericEncoding: intEncoding(t), decodeAsBigInt: t.decodeAsBigInt ?? false }
    : { type: t.type }
)

export const canonicalizeType = (t: AndAny<SType> | Primitive | string): SType => (
  typeof t === 'object'
    ? t
    : (isPrimitive(t) ? {type: t} : {type: 'ref', key: t})
)

// This function is a mess, but its only used in one place (below) and there its fine??
const getType = (t: SType | Primitive | string): string => (
  typeof t === 'object' ? t.type : t
)

function extendField(f: AppStructField): Field {
  // console.log('extendField', f, cloneType(f))
  return {
    type: cloneType(f),
    defaultValue: f.defaultValue,
    inline: getType(f) === 'bool' ? true : false, // Inline booleans.
    optional: f.optional ?? false,
    skip: f.skip ?? false,
    // encoding: f.optional ? 'optional' : 'required',
    renameFieldTo: f.renameFieldTo,
  }
}

function structToEnumVariant(s: AppStructSchema): EnumVariant {
  return {
    encode: s.encode,
    decode: s.decode,
    fields: objMapToMap(s.fields, f => extendField(canonicalizeType(f))),
  }
}

function extendStruct(s: AppStructSchema): EnumSchema {
  return {
    foreign: false,
    exhaustive: false,
    numericOnly: false,

    localStructIsVariant: 'Default', // TODO: ??

    variants: new Map([['Default', structToEnumVariant(s)]]),
  }
}

function extendEnum(s: AppEnumSchema): EnumSchema {
  const variants = Array.isArray(s.variants) ? new Map(s.variants.map((s): [string, EnumVariant] => [s, {}]))
    : objMapToMap(s.variants, (v): EnumVariant => (
      (v == null || v === true) ? {}
        : structToEnumVariant(v) // 'fields' in v.
    ))

  return {
    exhaustive: s.exhaustive ?? false,
    numericOnly: s.numericOnly ?? false,
    typeFieldOnParent: s.typeFieldOnParent,
    encode: s.encode,
    decode: s.decode,
    variants,
  }
}

export function extendSchema(schema: AppSchema): Schema {
  return {
    id: schema.id,
    root: schema.root ? canonicalizeType(schema.root) : undefined,
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
      return typesShallowEq(canonicalizeType(a.fieldType), canonicalizeType((b as List).fieldType))
    case 'map':
      const bb = b as MapType
      return typesShallowEq(canonicalizeType(a.keyType), canonicalizeType(bb.keyType))
        && typesShallowEq(canonicalizeType(a.valType), canonicalizeType(bb.valType))
    default: return true // They'd better be primitives!

    // Other cases (when added) will generate a type error.
  }
}

export const enumOfStrings = (...variants: string[]): AppEnumSchema => ({
  type: 'enum',
  exhaustive: false,
  numericOnly: true,
  variants: Object.fromEntries(variants.map(v => [v, null]))
})

export const enumOfStringsEncoding = (...variants: string[]): EnumSchema => ({
  exhaustive: false,
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
  [...e.variants.keys()]
  // [...
  //   mapIter(
  //     filterIter(e.variants.entries(), ([_k, v]) => !v.skip),
  //     ([k]) => k)
  // ]
)



const fillSTypeDefaults = (t: SType) => {
  if (t.type === 'map') {
    t.decodeForm ??= 'object'
    t.valType = canonicalizeType(t.valType)
    fillSTypeDefaults(t.valType)
  } else if (t.type === 'list') {
    t.fieldType = canonicalizeType(t.fieldType)
    fillSTypeDefaults(t.fieldType)
  } else if (isInt(t)) {
    t.decodeAsBigInt ??= false
    t.numericEncoding ??= intEncoding(t)
  }
}

// const fillStructDefaults = (s: StructSchema, foreign: boolean) => {
//   s.foreign ??= foreign
//   s.encode ??= undefined
//   s.decode ??= undefined
//   for (const field of s.fields.values()) {
//     fillSTypeDefaults(field.type)
//     field.defaultValue ??= undefined // ??
//     field.foreign ??= foreign
//     field.renameFieldTo ??= undefined // ???
//     field.inline ??= false
//     field.skip ??= false
//     field.optional ??= false
//   }
// }
const fillFieldDefaults = (fields: Map<string, Field>, foreign: boolean) => {
  for (const field of fields.values()) {
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
  s.encode ??= undefined
  s.decode ??= undefined
  s.localStructIsVariant ??= undefined
  s.numericOnly ??= false
  for (const variant of s.variants.values()) {
    variant.foreign ??= foreign
    // variant.skip ??= false
    variant.encode ??= undefined
    variant.decode ??= undefined

    variant.fields ??= new Map()
    fillFieldDefaults(variant.fields, foreign)
  }
}

/** Modifies the schema in-place! */
export function fillSchemaDefaults(s: Schema, foreign: boolean): Schema {
  if (s.root) fillSTypeDefaults(s.root)
  for (const k in s.types) {
    fillEnumDefaults(s.types[k], foreign)
  }
  return s
}

/** This is a dirty hack for when we want to use a file's schema to read it "raw"
 */
export function setEverythingLocal(s: Schema) {
  for (const k in s.types) {
    const t = s.types[k]
    t.foreign = false
    for (const v of t.variants.values()) {
      v.foreign = false
      if (v.fields) {
        for (const f of v.fields.values()) {
          f.foreign = false
        }
      }
    }
  }
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



export const prim = (primType: Primitive): WrappedPrimitive | IntPrimitive => {
  if (!isPrimitive(primType)) throw Error('prim() called with non-primitive type: ' + primType)
  return {type: primType}
}
export const String: SType = prim('string')
export const Id: SType = prim('id')
export const Bool: SType = prim('bool')
export const ref = (key: string): Ref => ({type: 'ref', key})
export const list = (fieldType: SType | string): List => (
  { type: 'list', fieldType: canonicalizeType(fieldType) }
)
export const map = (keyType: SType | string, valType: SType | string, decodeForm?: 'object' | 'map' | 'entryList'): MapType => ({
  type: 'map',
  keyType: canonicalizeType(keyType),
  valType: canonicalizeType(valType),
  decodeForm,
})


export const intEncoding = (num: IntPrimitive): 'le' | 'varint' => (
  num.numericEncoding ?? ((num.type === 'u8' || num.type === 's8') ? 'le' : 'varint')
)


export function structSchema(fields: [string, Field][], extras?: any): EnumSchema {
  return {
    exhaustive: false,
    numericOnly: false,
    localStructIsVariant: 'Default',
    variants: new Map<string, EnumVariant>([['Default', {
      foreign: false,
      fields: new Map(fields)
    }]]),
    ...extras,
  }
}

export const chooseRootType = (schema: Schema, reqType?: string | SType): SType => {
  let rootType = reqType ?? schema.root
  if (rootType == null) throw Error('Schema has no root type. You must specify which type from the schema you are loading')

  rootType = canonicalizeType(rootType) // If the requested root type is specified as a string, extend it.

  if (rootType.type === 'ref' && schema.types[rootType.key] == null) {
     throw Error(`Schema is missing requested type '${rootType.key}'`)
  }

  return rootType
}