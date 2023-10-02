import 'mocha'
import * as assert from 'assert/strict'
// import * as fs from 'fs'
import { writeRaw, metaSchema, readRaw } from '../lib/index.js'
import { fillSchemaDefaults, mergeSchemas } from '../lib/utils.js'

describe('metaschema', () => {
  it('can parse itself', () => {

    const bytes = writeRaw(metaSchema, metaSchema)
    const remoteSchema = readRaw(metaSchema, bytes)
    // console.log(remoteSchema)
    fillSchemaDefaults(metaSchema, false)
    // fillSchemaDefaults(rm, false)
    fillSchemaDefaults(remoteSchema, false)
    let rm = mergeSchemas(remoteSchema, metaSchema)

    // console.log(metaSchema)
    assert.deepEqual(metaSchema, rm)

    // console.log(bytes)
    // fs.writeFileSync('metaschema.scb', bytes)
  })
})