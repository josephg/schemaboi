// The metaschema is a schema that is embedded in files to make schemaboi data self describing.

import {EnumVariant, MapType, Schema, StructField, StructSchema, SType} from './schema.js'
import { enumOfStrings, filterIter, mergeSchemas, ref } from './utils.js'
import { toBinary } from "./write.js"
import { readData } from "./read.js"
import * as assert from 'assert/strict'
import * as fs from 'fs'
import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

const mapOf = (valType: SType, decodeForm: 'object' | 'map' | 'entryList' = 'object'): MapType => (
  {type: 'map', keyType: 'id', valType, decodeForm}
)
// const listOf = (fieldType: SType): List => ({type: 'list', fieldType})


const primitives = enumOfStrings(
  'bool',
  'u8', 'u16', 'u32', 'u64', 'u128',
  's8', 's16', 's32', 's64', 's128',
  'f32', 'f64',
  'string', 'binary', 'id',
)

const structSchema: StructSchema = {
  type: 'struct',
  fields: new Map<string, StructField>([
    ['foreign', { type: 'bool', defaultValue: true, skip: true }],
    ['fields', { type: mapOf(ref('StructField'), 'map'), optional: false }],
  ]),
  encode(obj: StructSchema) {
    // console.log('encode helper', obj)
    return {
      ...obj,
      fields: [...obj.fields.entries()].filter(([_k,v]) => !v.skip)
    }
  },
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
        ['id', { type: 'string' }],

        // Should this be optional or not?
        ['root', { type: ref('SType'), optional: true }],
        ['types', { type: mapOf(ref('SchemaType')) }],
      ]),
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
            fields: new Map<string, StructField>([['key', { type: 'string' }]]),
            // encodingOrder: ['key'],
          }
        }],
        ['list', {
          associatedData: {
            type: 'struct',
            fields: new Map<string, StructField>([['fieldType', { type: ref('SType') }]]),
            // encodingOrder: ['fieldType'],
          }
        }],
        ['map', {
          associatedData: {
            type: 'struct',
            fields: new Map<string, StructField>([
              ['keyType', { type: ref('Primitive') }],
              ['valType', { type: ref('SType') }],
              // Type should be enumOfStrings('object', 'map', 'entryList'), but it doesn't matter.
              ['decodeForm', { type: 'string', skip: true, defaultValue: 'object' }],
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
              ['closed', { type: 'bool' }],
              ['numericOnly', { type: 'bool' }],
              ['variants', { type: mapOf(ref('EnumVariant'), 'map') }],
            ]),
          }
        }],
        ['struct', {
          associatedData: structSchema
        }],
      ]),
    },

    EnumVariant: {
      type: 'struct',
      fields: new Map<string, StructField>([
        ['associatedData', { type: ref('StructSchema'), optional: true, defaultValue: null }]
      ]),
    },

    StructSchema: structSchema,

    StructField: {
      type: 'struct',
      fields: new Map<string, StructField>([
        ['type', { type: ref('SType') }],

        // ['defaultValue', {type: 'string', skip: true, optional: true}], // Type doesn't matter.
        // ['foreign', { type: 'bool', skip: true, defaultValue: true }], // Not stored.
        // ['renameFieldTo', { type: 'string', optional: true, skip: true }], // Not stored.
        // ['inline', { type: 'bool', skip: true, optional: true }],
        // ['skip', { type: 'bool', skip: true, defaultValue: false, inline: true }],

        ['optional', { type: 'bool', defaultValue: false, inline: true}],
      ]),
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


  fs.writeFileSync('metaschema.scb', bytes)
}

metameta()