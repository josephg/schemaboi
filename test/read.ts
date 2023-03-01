import 'mocha'
import * as assert from 'assert/strict'
import { readData } from '../lib/read.js'
import { Schema, SimpleSchema, StructField } from '../lib/schema.js'
import { extendSchema, mergeSchemas, ref } from '../lib/utils.js'

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
        Contact: {
          type: 'struct',
  
          fields: new Map<string, StructField>([
            ['age', {type: 'uint'}],
            ['name', {type: 'string'}],
            // address: {type: 'string'},
          ])
        }
      }
    }
  
    const data = new Uint8Array([ 123, 4, 115, 101, 112, 104 ])
    const output = readData(schema, data)
    assert.deepEqual(output, {age: 123, name: 'seph'})
  })

  it('Reads from a merged schema', () => {
    const fileSchema: Schema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          type: 'struct',
          // encodingOrder: ['age', 'name'],
          foreign: true,
          fields: new Map<string, StructField>([
            ['age', {type: 'uint'}],
            ['name', {type: 'string'}],
            // address: {type: 'string'},
          ])
        }
      }
    }
  
    const appSchema: SimpleSchema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          type: 'struct',
          fields: {
            // name: {type: 'string'},
            age: {type: 'uint', optional: true, renameFieldTo: 'yearsOld'},
            address: {type: 'string', optional: true, defaultValue: 'unknown location'},
          }
        }
      }
    }

    const b = new Uint8Array([ 123, 4, 115, 101, 112, 104 ])

    // console.log(extendSchema(appSchema))
    const mergedSchema = mergeSchemas(fileSchema, extendSchema(appSchema))
    // console.log(mergedSchema)
    const output = readData(mergedSchema, b)
    assert.deepEqual(output, {
      yearsOld: 123,
      address: 'unknown location',
      _external: {name: 'seph'}
    })
  })
})
