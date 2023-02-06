
export type Primitive = 'uint' | 'sint' | 'f32' | 'f64' | 'bool' | 'string' | 'binary' | 'id'

export type SType = Primitive
  | {type: 'list', fieldType: SType}
  | {type: 'ref', key: string} // Reference to another type in the type oracle.
  | Struct
  | Enum
  | MapType


// type OnMissing = 'default' | 'elide'

export interface Field {
  key: string
  // TODO: name.
  valType: SType,
  default?: any,

  /**
   * If true, any time this field is missing from the object being encoded, we encode the field's default value instead.
   *
   * This has no effect when there's no default value for the field.
  */
  encodeMissingAsDefault?: boolean
  // onMissing: OnMissing,

  localOnly?: boolean
}

export interface Struct {
  type: 'struct'
  fields: Field[]
  encodeOptional: 'bitfield' | 'none'
}


export interface EnumVariant {
  key: string
  associatedData?: Struct | {type: 'ref', key: string}
}

export interface Enum {
  type: 'enum'
  typeOnParent?: boolean
  variants: EnumVariant[]
}

export interface MapType { // MapType rather than Map because Map is the name of a builtin type.
  type: 'map',
  keyType: Primitive
  valType: SType
}

export interface Schema {
  id: string,
  root: SType
  types: Record<string, Struct | Enum>
}


export const enumOfStrings = (strings: string[]): Enum => ({
  type: 'enum',
  variants: strings.map(s => ({key: s}))
})

export const ref = (key: string): {type: 'ref', key: string} => ({type: 'ref', key})
export const metaSchema: Schema = {
  id: '_sbmeta',
  root: ref('Schema'),

  types: {
    Schema: {
      type: 'struct',
      encodeOptional: 'none',
      fields: [
        {key: 'id', valType: 'string'},
        {key: 'root', valType: ref('SType')},
        {key: 'types', valType: {
          type: 'map',
          keyType: 'string',
          valType: ref('SType')}
        },
      ]
    },

    Ref: {
      type: 'struct',
      encodeOptional: 'none',
      fields: [
        // {key: 'type', valType: 'string', localOnly: true},
        {key: 'key', valType: 'string'},
      ]
    },

    EnumVariant: {
      type: 'struct',
      encodeOptional: 'bitfield',
      fields: [
        {key: 'key', valType: 'string'},
        {key: 'associatedData', valType: {
          type: 'enum',
          variants: [
            {key: 'struct', associatedData: ref('Struct')},
            {key: 'ref', associatedData: {
              type: 'struct',
              encodeOptional: 'bitfield',
              fields: [
                {key: 'key', valType: 'string'},
              ]
            }},
          ]
        }}
      ]
    },

    Enum: {
      type: 'struct',
      encodeOptional: 'none',
      fields: [
        // Upsettingly, this still shows up in the binary encoding of metaSchema.
        {key: 'typeOnParent', valType: 'bool', localOnly: true},
        // {key: 'type', valType: 'string', localOnly: true},
        {key: 'variants', valType: {type: 'list', fieldType: ref('EnumVariant')}}
      ]
    },

    Struct: {
      type: 'struct',
      encodeOptional: 'bitfield',
      fields: [
        // {key: 'type', valType: 'string', localOnly: true}, // For now!
        {key: 'fields', valType: {type: 'list', fieldType: ref('Field')}},
        {key: 'encodeOptional', valType: enumOfStrings(['bitfield', 'none'])}
      ]
    },

    Field: {
      type: 'struct',
      encodeOptional: 'bitfield',
      fields: [
        {key: 'key', valType: 'string'},
        {key: 'valType', valType: ref('SType')},
        //  TODO: Default!
        {key: 'encodeMissingAsDefault', valType: 'bool'},
        {key: 'localOnly', valType: 'bool', localOnly: true}, // Quite funny!
      ]
    },

    Map: {
      type: 'struct',
      encodeOptional: 'none',
      fields: [
        {key: 'keyType', valType: enumOfStrings(['uint', 'sint', 'f32', 'f64', 'bool', 'string', 'binary'])},
        {key: 'valType', valType: ref('SType')}
      ]
    },

    SType: {
      type: 'enum',
      variants: [
        {key: 'uint'},
        {key: 'sint'},
        {key: 'f32'},
        {key: 'f64'},
        {key: 'bool'},
        {key: 'string'},
        {key: 'id'},
        {key: 'binary'},
        {key: 'list', associatedData: {
          type: 'struct',
          encodeOptional: 'none',
          fields: [
            {key: 'fieldType', valType: ref('SType')} // Recursive.
          ]
        }},

        {key: 'ref', associatedData: {
          type: 'struct',
          encodeOptional: 'bitfield',
          fields: [{key: 'key', valType: 'string'}]
        }},
        {key: 'struct', associatedData: ref('Struct')},
        {key: 'enum', associatedData: ref('Enum')},
        {key: 'map', associatedData: ref('Map')},
      ]
    }
  }
}
