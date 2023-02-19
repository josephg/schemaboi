// The metaschema is a schema that is embedded in files to make schemaboi data self describing.

import {EnumSchema, MapType, Schema, SType} from './schema.js'
import { ref } from './utils.js'
import { toBinary } from "./write.js"
import { readData } from "./read.js"
import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

const mapOf = (valType: SType): MapType => ({type: 'map', keyType: 'string', valType})
// const listOf = (fieldType: SType): List => ({type: 'list', fieldType})

const enumOfStrings = (...variants: string[]): EnumSchema => ({
  type: 'enum',
  closed: false,
  numericOnly: true,
  variants: Object.fromEntries(variants.map(v => [v, {}])),
  encodingOrder: variants,
})

const primitives = enumOfStrings('uint', 'sint', 'f32', 'f64', 'bool', 'string', 'binary', 'id')

export const metaSchema: Schema = {
  id: '_sbmeta',
  root: ref('Schema'),

  types: {
    Schema: {
      type: 'struct',
      fields: {
        id: { type: 'string', optional: false },

        // Should this be optional or not?
        root: { type: ref('SType'), optional: true },
        types: { type: mapOf(ref('SchemaType')), optional: false },
      },
      encodingOrder: ['id', 'root', 'types']
    },

    Primitive: primitives,

    SType: {
      // This has all the types in Primitive, and more!
      type: 'enum',
      closed: false,
      numericOnly: false,
      variants: {
        ...primitives.variants,
        ref: {
          associatedData: {
            type: 'struct',
            fields: { key: { type: 'string', optional: false } },
            encodingOrder: ['key'],
          }
        },
        list: {
          associatedData: {
            type: 'struct',
            fields: { fieldType: { type: ref('SType'), optional: false } },
            encodingOrder: ['fieldType'],
          }
        },
        map: {
          associatedData: {
            type: 'struct',
            fields: {
              keyType: { type: ref('Primitive'), optional: false },
              valType: { type: ref('SType'), optional: false },
            },
            encodingOrder: ['keyType', 'valType'],
          }
        },
      },
      encodingOrder: [...primitives.encodingOrder, 'ref', 'list', 'map'],
    },

    SchemaType: {
      type: 'enum',
      closed: true, // TODO: ??? Am I sure about this?
      numericOnly: false,
      variants: {
        enum: {
          associatedData: {
            type: 'struct',
            fields: {
              foreign: { type: 'bool', defaultValue: true, optional: true }, // Not stored.
              closed: { type: 'bool', optional: false },
              numericOnly: { type: 'bool', optional: false },
              variants: { type: mapOf(ref('EnumVariant')), optional: false },
              // encodingOrder: {
              //   type: listOf('string')
              // }
            },
            encodingOrder: ['closed', 'numericOnly', 'variants']
          }
        },
        struct: {
          associatedData: {
            type: 'struct',

            // I've copy+pasted this from the StructSchema code below. :(.
            fields: {
              foreign: { type: 'bool', defaultValue: true, optional: true }, // Not stored.
              fields: { type: mapOf(ref('StructField')), optional: false },
              // encoding order???
            },
            encodingOrder: ['fields'],

            // fields: { inner: { type: ref('StructSchema'), optional: false } },
            // encodingOrder: ['inner'],
          }
        },
      },
      encodingOrder: ['enum', 'struct'],
    },

    EnumVariant: {
      type: 'struct',
      fields: {
        associatedData: { type: ref('StructSchema'), optional: true }
      },
      encodingOrder: ['associatedData'],
    },

    StructSchema: {
      type: 'struct',
      fields: {
        foreign: { type: 'bool', defaultValue: true, optional: true }, // Not stored.
        fields: { type: mapOf(ref('StructField')), optional: false },
        // encoding order???
      },
      encodingOrder: ['fields'],
    },

    StructField: {
      type: 'struct',
      fields: {
        type: { type: ref('SType'), optional: false },
        // defaultValue: { type: 'bool', defaultValue: false, optional: true }, // Not stored.
        optional: { type: 'bool', optional: false },
        foreign: { type: 'bool', defaultValue: true, optional: true }, // Not stored.
        renameFieldTo: { type: 'bool', defaultValue: false, optional: true }, // Not stored.
      },
      encodingOrder: ['type', 'optional'],
    },
  }
}



// ************* TESTS ********

const metameta = () => {
  const bytes = toBinary(metaSchema, metaSchema)
  console.log(bytes)
  console.log(readData(metaSchema, bytes))

}

metameta()