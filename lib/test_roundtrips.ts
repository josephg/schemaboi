import { readData } from "./read.js";
import {PureSchema, ref, Schema} from "./schema.js";
import { toBinary } from "./write.js";
import { simpleFullSchema } from "./utils.js";

import * as assert from 'assert/strict'

const testRoundTripFullSchema = (schema: Schema, input: any) => {
  const bytes = toBinary(schema, input)
  const result = readData(schema, bytes)
  console.log('result', result)

  assert.deepEqual(input, result)
}

const testRoundTrip = (schema: PureSchema, input: any) => {
  const fullSchema = simpleFullSchema(schema)
  testRoundTripFullSchema(fullSchema, input)
}

{
  // Trivial examples.
  const schema: PureSchema = {
    id: 'Example',
    root: ref('Contact'),
    types: {
      Contact: {
        type: 'struct',
        fields: {
          name: {type: 'string'},
        }
      }
    }
  }

  const data = {name: 'seph'}

  // testRoundTrip(schema, data)
}

{
  const schema: PureSchema = {
    id: 'Example',
    root: ref('Contact'),
    types: {
      Contact: {
        type: 'struct',
        fields: {
          name: {type: 'string'},
          age: {type: 'uint'},
          addresses: {type: {type: 'list', fieldType: 'string'}}
          // address: {type: 'string'},
        }
      }
    }
  }

  testRoundTrip(schema, {name: 'seph', age: 21, addresses: ['123 Example St', '456 Somewhere else']})
  testRoundTrip(schema, {name: 'seph', age: null, addresses: ['123 Example St', '456 Somewhere else']})
  testRoundTrip(schema, {name: null, age: null, addresses: null})
  testRoundTrip(schema, {name: null, age: null, addresses: []})
}