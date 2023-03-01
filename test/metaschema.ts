import 'mocha'
import * as assert from 'assert/strict'
import * as fs from 'fs'
import { toBinary, metaSchema, readData } from '../lib/index.js'
import { fillSchemaDefaults, mergeSchemas } from '../lib/utils.js'

describe('metaschema', () => {
  it('can parse itself', () => {

    const bytes = toBinary(metaSchema, metaSchema)
    // console.log(bytes)
    const remoteSchema = readData(metaSchema, bytes)
    // console.log(remoteSchema)
    fillSchemaDefaults(metaSchema, false)
    // fillSchemaDefaults(rm, false)
    fillSchemaDefaults(remoteSchema, false)
    let rm = mergeSchemas(remoteSchema, metaSchema)

    // console.log(metaSchema)
    assert.deepEqual(metaSchema, rm)

    // fs.writeFileSync('metaschema.scb', bytes)
  })
})