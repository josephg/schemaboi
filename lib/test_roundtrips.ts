import {SimpleSchema, Schema, EnumSchema, StructField} from "./schema.js"
import { enumOfStringsSimple, extendSchema, ref } from "./utils.js"
import { readData } from "./read.js"
import { toBinary } from "./write.js"

import * as assert from 'assert/strict'
import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

const testRoundTripFullSchema = (schema: Schema, input: any, expectedOutput = input) => {
  const bytes = toBinary(schema, input)
  // console.log('bytes', bytes)
  const result = readData(schema, bytes)
  // console.log('result', result)

  assert.deepEqual(result, expectedOutput)
}

const testRoundTrip = (schema: SimpleSchema, input: any) => {
  const fullSchema = extendSchema(schema)
  // console.log('fullSchema', fullSchema)
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
  // Map as entry list
  const schema: SimpleSchema = {
    id: 'Example',
    root: {type: 'map', keyType: 'string', valType: 'f64', decodeForm: 'entryList'},
    types: {}
  }

  testRoundTrip(schema, [['aa', 123], ['bb', 213.23]])
}

{
  // Map as a map
  const schema: SimpleSchema = {
    id: 'Example',
    root: {type: 'map', keyType: 'string', valType: 'f64', decodeForm: 'map'},
    types: {}
  }

  testRoundTrip(schema, new Map([['aa', 123], ['bb', 213.23]]))
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
      Color: enumOfStringsSimple('Red', 'Blue', 'Green'),
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
                r: {type: 'uint', optional: true},
                g: {type: 'uint', optional: true},
                b: {type: 'uint', optional: true},
              }
            }
          }
        }
      }
    }
  }

  // console.log(extendSchema(schema))
  testRoundTrip(schema, {type: 'Red'})
  testRoundTrip(schema, {type: 'Blue'})
  // // testRoundTrip(schema, {type: 'Blue'})
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
  ;(schema.types['Color'] as EnumSchema).variants.get('Red')!.foreign = true
  ;(schema.types['Color'] as EnumSchema).variants.get('RGB')!.foreign = true
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
          name: {type: 'string', optional: true},
          age: {type: 'uint', optional: true},
          addresses: {type: {type: 'list', fieldType: 'string'}, optional: true}
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

{
  // Test inlined and non-inlined booleans
  const schema: Schema = {
    id: 'Example',
    root: ref('Bools'),
    types: {
      Bools: {
        type: 'struct',
        fields: new Map<string, StructField>([
          ['a', {type: 'bool', encoding: 'required', inline: false}],
          ['b', {type: 'bool', encoding: 'optional', inline: false}],

          ['c', {type: 'bool', encoding: 'required', inline: true}],
          ['d', {type: 'bool', encoding: 'optional', inline: true}],
        ])
      }
    }
  }

  testRoundTripFullSchema(schema, {a: true, b: true, c: true, d: true})
  testRoundTripFullSchema(schema, {a: true, b: false, c: true, d: false})
  testRoundTripFullSchema(schema, {a: true, c: true},
    {a: true, b: null, c: true, d: null}
  )
  testRoundTripFullSchema(schema, {a: false, c: false},
    {a: false, b: null, c: false, d: null}
  )
}

{
  // Test inlined and non-inlined booleans with default values
  const schema: Schema = {
    id: 'Example',
    root: ref('Bools'),
    types: {
      Bools: {
        type: 'struct',
        fields: new Map<string, StructField>([
          ['a', {type: 'bool', encoding: 'required', inline: false, defaultValue: true}],
          ['b', {type: 'bool', encoding: 'required', inline: false, defaultValue: false}],
          ['c', {type: 'bool', encoding: 'required', inline: true, defaultValue: true}],
          ['d', {type: 'bool', encoding: 'required', inline: true, defaultValue: false}],
        ])
      }
    }
  }

  testRoundTripFullSchema(schema, {a: true, b: true, c: true, d: true})
  testRoundTripFullSchema(schema, {a: false, b: false, c: false, d: false})
  testRoundTripFullSchema(schema, {a: true, b: false, c: false, d: true})
  testRoundTripFullSchema(schema, {}, {a: true, b: false, c: true, d: false})
  testRoundTripFullSchema(schema, {a: false, d: true}, {a: false, b: false, c: true, d: true})
}


