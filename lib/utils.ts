import { List, Oracle, PureSchema, Ref, ref, Schema, SchemaEncoding, SchemaToJS, StructEncoding, StructPureSchema, StructToJS, SType } from "./schema.js"

function mergeStructs(a: StructPureSchema, b: StructPureSchema): StructPureSchema {
  console.log('merge', a, b)
  // Merge them.
  const out: StructPureSchema = {
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

export function mergeSchemas(a: PureSchema | Schema, b: PureSchema | Schema): PureSchema {
  if (a.id != b.id) throw Error('Incompatible schemas')
  if (!typesShallowEq(a.root, b.root)) throw Error('Incompatible root elements')

  // I'm going to use A's naming system. (Its possible for both schemas to use different type names).
  //
  // And I'm going to copy all types from both schemas.
  const out: PureSchema = {
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


/** This function generates a trivial schema encoding for the specified schema. It will not be optimized */
export function simpleSchemaEncoding(schema: Schema | PureSchema): SchemaEncoding {
  const result: SchemaEncoding = {
    id: schema.id,
    types: {}
  }

  for (const k in schema.types) {
    const schemaType = schema.types[k]
    const fields = Object.keys(schemaType.fields)
    result.types[k] = {
      fieldOrder: fields,
      optionalOrder: fields,
    }
  }

  return result
}

/** The resulting JS map assumes we know all fields, everything is nullable and nothing is renamed. */
export function simpleJsMap(schema: Schema | PureSchema): SchemaToJS {
  const result: SchemaToJS = {
    id: schema.id,
    types: {}
  }

  for (const name in schema.types) {
    const s = schema.types[name]
    if (s.type === 'struct') {
      const struct: StructToJS = result.types[name] = {
        known: true,
        fields: {}
      }

      for (const f in s.fields) {
        struct.fields[f] = { known: true }
      }
    } else {
      const checkNever: never = s.type
    }
  }

  return result
}

export function combine(schema: PureSchema, encoding: SchemaEncoding, toJs: SchemaToJS): Schema {
  if (schema.id !== encoding.id || encoding.id !== toJs.id) throw Error('Mismatched schemas')

  const result: Schema = {
    id: schema.id,
    root: schema.root,
    types: {}
  }

  for (const name in schema.types) {
    const s = schema.types[name]
    const e = encoding.types[name]
    const j = toJs.types[name] ?? {known: false, fields: {}}
    if (s.type === 'struct') {
      const struct: StructPureSchema & StructEncoding & StructToJS = result.types[name] = {
        type: s.type,
        known: j.known,
        fieldOrder: e.fieldOrder,
        optionalOrder: e.optionalOrder,
        fields: {}
      }

      for (const f in s.fields) {
        struct.fields[f] = {
          ...s.fields[f],
          ...j.fields[f],
        }
      }
    } else {
      const checkNever: never = s.type
    }
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

// testMergeSchema()