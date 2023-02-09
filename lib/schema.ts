
/* TODO:

- ~Struct~
- ~List~
- ~Enum~
- Map
- Ignored fields (toJS)
- Mapping & read / write visitors

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

export interface StructPureSchema {
  type: 'struct'
  fields: Record<string, {
    type: SType,

    [k: string]: any
  }>

  [k: string]: any
  // default?
}

export interface EnumPureSchema {
  type: 'enum',
  // closed: boolean,
  variants: Record<string, {
    associatedData?: StructPureSchema
  }>

  [k: string]: any
}

export interface PureSchema {
  id: string,
  root: SType
  types: Record<string, StructPureSchema | EnumPureSchema>
}

export type Schema = PureSchema & SchemaEncoding & SchemaToJS
export type StructSchema = StructPureSchema & StructEncoding & StructToJS
export type EnumSchema = EnumPureSchema & EnumEncoding & EnumToJS

export type EnumObject = string | {type: string, [k: string]: any}

// *** File to schema mapping ***

export interface StructEncoding {
  type: 'struct',
  // Any fields not listed here are not included in the file data, and should be null, default or error.
  //
  // The order here is important. Fields are listed in the order that their data is written to the file.
  //
  // TODO: Bit pack adjacent booleans.
  fieldOrder: string[],
  optionalOrder: string[],

  [k: string]: any
}

export interface EnumEncoding {
  type: 'enum',
  variantOrder: string[],
  variants: Record<string, {
    associatedData?: StructEncoding
  }>
  [k: string]: any
}

export interface SchemaEncoding {
  id: string,
  types: Record<string, StructEncoding | EnumEncoding>
}

// *** Schema to javascript mapping ***

export interface StructToJS {
  type: 'struct',
  known: boolean,
  fields: Record<string, {
    known: boolean,
    defaultValue?: any, // If the field is missing in the data set, use this value instead of null.
    renameFieldTo?: string, // Overrides the field's key name in schema

    [k: string]: any
  }>

  [k: string]: any
}

export interface EnumToJS {
  type: 'enum',
  variants: Record<string, {
    // known: boolean
    associatedData?: StructToJS
  }>

  // typeOnParent
  // useStringsWhenNoFields
  // {type: foo, ...} or {foo: {...}} or whatever.

  [k: string]: any
}

export interface SchemaToJS {
  id: string,
  // TODO.
  types: Record<string, StructToJS | EnumToJS>
}



// export const enumOfStrings = (strings: string[]): Enum => ({
//   type: 'enum',
//   variants: strings.map(s => ({key: s}))
// })

export const ref = (key: string): {type: 'ref', key: string} => ({type: 'ref', key})


// export const metaSchema: Schema = {
//   id: '_sbmeta',
//   root: ref('Schema'),

//   types: {
//     Schema: {
//       type: 'struct',
//       encodeOptional: 'none',
//       fields: [
//         {key: 'id', valType: 'string'},
//         {key: 'root', valType: ref('SType')},
//         {key: 'types', valType: {
//           type: 'map',
//           keyType: 'string',
//           valType: ref('SType')}
//         },
//       ]
//     },

//     Ref: {
//       type: 'struct',
//       encodeOptional: 'none',
//       fields: [
//         // {key: 'type', valType: 'string', localOnly: true},
//         {key: 'key', valType: 'string'},
//       ]
//     },

//     EnumVariant: {
//       type: 'struct',
//       encodeOptional: 'bitfield',
//       fields: [
//         {key: 'key', valType: 'string'},
//         {key: 'associatedData', valType: {
//           type: 'enum',
//           variants: [
//             {key: 'struct', associatedData: ref('Struct')},
//             {key: 'ref', associatedData: {
//               type: 'struct',
//               encodeOptional: 'bitfield',
//               fields: [
//                 {key: 'key', valType: 'string'},
//               ]
//             }},
//           ]
//         }}
//       ]
//     },

//     Enum: {
//       type: 'struct',
//       encodeOptional: 'none',
//       fields: [
//         // Upsettingly, this still shows up in the binary encoding of metaSchema.
//         {key: 'typeOnParent', valType: 'bool', localOnly: true},
//         // {key: 'type', valType: 'string', localOnly: true},
//         {key: 'variants', valType: {type: 'list', fieldType: ref('EnumVariant')}}
//       ]
//     },

//     Struct: {
//       type: 'struct',
//       encodeOptional: 'bitfield',
//       fields: [
//         // {key: 'type', valType: 'string', localOnly: true}, // For now!
//         {key: 'fields', valType: {type: 'list', fieldType: ref('Field')}},
//         {key: 'encodeOptional', valType: enumOfStrings(['bitfield', 'none'])}
//       ]
//     },

//     Field: {
//       type: 'struct',
//       encodeOptional: 'bitfield',
//       fields: [
//         {key: 'key', valType: 'string'},
//         {key: 'valType', valType: ref('SType')},
//         //  TODO: Default!
//         {key: 'encodeMissingAsDefault', valType: 'bool'},
//         {key: 'localOnly', valType: 'bool', localOnly: true}, // Quite funny!
//       ]
//     },

//     Map: {
//       type: 'struct',
//       encodeOptional: 'none',
//       fields: [
//         {key: 'keyType', valType: enumOfStrings(['uint', 'sint', 'f32', 'f64', 'bool', 'string', 'binary'])},
//         {key: 'valType', valType: ref('SType')}
//       ]
//     },

//     SType: {
//       type: 'enum',
//       variants: [
//         {key: 'uint'},
//         {key: 'sint'},
//         {key: 'f32'},
//         {key: 'f64'},
//         {key: 'bool'},
//         {key: 'string'},
//         {key: 'id'},
//         {key: 'binary'},
//         {key: 'list', associatedData: {
//           type: 'struct',
//           encodeOptional: 'none',
//           fields: [
//             {key: 'fieldType', valType: ref('SType')} // Recursive.
//           ]
//         }},

//         {key: 'ref', associatedData: {
//           type: 'struct',
//           encodeOptional: 'bitfield',
//           fields: [{key: 'key', valType: 'string'}]
//         }},
//         {key: 'struct', associatedData: ref('Struct')},
//         {key: 'enum', associatedData: ref('Enum')},
//         {key: 'map', associatedData: ref('Map')},
//       ]
//     }
//   }
// }
