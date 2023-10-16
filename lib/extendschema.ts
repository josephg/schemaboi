import { AppEnumSchema, AppSchema, AppStructField, AppStructSchema, EnumSchema, EnumVariant, Field, Primitive, SType, Schema } from "./schema.js"
import { canonicalizeType, intEncoding, isInt, isPrimitive } from "./utils.js"

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

type AndAny<T> = T & Record<string, any>
const cloneType = (t: AndAny<SType> | Primitive | string): SType => (
  typeof t === 'string' ? (isPrimitive(t) ? {type: t} : {type: 'ref', key: t})
    : t.type === 'ref' ? {type: 'ref', key: t.key}
    : t.type === 'list' ? {type: 'list', fieldType: canonicalizeType(t.fieldType)}
    : t.type === 'map' ? {
      ...t, // type, encodeEntry and decodeEntry.
      type: 'map',
      keyType: canonicalizeType(t.keyType),
      valType: canonicalizeType(t.valType),
      decodeForm: t.decodeForm ?? 'object',
    }
    : isInt(t) ? { type: t.type, numericEncoding: intEncoding(t), decodeAsBigInt: t.decodeAsBigInt ?? false }
    : { type: t.type }
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

