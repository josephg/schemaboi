// The metaschema is a schema that is embedded in files to make schemaboi data self describing.

import {EnumVariant, MapType, Schema, StructField, StructSchema, SType} from './schema.js'
import { enumOfStrings, mergeSchemas, ref } from './utils.js'
import { toBinary } from "./write.js"
import { readData } from "./read.js"
import * as assert from 'assert/strict'
import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

const mapOf = (valType: SType): MapType => ({type: 'map', keyType: 'string', valType})
const mapOfEntries = (valType: SType): MapType => ({type: 'map', keyType: 'string', valType, decodeForm: 'entryList'})
// const listOf = (fieldType: SType): List => ({type: 'list', fieldType})


const primitives = enumOfStrings('uint', 'sint', 'f32', 'f64', 'bool', 'string', 'binary', 'id')

const structSchema: StructSchema = {
  type: 'struct',
  fields: new Map<string, StructField>([
    ['foreign', { type: 'bool', defaultValue: true, skip: true }],
    ['fields', { type: mapOfEntries(ref('StructField')), optional: false }],
  ]),
  // encode(e: StructSchema) {
  //   return {
  //     ...e,
  //     fields: e.encodingOrder.map(key => [key, e.fields[key]])
  //   }
  // },
  // decode(e: any): StructSchema {
  //   return {
  //     ...e,
  //     fields: Object.fromEntries(e.fields),
  //     encodingOrder: e.fields.map(([k, v]: [string, any]) => k),
  //   }
  // },
  // encodingOrder: ['fields'],
}

export const metaSchema: Schema = {
  id: '_sbmeta',
  root: ref('Schema'),

  types: {
    Schema: {
      type: 'struct',
      fields: new Map<string, StructField>([
        ['id', { type: 'string', optional: false }],

        // Should this be optional or not?
        ['root', { type: ref('SType'), optional: true }],
        ['types', { type: mapOf(ref('SchemaType')), optional: false }],
      ])
    },

    Primitive: primitives,

    SType: {
      // This has all the types in Primitive, and more!
      type: 'enum',
      closed: false,
      numericOnly: false,
      variants: new Map<string, EnumVariant>([
        ...primitives.variants.entries(),
        ['ref', {
          associatedData: {
            type: 'struct',
            fields: new Map<string, StructField>([['key', { type: 'string', optional: false }]]),
            // encodingOrder: ['key'],
          }
        }],
        ['list', {
          associatedData: {
            type: 'struct',
            fields: new Map<string, StructField>([['fieldType', { type: ref('SType'), optional: false }]]),
            // encodingOrder: ['fieldType'],
          }
        }],
        ['map', {
          associatedData: {
            type: 'struct',
            fields: new Map<string, StructField>([
              ['keyType', { type: ref('Primitive'), optional: false }],
              ['valType', { type: ref('SType'), optional: false }],
            ]),
            // encodingOrder: ['keyType', 'valType'],
          }
        }],
      ]),
      // encodingOrder: [...primitives.encodingOrder, 'ref', 'list', 'map'],
    },

    SchemaType: {
      type: 'enum',
      closed: true, // TODO: ??? Am I sure about this?
      numericOnly: false,
      variants: new Map<string, EnumVariant>([
        ['enum', {
          associatedData: {
            type: 'struct',
            fields: new Map<string, StructField>([
              ['foreign', { type: 'bool', defaultValue: true, skip: true }], // Not stored.
              ['closed', { type: 'bool', optional: false }],
              ['numericOnly', { type: 'bool', optional: false }],
              ['variants', { type: mapOfEntries(ref('EnumVariant')), optional: false }],
              // encodingOrder: {
              //   type: listOf('string')
              // }
            ]),
            // encodingOrder: ['closed', 'numericOnly', 'variants'],
            // encode(e: EnumSchema) {
            //   return {
            //     ...e,
            //     variants: e.encodingOrder.map(key => [key, e.variants[key]])
            //   }
            // },
            // decode(e: any): EnumSchema {
            //   return {
            //     ...e,
            //     variants: Object.fromEntries(e.variants),
            //     encodingOrder: e.variants.map(([k, v]: [string, any]) => k),
            //   }
            // },
          }
        }],
        ['struct', {
          associatedData: structSchema
        }],
      ]),
      // encodingOrder: ['enum', 'struct'],
    },

    EnumVariant: {
      type: 'struct',
      fields: new Map<string, StructField>([
        ['associatedData', { type: ref('StructSchema'), optional: false }]
      ]),
      // encodingOrder: ['associatedData'],
    },

    StructSchema: structSchema,

    StructField: {
      type: 'struct',
      fields: new Map<string, StructField>([
        // defaultValue: { type: 'bool', defaultValue: false, optional: true }, // Not stored.
        ['type', { type: ref('SType'), optional: false }],
        ['optional', { type: 'bool', optional: false }],
        ['foreign', { type: 'bool', defaultValue: true, skip: true }], // Not stored.
        ['renameFieldTo', { type: 'bool', defaultValue: false, skip: true }], // Not stored.
      ]),
      // encodingOrder: ['type', 'optional'],
    },
  }
}



// ************* TESTS ********

const metameta = () => {
  const bytes = toBinary(metaSchema, metaSchema)
  console.log(bytes)
  const remoteSchema = readData(metaSchema, bytes)
  console.log(remoteSchema)

  // assert.deepEqual(remoteSchema, metaSchema)
  // const m = mergeSchemas(remoteSchema, metaSchema)
  // console.log(m)

}

metameta()