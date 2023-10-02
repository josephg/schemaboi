import 'mocha'
import * as assert from 'assert/strict'
import { readRaw } from '../lib/read.js'
import { Schema, AppSchema, Field } from '../lib/schema.js'
import { extendSchema, mergeSchemas, prim, ref, String, structSchema } from '../lib/utils.js'

import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

describe('read', () => {
  it('reads from trivial schema', () => {
    const schema: Schema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: structSchema('default', [
          ['age', {type: prim('u32')}],
          ['name', {type: String}],
          // address: {type: String},
        ])
      }
    }

    const data = new Uint8Array([ 123, 4, 115, 101, 112, 104 ])
    const output = readRaw(schema, data)
    assert.deepEqual(output, {age: 123, name: 'seph'})
  })

  it('Reads from a merged schema', () => {
    const fileSchema: Schema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: structSchema('default', [
          ['age', {type: prim('u32')}],
          ['name', {type: String}],
          // address: {type: String},
        ])
      }
    }

    const appSchema: AppSchema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          type: 'struct',
          fields: {
            // name: {type: String},
            age: {type: 'u32', optional: true, renameFieldTo: 'yearsOld'},
            address: {type: 'string', optional: true, defaultValue: 'unknown location'},
          }
        }
      }
    }

    const b = new Uint8Array([ 123, 4, 115, 101, 112, 104 ])

    // console.log(extendSchema(appSchema))
    const mergedSchema = mergeSchemas(fileSchema, extendSchema(appSchema))
    // console.log(mergedSchema)
    const output = readRaw(mergedSchema, b)
    assert.deepEqual(output, {
      yearsOld: 123,
      address: 'unknown location',
      _foreign: {name: 'seph'}
    })
  })
})
