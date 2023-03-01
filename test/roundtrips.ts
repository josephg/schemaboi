// This file checks that we can store a bunch of stuff, and when we do we get the same data back out.
import 'mocha'
import {SimpleSchema, Schema, EnumSchema, StructField} from "../lib/schema.js"
import { enumOfStringsSimple, extendSchema, ref } from "../lib/utils.js"
import { readData } from "../lib/read.js"
import { toBinary } from "../lib/write.js"

import * as assert from 'assert/strict'
// import {Console} from 'node:console'
// const console = new Console({
//   stdout: process.stdout,
//   stderr: process.stderr,
//   inspectOptions: {depth: null}
// })

const testRoundTripFullSchema = (schema: Schema, input: any, expectedOutput = input) => {
  const bytes = toBinary(schema, input)
  // console.log('bytes', bytes)
  const result = readData(schema, bytes)
  // console.log('result', result)

  assert.deepEqual(result, expectedOutput)
}

const testRoundTrip = (schema: SimpleSchema, input: any, expectedOutput = input) => {
  const fullSchema = extendSchema(schema)
  // console.log('fullSchema', fullSchema)
  testRoundTripFullSchema(fullSchema, input, expectedOutput)
}

describe('roundtrips', () => {
  describe('non objects at the root', () => {
    it('works with strings', () => {
      const schema: SimpleSchema = {
        id: 'Example',
        root: 'string',
        types: {}
      }
    
      testRoundTrip(schema, 'hi there')
    })

    it('works with lists', () => {
      const schema: SimpleSchema = {
        id: 'Example',
        root: {type: 'list', fieldType: 'f64'},
        types: {}
      }
    
      testRoundTrip(schema, [1.1, 2.2, 3,3])
    })

    it('works with maps', () => {
      const schema: SimpleSchema = {
        id: 'Example',
        root: {type: 'map', keyType: 'string', valType: 'f64'},
        types: {}
      }
    
      testRoundTrip(schema, {aa: 123, bb: 213.23})
    })

    it('works with maps using entry list decoding form', () => {
      const schema: SimpleSchema = {
        id: 'Example',
        root: {type: 'map', keyType: 'string', valType: 'f64', decodeForm: 'entryList'},
        types: {}
      }

      testRoundTrip(schema, [['aa', 123], ['bb', 213.23]])
      testRoundTrip(schema, new Map([['aa', 123], ['bb', 213.23]]), [['aa', 123], ['bb', 213.23]])
      testRoundTrip(schema, {aa: 123, bb: 213.23}, [['aa', 123], ['bb', 213.23]])
    })

    it('works with maps using map decoding form', () => {
      const schema: SimpleSchema = {
        id: 'Example',
        root: {type: 'map', keyType: 'string', valType: 'f64', decodeForm: 'map'},
        types: {}
      }
    
      testRoundTrip(schema, new Map([['aa', 123], ['bb', 213.23]]))
      testRoundTrip(schema, {aa: 123, bb: 213.23}, new Map([['aa', 123], ['bb', 213.23]]))
    })
  })

  // *****
  it('works with simple structs', () => {
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
  })

  it('works with all numeric types', () => {
    const schema: SimpleSchema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          type: 'struct',
          fields: {
            u8: {type: 'u8'},
            u16: {type: 'u16'},
            u32: {type: 'u32'},
            u64: {type: 'u64'},
            u128: {type: 'u128'},

            s8: {type: 's8'},
            s16: {type: 's16'},
            s32: {type: 's32'},
            s64: {type: 's64'},
            s128: {type: 's128'},
          }
        }
      }
    }

    testRoundTrip(schema, {
      u8: 0xff, u16: 0xffff, u32: 0xffffffff, u64: Number.MAX_SAFE_INTEGER, u128: Number.MAX_SAFE_INTEGER,
      s8: -0x80, s16: -0x8000, s32: -0x80000000, s64: 0, s128: 0,
      // s8: -0x80, s16: -0x8000, s32: -0x80000000, s64: Number.MIN_SAFE_INTEGER, s128: Number.MIN_SAFE_INTEGER,
    })
  })

  describe('enums', () => {
    it('simple enums', () => {
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
    })

    it('enums with associated data and optional fields', () => {
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
                    r: {type: 'u8', optional: true},
                    g: {type: 'u8', optional: true},
                    b: {type: 'u8', optional: true},
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

    })

    it('tags foreign variants', () => {
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
                    r: {type: 'u8'},
                    g: {type: 'u8'},
                    b: {type: 'u8'},
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
    })
  })


  describe('structs', () => {
    it('allows optional struct fields', () => {
      // Test nullable struct fields
      const schema: SimpleSchema = {
        id: 'Example',
        root: ref('Contact'),
        types: {
          Contact: {
            type: 'struct',
            fields: {
              name: {type: 'string', optional: true},
              age: {type: 'u32', optional: true},
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
    })

    it('supports inlined and non-inlined booleans', () => {
      const schema: Schema = {
        id: 'Example',
        root: ref('Bools'),
        types: {
          Bools: {
            type: 'struct',
            fields: new Map<string, StructField>([
              ['a', {type: 'bool', optional: false, inline: false}],
              ['b', {type: 'bool', optional: true, inline: false}],

              ['c', {type: 'bool', optional: false, inline: true}],
              ['d', {type: 'bool', optional: true, inline: true}],
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
    })

    it('works with inlined and non-inlined booleans with default values', () => {
      const schema: Schema = {
        id: 'Example',
        root: ref('Bools'),
        types: {
          Bools: {
            type: 'struct',
            fields: new Map<string, StructField>([
              ['a', {type: 'bool', optional: false, inline: false, defaultValue: true}],
              ['b', {type: 'bool', optional: false, inline: false, defaultValue: false}],
              ['c', {type: 'bool', optional: false, inline: true, defaultValue: true}],
              ['d', {type: 'bool', optional: false, inline: true, defaultValue: false}],
            ])
          }
        }
      }

      testRoundTripFullSchema(schema, {a: true, b: true, c: true, d: true})
      testRoundTripFullSchema(schema, {a: false, b: false, c: false, d: false})
      testRoundTripFullSchema(schema, {a: true, b: false, c: false, d: true})
      testRoundTripFullSchema(schema, {}, {a: true, b: false, c: true, d: false})
      testRoundTripFullSchema(schema, {a: false, d: true}, {a: false, b: false, c: true, d: true})
    })
  })
})
