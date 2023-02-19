
/*

- Packed bit fields
- Ignored fields (toJS)
- Mapping & read / write visitors
- Metaschema 2.0

*/

export type Primitive = 'uint' | 'sint' | 'f32' | 'f64' | 'bool' | 'string' | 'binary' | 'id'

export type Ref = {type: 'ref', key: string} // Reference to another type in the type oracle
export type List = {type: 'list', fieldType: SType}
export interface MapType { // MapType rather than Map because Map is the name of a builtin type.
  type: 'map',
  keyType: Primitive
  valType: SType
}
export type SType = Primitive | Ref | List | MapType

// export type MapEncoding<T> = {
//   fromEntries: (entries: [any, any][]) => T,
//   toEntries: (data: T) => [any, any][],
// }

export interface StructSchema {
  type: 'struct',

  /** Is the struct locally known / referenced? */
  mappedToJS: boolean,

  fields: Record<string, {
    type: SType, // Schema type

    /** If the field is missing in the data set, use this value instead of null when decoding. */
    defaultValue?: any,

    optional: boolean,
    mappedToJS: boolean,
    renameFieldTo?: string,

    // encodeMap?: MapEncoding<any>
  }>,

  encodingOrder: string[],
}

export interface EnumSchema {
  type: 'enum',

  mappedToJS: boolean,

  closed: boolean,
  numericOnly: boolean,

  variants: Record<string, {
    // renameFieldTo?: string,
    associatedData?: StructSchema,
    mappedToJS: boolean,
  }>,

  encodingOrder: string[],
}

export interface Schema {
  id: string,
  root: SType, // TODO: Consider making the optional.
  types: Record<string, StructSchema | EnumSchema>
}



// *****************

/**
 * This is the stuff you need to define to make a type. It can be extended to a
 * full schema (with encoding information) via utility methods.
 */
export interface SimpleSchema {
  id: string,
  root: SType, // TODO: Consider making this optional.
  types: Record<string, SimpleStructSchema | SimpleEnumSchema>
}

export interface SimpleStructSchema {
  type: 'struct',

  fields: Record<string, {
    type: SType, // Schema type

    /** If the field is missing in the data set, use this value instead of null when decoding. */
    defaultValue?: any,
    optional?: boolean,
    // renameFieldTo?: string,
  }>,
}

export interface SimpleEnumSchema {
  type: 'enum',

  closed?: boolean,
  numericOnly: boolean,

  variants: Record<string, {
    // renameFieldTo?: string,
    associatedData?: SimpleStructSchema,
  } | null>,
}


export type EnumObject = string
  | {type: string, [k: string]: any}
  | {type: '_unknown', data: {type: string, [k: string]: any}}
