#!/usr/bin/env node

// There is sooo much more work to do here!
// Love to have code to:
// - Generate typescript definitions from the schema
// - Pretty print
// - Print the app schema equivalent
// - ... More!

import * as schemaboi from '../lib/index.js'
import fs from 'fs'

const filename = process.argv[2]
if (filename == null) {
  console.error('Usage: schcat <FILE>.scb')
} else {
  // console.log(filename)
  const bytes = fs.readFileSync(filename)

  const [schema, data] = schemaboi.readWithoutSchema(bytes)
  // console.log(JSON.stringify(schema, null, 2))

  console.dir(data, {colors: true, depth: Infinity})
  // console.log(JSON.stringify(data, null, 2))
}