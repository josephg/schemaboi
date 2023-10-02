import 'mocha'
import * as assert from 'assert/strict'
import * as fs from 'fs'
import { writeRaw, metaSchema, readRaw } from '../lib/index.js'
import { fillSchemaDefaults, mergeSchemas } from '../lib/utils.js'

// import {Console} from 'node:console'
// const console = new Console({
//   stdout: process.stdout,
//   stderr: process.stderr,
//   inspectOptions: {depth: null}
// })

describe('metaschema', () => {
  it('can parse itself', () => {

    const bytes = writeRaw(metaSchema, metaSchema)
    const remoteSchema = readRaw(metaSchema, bytes)
    // console.log(remoteSchema)
    fillSchemaDefaults(metaSchema, false)
    // fillSchemaDefaults(rm, false)
    fillSchemaDefaults(remoteSchema, false)
    let rm = mergeSchemas(remoteSchema, metaSchema)

    // console.log(rm.types.Field.variants.get('default'))
    // console.log(remoteSchema.types.Field.variants.get('default'))
    assert.deepEqual(metaSchema, rm)

    // console.log(bytes)
    fs.writeFileSync('metaschema2.scb', bytes)
  })
})