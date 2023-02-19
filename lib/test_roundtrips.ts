import {SimpleSchema, Schema, EnumSchema} from "./schema.js"
import { enumOfStrings, extendSchema, ref } from "./utils.js"
import { readData } from "./read.js"
import { toBinary } from "./write.js"

import * as assert from 'assert/strict'
import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

const testRoundTripFullSchema = (schema: Schema, input: any) => {
  const bytes = toBinary(schema, input)
  const result = readData(schema, bytes)
  // console.log('result', result)

  assert.deepEqual(result, input)
}

const testRoundTrip = (schema: SimpleSchema, input: any) => {
  const fullSchema = extendSchema(schema)
  testRoundTripFullSchema(fullSchema, input)
}

{
  const schema: SimpleSchema = {
    id: 'Example',
    root: {type: 'list', fieldType: 'f64'},
    types: {}
  }

  testRoundTrip(schema, [1.1, 2.2, 3,3])
}

{
  const schema: SimpleSchema = {
    id: 'Example',
    root: 'string',
    types: {}
  }

  testRoundTrip(schema, 'hi there')
}

{
  const schema: SimpleSchema = {
    id: 'Example',
    root: {type: 'map', keyType: 'string', valType: 'f64'},
    types: {}
  }

  testRoundTrip(schema, {aa: 123, bb: 213.23})
}

{
  const schema: SimpleSchema = {
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
  // Numeric Enum
  const schema: SimpleSchema = {
    id: 'Example',
    root: ref('Color'),
    types: {
      Color: enumOfStrings('Red', 'Blue', 'Green'),
    }
  }

  testRoundTrip(schema, 'Red')
  testRoundTrip(schema, 'Blue')
}

{
  // Enum
  const schema: SimpleSchema = {
    id: 'Example',
    root: ref('Color'),
    types: {
      Color: {
        type: 'enum',
        numericOnly: false,
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

  // console.log(simpleFullSchema(schema))
  testRoundTrip(schema, {type: 'Red'})
  testRoundTrip(schema, {type: 'Blue'})
  // testRoundTrip(schema, {type: 'Blue'})
  testRoundTrip(schema, {type: 'RGB', r: null, g: null, b: null}) // TODO: Make a non-nullable variant.
  testRoundTrip(schema, {type: 'RGB', r: 123, g: 2, b: 1})
}

{
  // Test unknown enum variants
  const SimpleSchema: SimpleSchema = {
    id: 'Example',
    root: ref('Color'),
    types: {
      Color: {
        type: 'enum',
        numericOnly: false,
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

  let schema = extendSchema(SimpleSchema)
  ;(schema.types['Color'] as EnumSchema).variants['Red'].mappedToJS = false
  ;(schema.types['Color'] as EnumSchema).variants['RGB'].mappedToJS = false
  testRoundTripFullSchema(schema, {type: '_unknown', data: {type: 'Red'}})
  testRoundTripFullSchema(schema, {type: '_unknown', data: {type: 'Red'}})
  testRoundTripFullSchema(schema, {type: '_unknown', data: {type: 'RGB', r: 123, g: 2, b: 1}})
}

{
  // Test nullable struct fields
  const schema: SimpleSchema = {
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
