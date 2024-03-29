// The metaschema is a schema that is embedded in files to make schemaboi data self describing.

import {EnumSchema, EnumVariant, IntPrimitive, MapType, Schema, Field, SType} from './schema.js'
import { Bool, enumOfStringsEncoding, canonicalizeType, Id, intEncoding, ref, String, structSchema } from './utils.js'

// import * as assert from 'assert/strict'
// import * as fs from 'fs'
// import {Console} from 'node:console'
// const console = new Console({
//   stdout: process.stdout,
//   stderr: process.stderr,
//   inspectOptions: {depth: null}
// })

const mapOf = (valType: SType, decodeForm: 'object' | 'map' | 'entryList' = 'object'): MapType => (
  {type: 'map', keyType: Id, valType, decodeForm}
)
// const listOf = (fieldType: SType): List => ({type: 'list', fieldType})


// const structSchema: StructSchema = {
//   fields: new Map<string, StructField>([
//     // ['type', {type: 'string', defaultValue: 'struct', skip: true}],

//     ['foreign', { type: Bool, defaultValue: true, skip: true }],
//     ['fields', { type: mapOf(ref('StructField'), 'map'), optional: false }],
//   ]),
//   encode(obj: StructSchema) {
//     // console.log('encode helper', obj)
//     return {
//       ...obj,
//       fields: [...obj.fields.entries()].filter(([_k,v]) => !v.skip)
//     }
//   },
// }


export const metaSchema: Schema = {
  id: '_sbmeta',
  root: ref('Schema'),

  types: {
    Schema: structSchema([
      ['id', { type: String }],

      // Should this be optional or not?
      ['root', { type: ref('Type'), optional: true }],
      ['types', { type: mapOf(ref('TypeDef')) }],
    ]),

    NumberEncoding: enumOfStringsEncoding('le', 'varint'),

    Type: {
      // This has all the types in Primitive, and more!
      exhaustive: false,
      numericOnly: false,
      encode: canonicalizeType, // To support lazy strings.
      variants: new Map<string, EnumVariant>([
        ...['bool', 'string', 'binary', 'id', 'f32', 'f64'].map((t): [string, EnumVariant] => [t, {}]),
        ...['u8', 'u16', 'u32', 'u64', 'u128', 's8', 's16', 's32', 's64', 's128'].map((t): [string, EnumVariant] => [t, {
          fields: new Map<string, Field>([
            ['encoding', {
              type: ref('NumberEncoding'),
              renameFieldTo: 'numericEncoding',
              defaultValue: ((obj: IntPrimitive) => intEncoding(obj)),
            }]
          ])
        }]),
        ['ref', {
          fields: new Map<string, Field>([['key', { type: Id }]]),
        }],
        ['list', {
          fields: new Map<string, Field>([['fieldType', { type: ref('Type') }]]),
        }],
        ['map', {
          fields: new Map<string, Field>([
            ['keyType', { type: ref('Type') }],
            ['valType', { type: ref('Type') }],
            // Type should be enumOfStrings('object', 'map', 'entryList'), but it doesn't matter.
            ['decodeForm', { type: String, skip: true, defaultValue: 'map' }],
          ]),
        }],
      ]),
    },

    TypeDef: structSchema([
      ['foreign', { type: Bool, defaultValue: true, skip: true }], // Not stored.
      ['exhaustive', { type: Bool, inline: true }],
      ['numericOnly', { type: Bool, inline: true }],
      ['variants', { type: mapOf(ref('EnumVariant'), 'map') }],
    ]),

    EnumVariant: structSchema([
      ['fields', { type: mapOf(ref('Field'), 'map'), optional: true, defaultValue: null }],
    ], {
      encode(obj: EnumVariant) {
        // Strip out any skipped fields from the wire.
        return {
          ...obj,
          fields: obj.fields ? [...obj.fields!.entries()].filter(([_k,v]) => !v.skip) : undefined
        }
      }
    }),

    Field: structSchema([
      ['type', { type: ref('Type') }],

      // These fields are local only.
      ['defaultValue', {type: String, skip: true, optional: true}], // Type doesn't matter.
      ['foreign', { type: Bool, skip: true, defaultValue: true }], // Not stored.
      ['renameFieldTo', { type: String, skip: true, optional: true }], // Not stored.
      ['skip', { type: Bool, skip: true, defaultValue: false, inline: true }], // Should skip be skipped? If not we should inline this.

      ['inline', { type: Bool, inline: true, optional: true }],
      ['optional', { type: Bool, defaultValue: false, inline: true}],
    ]),
  }
}
