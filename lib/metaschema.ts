// The metaschema is a schema that is embedded in files to make schemaboi data self describing.

import {EnumSchema, EnumVariant, MapType, Primitive, Schema, StructField, StructSchema, SType} from './schema.js'
import { Bool, enumOfStrings, extendSchema, fillSchemaDefaults, filterIter, Id, mergeSchemas, primitiveTypes, ref, String } from './utils.js'
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
  {type: 'map', keyType: Id, valType, decodeForm}
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
        ['root', { type: ref('Type'), optional: true }],
        ['types', { type: mapOf(ref('TypeDef')) }],
      ]),
    },

    Type: {
      // This has all the types in Primitive, and more!
      type: 'enum',
      closed: false,
      numericOnly: false,
      variants: new Map<string, EnumVariant>([
        ...primitiveTypes.map((t): [string, EnumVariant] => [t, {}]),
        ['ref', {
          associatedData: {
            fields: new Map<string, StructField>([['key', { type: String }]]),
          }
        }],
        ['list', {
          associatedData: {
            fields: new Map<string, StructField>([['fieldType', { type: ref('Type') }]]),
          }
        }],
        ['map', {
          associatedData: {
            fields: new Map<string, StructField>([
              ['keyType', { type: ref('Type') }],
              ['valType', { type: ref('Type') }],
              // Type should be enumOfStrings('object', 'map', 'entryList'), but it doesn't matter.
              ['decodeForm', { type: String, skip: true, defaultValue: 'object' }],
            ]),
          }
        }],
      ]),
    },

    TypeDef: {
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
        ['type', { type: ref('Type') }],

        ['defaultValue', {type: String, skip: true, optional: true}], // Type doesn't matter.
        ['foreign', { type: Bool, skip: true, defaultValue: true }], // Not stored.
        ['renameFieldTo', { type: String, optional: true, skip: true }], // Not stored.
        ['skip', { type: Bool, skip: true, defaultValue: false, inline: true }], // Should skip be skipped? If not we should inline this.

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
  fillSchemaDefaults(metaSchema, false)
  // fillSchemaDefaults(rm, false)
  fillSchemaDefaults(remoteSchema, false)
  let rm = mergeSchemas(remoteSchema, metaSchema)

  // console.log(metaSchema)
  assert.deepEqual(metaSchema, rm)

  fs.writeFileSync('metaschema.scb', bytes)
}

metameta()
