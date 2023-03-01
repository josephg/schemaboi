// The metaschema is a schema that is embedded in files to make schemaboi data self describing.

import {EnumSchema, EnumVariant, MapType, Schema, StructField, StructSchema, SType} from './schema.js'
import { Bool, enumOfStrings, extendSchema, fillSchemaDefaults, filterIter, mergeSchemas, ref, String } from './utils.js'
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


const structSchema: StructSchema = {
  fields: new Map<string, StructField>([
    // ['type', {type: 'string', defaultValue: 'struct', skip: true}],

    ['foreign', { type: Bool, defaultValue: true, skip: true }],
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
        ['id', { type: String }],

        // Should this be optional or not?
        ['root', { type: ref('SType'), optional: true }],
        ['types', { type: mapOf(ref('SchemaType')) }],
      ]),
    },

    Primitive: enumOfStrings(
      'bool',
      'u8', 'u16', 'u32', 'u64', 'u128',
      's8', 's16', 's32', 's64', 's128',
      'f32', 'f64',
      'string', 'binary', 'id',
    ),

    SType: {
      // This has all the types in Primitive, and more!
      type: 'enum',
      closed: false,
      numericOnly: false,
      variants: new Map<string, EnumVariant>([
        ['primitive', {
          associatedData: {
            fields: new Map<string, StructField>([['inner', { type: ref('Primitive') }]]),
            // encodingOrder: ['key'],
          }
        }],
        ['ref', {
          associatedData: {
            fields: new Map<string, StructField>([['key', { type: String }]]),
            // encodingOrder: ['key'],
          }
        }],
        ['list', {
          associatedData: {
            fields: new Map<string, StructField>([['fieldType', { type: ref('SType') }]]),
            // encodingOrder: ['fieldType'],
          }
        }],
        ['map', {
          associatedData: {
            fields: new Map<string, StructField>([
              ['keyType', { type: ref('Primitive') }],
              ['valType', { type: ref('SType') }],
              // Type should be enumOfStrings('object', 'map', 'entryList'), but it doesn't matter.
              // ['decodeForm', { type: 'string', skip: true, defaultValue: 'object' }],
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
            fields: new Map<string, StructField>([
              ['foreign', { type: Bool, defaultValue: true, skip: true }], // Not stored.
              ['closed', { type: Bool, inline: true }],
              ['numericOnly', { type: Bool, inline: true }],
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

    StructSchema: { type: 'struct', ...structSchema },

    StructField: {
      type: 'struct',
      fields: new Map<string, StructField>([
        ['type', { type: ref('SType') }],

        // ['defaultValue', {type: 'string', skip: true, optional: true}], // Type doesn't matter.
        // ['foreign', { type: 'bool', skip: true, defaultValue: true }], // Not stored.
        // ['renameFieldTo', { type: 'string', optional: true, skip: true }], // Not stored.
        // ['skip', { type: 'bool', skip: true, defaultValue: false, inline: true }],

        ['inline', { type: Bool, inline: true, optional: true }],
        ['optional', { type: Bool, defaultValue: false, inline: true}],
      ]),
    },
  }
}



// ************* TESTS ********

const metameta = () => {
  const bytes = toBinary(metaSchema, metaSchema)
  console.log(bytes)
  const remoteSchema = readData(metaSchema, bytes)
  // console.log(remoteSchema)
  let rm = mergeSchemas(remoteSchema, metaSchema)
  fillSchemaDefaults(metaSchema, false)
  fillSchemaDefaults(rm, false)

  // console.log(metaSchema)
  assert.deepEqual(metaSchema, rm)

  fs.writeFileSync('metaschema.scb', bytes)
}

metameta()
