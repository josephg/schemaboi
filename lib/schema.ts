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

export interface StructField {
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
   * {_external: {(fields)}}}
   */
  foreign?: boolean,
  renameFieldTo?: string,

  // Is this field be inlined into the bit fields? Currently only supported for booleans.
  inline?: boolean,


  /**
   * Encoding. Skip serializing and deserializing this field. When deserializing the field
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

export interface StructSchema {
  type?: 'struct',

  /** Is the struct locally known / referenced? Defaults to false. */
  foreign?: boolean,

  // These methods, if provided, will be called before reading and after writing to prepare the object
  // for encoding. If used, the schema should express the data *at rest*.
  encode?: (obj: any) => Record<string, any>,
  decode?: (obj: Record<string, any>) => any,

  fields: Map<string, StructField>,
}

export interface EnumVariant {
  // renameFieldTo?: string,
  associatedData?: StructSchema,
  foreign?: boolean, // JS encoding

  /*
   * We need to know the variant number when encoding or decoding, when the variant is
   * known by the storage system.
   *
   * There's a few ways to do that. The "obvious" way would be to add an integer variant number here.
   *
   * But there's two problems with that:
   *
   * 1. It would introduce a way for the data to be invalid, and making invalid states impossible
   *    to represent is generally good design.
   * 2. An integer would take up extra space over the wire. (We could translate back and forth when
   *    encoding and decoding, but I'd rather not do that if I can avoid it).
   *
   * Using a bool here lets us rely on the order in the Map (which is fixed as per
   * the JS spec). Its harder to work with though; which is unfortunately not ideal.
   */
  skip?: boolean, // This enum was not known by the remote peer and will not show up in the bitstream
}

export interface EnumSchema {
  type: 'enum',

  foreign?: boolean,

  exhaustive: boolean,
  numericOnly: boolean,
  typeFieldOnParent?: string,

  encode?: (obj: any) => Record<string, any>,
  decode?: (variant: string, data: Record<string, any> | null) => any,

  variants: Map<string, EnumVariant>,

  // usedVariants?: string[], // TODO: Consider caching this.

  // encodingOrder: string[],
}

export type StructOrEnum = StructSchema & {type: 'struct'} | EnumSchema
export interface Schema {
  id: string,
  root: SType, // TODO: Consider making the optional.
  types: Record<string, StructOrEnum>
}



// *****************

/**
 * This is the stuff you need to define to make a type. It can be extended to a
 * full schema (with encoding information) via utility methods.
 */
export interface AppSchema {
  id: string,
  root: SType | Primitive | string, // TODO: Consider making this optional.
  types: Record<string, AppStructSchema & {type: 'struct'} | AppEnumSchema>
}

// The type is inlined into the struct field to make things way simpler.
export type AppStructField = SType & {
  /** If the field is missing in the data set, use this value instead of null when decoding. */
  defaultValue?: any,
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
