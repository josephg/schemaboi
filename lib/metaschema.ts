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
  mappedToJS: true,
  closed: false,
  numericOnly: true,
  variants: Object.fromEntries(variants.map(v => [v, {mappedToJS: true}])),
  encodingOrder: variants,
})

const primitives = enumOfStrings('uint', 'sint', 'f32', 'f64', 'bool', 'string', 'binary', 'id')

export const metaSchema: Schema = {
  id: '_sbmeta',
  root: ref('Schema'),

  types: {
    Schema: {
      type: 'struct',
      mappedToJS: true,
      fields: {
        id: { type: 'string', optional: false, mappedToJS: true, },

        // Should this be optional or not?
        root: { type: ref('SType'), optional: true, mappedToJS: true, },
        types: { type: mapOf(ref('SchemaType')), optional: false, mappedToJS: true, },
      },
      encodingOrder: ['id', 'root', 'types']
    },

    Primitive: primitives,

    SType: {
      // This has all the types in Primitive, and more!
      type: 'enum',
      mappedToJS: true,
      closed: false,
      numericOnly: false,
      variants: {
        ...primitives.variants,
        ref: {
          mappedToJS: true,
          associatedData: {
            type: 'struct',
            mappedToJS: true,
            fields: { key: { type: 'string', mappedToJS: true, optional: false } },
            encodingOrder: ['key'],
          }
        },
        list: {
          mappedToJS: true,
          associatedData: {
            type: 'struct',
            mappedToJS: true,
            fields: { fieldType: { type: ref('SType'), mappedToJS: true, optional: false } },
            encodingOrder: ['fieldType'],
          }
        },
        map: {
          mappedToJS: true,
          associatedData: {
            type: 'struct',
            mappedToJS: true,
            fields: {
              keyType: { type: ref('Primitive'), mappedToJS: true, optional: false },
              valType: { type: ref('SType'), mappedToJS: true, optional: false },
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
      mappedToJS: true,
      variants: {
        enum: {
          mappedToJS: true,
          associatedData: {
            type: 'struct',
            mappedToJS: true,
            fields: {
              mappedToJS: { type: 'bool', mappedToJS: true, defaultValue: false, optional: true }, // Not stored.
              closed: { type: 'bool', mappedToJS: true, optional: false },
              numericOnly: { type: 'bool', mappedToJS: true, optional: false },
              variants: { type: mapOf(ref('EnumVariant')), mappedToJS: true, optional: false },
              // encodingOrder: {
              //   type: listOf('string')
              // }
            },
            encodingOrder: ['closed', 'numericOnly', 'variants']
          }
        },
        struct: {
          mappedToJS: true,
          associatedData: {
            type: 'struct',
            mappedToJS: true,

            // I've copy+pasted this from the StructSchema code below. :(.
            fields: {
              mappedToJS: { type: 'bool', mappedToJS: true, defaultValue: false, optional: true }, // Not stored.
              fields: { type: mapOf(ref('StructField')), mappedToJS: true, optional: false },
              // encoding order???
            },
            encodingOrder: ['fields'],

            // fields: { inner: { type: ref('StructSchema'), mappedToJS: true, optional: false } },
            // encodingOrder: ['inner'],
          }
        },
      },
      encodingOrder: ['enum', 'struct'],
    },

    EnumVariant: {
      type: 'struct',
      mappedToJS: true,
      fields: {
        associatedData: { type: ref('StructSchema'), mappedToJS: true, optional: true }
      },
      encodingOrder: ['associatedData'],
    },

    StructSchema: {
      type: 'struct',
      mappedToJS: true,
      fields: {
        mappedToJS: { type: 'bool', mappedToJS: true, defaultValue: false, optional: true }, // Not stored.
        fields: { type: mapOf(ref('StructField')), mappedToJS: true, optional: false },
        // encoding order???
      },
      encodingOrder: ['fields'],
    },

    StructField: {
      type: 'struct',
      mappedToJS: true,
      fields: {
        type: { type: ref('SType'), mappedToJS: true, optional: false },
        // defaultValue: { type: 'bool', mappedToJS: true, defaultValue: false, optional: true }, // Not stored.
        optional: { type: 'bool', mappedToJS: true, optional: false },
        mappedToJS: { type: 'bool', mappedToJS: true, defaultValue: false, optional: true }, // Not stored.
        renameFieldTo: { type: 'bool', mappedToJS: true, defaultValue: false, optional: true }, // Not stored.
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