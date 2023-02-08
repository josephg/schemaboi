
/* TODO:

- ~Struct~
- ~List~
- Enum
- Map

*/


export type Primitive = 'uint' | 'sint' | 'f32' | 'f64' | 'bool' | 'string' | 'binary' | 'id'

export type Ref = {type: 'ref', key: string} // Reference to another type in the type oracle
export type List = {type: 'list', fieldType: SType}
export type SType = Primitive | Ref | List

export interface StructSchema {
  type: 'struct'
  fields: Record<string, {
    type: SType,
  }>
  // default?
}

export type Oracle = Record<string, StructSchema>
export interface Schema {
  id: string,
  root: SType
  types: Oracle
  // types: Record<string, Struct | Enum>
}


// *** File to schema mapping ***

export interface StructEncoding {
  // Any fields not listed here are not included in the file data, and should be null, default or error.
  //
  // The order here is important. Fields are listed in the order that their data is written to the file.
  //
  // TODO: Bit pack adjacent booleans.
  fieldOrder: string[],
  optionalOrder: string[],
}

export interface SchemaEncoding {
  id: string,
  types: Record<string, StructEncoding>
}



// *** Schema to javascript mapping ***

export interface StructToJS {
  fields: Record<string, {
    defaultValue?: any, // If the field is missing in the data set, use this value instead of null.
    fieldName?: string, // Overrides the field's key name in schema
  }>
}

export interface SchemaToJS {
  id: string,
  // TODO.
  types: Record<string, StructToJS>
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
