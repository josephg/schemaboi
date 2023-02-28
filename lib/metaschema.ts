// The metaschema is a schema that is embedded in files to make schemaboi data self describing.

import {EnumSchema, MapType, Schema, StructField, StructSchema, SType} from './schema.js'
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
  fields: new Map([
    ['foreign', { type: 'bool', defaultValue: true, encoding: 'unused' }],
    ['fields', { type: mapOfEntries(ref('StructField')), encoding: 'required' }],
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
        ['id', { type: 'string', encoding: 'required' }],

        // Should this be optional or not?
        ['root', { type: ref('SType'), encoding: 'optional' }],
        ['types', { type: mapOf(ref('SchemaType')), encoding: 'required' }],
      ])
    },

    Primitive: primitives,

    SType: {
      // This has all the types in Primitive, and more!
      type: 'enum',
      closed: false,
      numericOnly: false,
      variants: new Map([
        ...primitives.variants.entries(),
        ['ref', {
          associatedData: {
            type: 'struct',
            fields: new Map([['key', { type: 'string', encoding: 'required' }]]),
            // encodingOrder: ['key'],
          }
        }],
        ['list', {
          associatedData: {
            type: 'struct',
            fields: new Map([['fieldType', { type: ref('SType'), encoding: 'required' }]]),
            // encodingOrder: ['fieldType'],
          }
        }],
        ['map', {
          associatedData: {
            type: 'struct',
            fields: new Map([
              ['keyType', { type: ref('Primitive'), encoding: 'required' }],
              ['valType', { type: ref('SType'), encoding: 'required' }],
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
      variants: new Map([
        ['enum', {
          associatedData: {
            type: 'struct',
            fields: new Map([
              ['foreign', { type: 'bool', defaultValue: true, encoding: 'unused' }], // Not stored.
              ['closed', { type: 'bool', encoding: 'required' }],
              ['numericOnly', { type: 'bool', encoding: 'required' }],
              ['variants', { type: mapOfEntries(ref('EnumVariant')), encoding: 'required' }],
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
      fields: new Map([
        ['associatedData', { type: ref('StructSchema'), encoding: 'required' }]
      ]),
      // encodingOrder: ['associatedData'],
    },

    StructSchema: structSchema,

    StructField: {
      type: 'struct',
      fields: new Map([
        // defaultValue: { type: 'bool', defaultValue: false, optional: true }, // Not stored.
        ['type', { type: ref('SType'), encoding: 'required' }],
        ['optional', { type: 'bool', encoding: 'required' }],
        ['foreign', { type: 'bool', defaultValue: true, encoding: 'unused' }], // Not stored.
        ['renameFieldTo', { type: 'bool', defaultValue: false, encoding: 'unused' }], // Not stored.
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