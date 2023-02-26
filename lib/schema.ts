
/*

- Packed bit fields
- Mapping & read / write visitors
- Promoting fields to lists?
- Metaschema 2.0

*/

export type Primitive = 'uint' | 'sint' | 'f32' | 'f64' | 'bool' | 'string' | 'binary' | 'id'

export type Ref = {type: 'ref', key: string} // Reference to another type in the type oracle
export type List = {type: 'list', fieldType: SType}
export interface MapType { // MapType rather than Map because Map is the name of a builtin type.
  type: 'map',
  keyType: Primitive
  valType: SType,
  // asEntryList?: true,
  decodeForm?: 'object' | 'map' | 'entryList'
}
export type SType = Primitive | Ref | List | MapType

// export type MapEncoding<T> = {
//   fromEntries: (entries: [any, any][]) => T,
//   toEntries: (data: T) => [any, any][],
// }

export interface StructSchema {
  type: 'struct',

  /** Is the struct locally known / referenced? */
  foreign?: boolean,

  fields: Record<string, {
    type: SType, // Schema type

    /** If the field is missing in the data set, use this value instead of null when decoding. */
    defaultValue?: any,

    optional: boolean,
    foreign?: boolean,
    renameFieldTo?: string,

    // encodeMap?: MapEncoding<any>
  }>,

  encodingOrder: string[],

  // These methods, if provided, will be called before reading and after writing to prepare the object
  // for encoding. If used, the schema should express the data *at rest*.
  encode?: (obj: any) => Record<string, any>,
  decode?: (obj: Record<string, any>) => any,
}

export interface EnumSchema {
  type: 'enum',

  foreign?: boolean,

  closed: boolean,
  numericOnly: boolean,
  typeFieldOnParent?: string,

  variants: Record<string, {
    // renameFieldTo?: string,
    associatedData?: StructSchema,
    foreign?: boolean,
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
  typeFieldOnParent?: string,

  variants: Record<string, {
    // renameFieldTo?: string,
    associatedData?: SimpleStructSchema,
  } | null>,
}


export type EnumObject = string
  | {type?: string, [k: string]: any}
  | {type: '_unknown', data: {type: string, [k: string]: any}}
