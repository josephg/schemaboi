// export type Primitive = 'f32' | 'f64' | 'bool' | 'string' | 'binary' | 'id'
//   | 'u8' | 'u16' | 'u32' | 'u64' | 'u128'
//   | 's8' | 's16' | 's32' | 's64' | 's128'

export type Ref = {type: 'ref', key: string} // Reference to another type in the type oracle
export type List = {type: 'list', fieldType: SType | string}
export interface MapType { // MapType rather than Map because Map is the name of a builtin type.
  type: 'map',
  keyType: SType | string, // TODO: Consider making key type default to 'string' here in JS land.
  valType: SType | string,
  // asEntryList?: true,
  decodeForm?: 'object' | 'map' | 'entryList' // JS field. defaults to object.
}
export interface WrappedPrimitive {
  type: 'bool' | 'string' | 'binary' | 'id' | 'f32' | 'f64',
}
export interface IntPrimitive {
  type: 'u8' | 'u16' | 'u32' | 'u64' | 'u128'
    | 's8' | 's16' | 's32' | 's64' |'s128',

  // Encoding. If omitted, defaults to little endian for u8/s8 and varint for the rest.
  numericEncoding?: 'le' | 'varint',

  decodeAsBigInt?: boolean // JS encoding.
}
export type Primitive = (WrappedPrimitive | IntPrimitive)['type']

export type SType = WrappedPrimitive | IntPrimitive | Ref | List | MapType

// export type MapEncoding<T> = {
//   fromEntries: (entries: [any, any][]) => T,
//   toEntries: (data: T) => [any, any][],
// }

// export type EncodingStrategy = 'field' | 'optional field' | 'bits'

export interface Field {
  type: SType, // Schema type

  /**
   * A default value. This is a JS encoding field.
   *
   * - When reading, if the field is missing in the stored data, we'll read this value instead.
   *   This essentially forces the field to be required even if its optional or missing in the data.
   * - When writing a required field, the value in JS is allowed to be missing. In that case, we'll
   *   write this value instead. We only do this if encoding is 'required'.
   */
  defaultValue?: any | ((obj: any) => any),

  /**
   * JS: Is this field unknown to the local application? Foreign fields are deserialized in
   * {_foreign: {(fields)}}}
   */
  foreign?: boolean,
  /** Map the external name of this field into a local (application) name */
  renameFieldTo?: string,

  /** Encoding: Is this field be inlined into the bit fields? Currently only supported for booleans. */
  inline?: boolean,


  /**
   * JS: Skip serializing and deserializing this field. When deserializing the field
   * will always be the default value (if specified) or null.
   */
  skip?: boolean,

  /**
   * Encoding. Does this field exist in all serialized objects of this type?
   * Defaults to false - where the field must always be present.
   */
  optional?: boolean,


  // encoding: 'unused' | 'optional' | 'required', // TODO: Maybe rename unused -> skipped?
  // used: boolean, // Or something. Encoding type: missing / optional / required ?

  // encodeMap?: MapEncoding<any>
}

export interface EnumVariant {
  // renameFieldTo?: string,
  // associatedData?: StructSchema,

  /** JS: The variant is unknown to the local application. Defaults to false. */
  foreign?: boolean,

  // JS: These methods, if provided, will be called before reading and after writing to prepare the object
  // for encoding. If used, the schema should express the data *at rest*.
  encode?: (obj: any) => Record<string, any>,
  decode?: (obj: Record<string, any>) => any,

  fields?: Map<string, Field>,
}

export interface EnumSchema {
  // type: 'enum',


  /** JS: The entire type is unknown to the local application. Defaults to false. (TODO: Is this used?? */
  foreign?: boolean,

  /**
   * JS: The enum contains all variants that will ever exist, and it cannot be
   * extended. Exhaustive enums will error if you ever attempt to add more
   * variants via schema merging.
   *
   * Although the exhaustive flag could be considered a local only flag, its still
   * put in the schema file because its important that other applications know the
   * type will & must never be extended.
   *
   * TODO: Mark me as optional.
   */
  exhaustive: boolean,

  /** Encoding: Enum variants do not contain fields - thus they are encoded using numbers. */
  numericOnly: boolean,
  /** JS: The enum's variant name is on the parent object in the specified field */
  typeFieldOnParent?: string,

  /**
   * JS: This is really a struct from the POV of the application. This is the (singleton)
   * enum variant in use.
   *
   * Note we could use the first variant. But if the enum is flattened to a struct
   * (rare), then they might pick one of the other variants to keep.
   */
  localStructIsVariant?: string,

  encode?: (obj: any) => Record<string, any>,
  decode?: (variant: string, data: Record<string, any> | null) => any,

  /** The union of all known schema variants
   *
   * Note the order here matters. The JS spec enforces that the order of items in a Map will be stable.
   * We use this order when encoding items to assign them all an integer tag.
   *
   * We can think of the order of these items as an encoding specific matter. When we merge schemas,
   * the stored (remote) items *always* come before any local items which aren't in the remote schema.
   */
  variants: Map<string, EnumVariant>,


  // usedVariants?: string[], // TODO: Consider caching this.

  // encodingOrder: string[],
}

// export type StructOrEnum = StructSchema & {type: 'struct'} | EnumSchema
export interface Schema {
  id: string,
  root?: SType, // TODO: Make this optional for schemas with no obvious root type.
  types: Record<string, EnumSchema>
}



// *****************

/**
 * This is the stuff you need to define to make a type. It can be extended to a
 * full schema (with encoding information) via utility methods.
 */
export interface AppSchema {
  id: string,
  root?: SType | Primitive | string, // TODO: Consider making this optional.
  types: Record<string, AppStructSchema & {type: 'struct'} | AppEnumSchema>
}

// The type is inlined into the struct field to make things way simpler.
export type AppStructField = SType & {
  /** If the field is missing in the data set, use this value instead of null when decoding. */
  defaultValue?: any,
  skip?: boolean,
  optional?: boolean,
  renameFieldTo?: string,
}

export interface AppStructSchema {
  type?: 'struct',

  encode?: (obj: any) => Record<string, any>,
  decode?: (obj: Record<string, any>) => any,

  // Fields can be specified as complex objects, or simply strings.
  fields: Record<string, AppStructField | Primitive | string>,
}

export interface AppEnumSchema {
  type: 'enum',

  exhaustive?: boolean,
  numericOnly?: boolean,
  typeFieldOnParent?: string,

  encode?: (obj: any) => Record<string, any>,
  decode?: (variant: string, data: Record<string, any> | null) => any,

  variants: Record<string, {
    // renameFieldTo?: string,
    associatedData: AppStructSchema,
  } | {
    // Simpler way to express fields.
    fields: Record<string, AppStructField | Primitive | string>
  } | null | true> | string[], // null or true are both ignored the same.
}

export type EnumObject = string
  | {type?: string, [k: string]: any}
  | {type: '_unknown', data: {type: string, [k: string]: any}}
