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
  const schema: PureSchema = {
    id: 'Example',
    root: {type: 'list', fieldType: 'f64'},
    types: {}
  }

  testRoundTrip(schema, [1.1, 2.2, 3,3])
}

{
  const schema: PureSchema = {
    id: 'Example',
    root: 'string',
    types: {}
  }

  testRoundTrip(schema, 'hi there')
}

{
  const schema: PureSchema = {
    id: 'Example',
    root: {type: 'map', keyType: 'string', valType: 'f64'},
    types: {}
  }

  testRoundTrip(schema, {aa: 123, bb: 213.23})
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
        }
      }
    }
  }

  testRoundTrip(schema, {name: 'seph'})
}

{
  // Enum
  const schema: PureSchema = {
    id: 'Example',
    root: ref('Color'),
    types: {
      Color: {
        type: 'enum',
        variants: {
          Blue: {},
          Red: {},
          RGB: {
            associatedData: {
              type: 'struct',
              fields: {
                r: {type: 'uint'},
                g: {type: 'uint'},
                b: {type: 'uint'},
              }
            }
          }
        }
      }
    }
  }

  testRoundTrip(schema, 'Red')
  testRoundTrip(schema, 'Blue')
  // testRoundTrip(schema, {type: 'Blue'})
  testRoundTrip(schema, {type: 'RGB', r: null, g: null, b: null}) // TODO: Make a non-nullable variant.
  testRoundTrip(schema, {type: 'RGB', r: 123, g: 2, b: 1})
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