// This file checks that we can store a bunch of stuff, and when we do we get the same data back out.
import 'mocha'
import {AppSchema, Schema, EnumSchema, StructField} from "../lib/schema.js"
import { Bool, enumOfStringsSimple, extendSchema, Id, prim, ref, String } from "../lib/utils.js"
import { readRaw, read } from "../lib/read.js"
import { writeRaw, write } from "../lib/write.js"

import fs from 'fs'
import * as assert from 'assert/strict'
// import {Console} from 'node:console'
// const console = new Console({
//   stdout: process.stdout,
//   stderr: process.stderr,
//   inspectOptions: {depth: null}
// })

const testRoundTripFullSchema = (schema: Schema, input: any, expectedOutput = input) => {
  const bytes = writeRaw(schema, input)
  // console.log('bytes', bytes)
  const result = readRaw(schema, bytes)
  // console.log('result', result)

  assert.deepEqual(result, expectedOutput)


  {
    const opaque = write(schema, input)
    // console.log('opaque', opaque)
    // fs.writeFileSync('tmp_test.sb', opaque)
    const [fileSchema, result] = read(schema, opaque)
    assert.deepEqual(result, expectedOutput)
  }

}

const testRoundTrip = (schema: AppSchema, input: any, expectedOutput = input) => {
  const fullSchema = extendSchema(schema)
  // console.log('fullSchema', fullSchema)
  testRoundTripFullSchema(fullSchema, input, expectedOutput)
}

describe('roundtrips', () => {
  describe('non objects at the root', () => {
    it('works with strings', () => {
      const schema: AppSchema = {
        id: 'Example',
        root: 'string',
        types: {}
      }

      testRoundTrip(schema, 'hi there')
    })

    it('works with lists', () => {
      const schema: AppSchema = {
        id: 'Example',
        root: {type: 'list', fieldType: 'f64'},
        types: {}
      }

      testRoundTrip(schema, [1.1, 2.2, 3,3])
    })

    it('works with maps', () => {
      const schema: AppSchema = {
        id: 'Example',
        root: {type: 'map', keyType: 'string', valType: 'f64'},
        types: {}
      }
    
      testRoundTrip(schema, {aa: 123, bb: 213.23})
    })

    it('works with maps using entry list decoding form', () => {
      const schema: AppSchema = {
        id: 'Example',
        root: {type: 'map', keyType: 'string', valType: 'f64', decodeForm: 'entryList'},
        types: {}
      }

      testRoundTrip(schema, [['aa', 123], ['bb', 213.23]])
      testRoundTrip(schema, new Map([['aa', 123], ['bb', 213.23]]), [['aa', 123], ['bb', 213.23]])
      testRoundTrip(schema, {aa: 123, bb: 213.23}, [['aa', 123], ['bb', 213.23]])
    })

    it('works with maps using map decoding form', () => {
      const schema: AppSchema = {
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
    const schema: AppSchema = {
      id: 'Example',
      root: 'Contact',
      types: {
        Contact: {
          type: 'struct',
          fields: {
            name: 'string',
          }
        }
      }
    }

    testRoundTrip(schema, {name: 'seph'})
  })

  describe('enums', () => {
    it('simple enums', () => {
      // Numeric Enum
      const schema: AppSchema = {
        id: 'Example',
        root: 'Color',
        types: {
          // Color: enumOfStringsSimple('Red', 'Blue', 'Green'),
          Color: {
            type: 'enum',
            numericOnly: true,
            variants: ['Red', 'Blue', 'Green'],
          }
        }
      }

      testRoundTrip(schema, 'Red')
      testRoundTrip(schema, 'Blue')
    })

    it('enums with associated data and optional fields', () => {
      // Enum
      const schema: AppSchema = {
        id: 'Example',
        root: 'Color',
        types: {
          Color: {
            type: 'enum',
            numericOnly: false,
            variants: {
              Blue: null,
              Red: null,
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
      const SimpleSchema: AppSchema = {
        id: 'Example',
        root: 'Color',
        types: {
          Color: {
            type: 'enum',
            numericOnly: false,
            variants: {
              Blue: true,
              Red: true,
              RGB: {
                associatedData: {
                  fields: { r: 'u8', g: 'u8', b: 'u8' }
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
      const schema: AppSchema = {
        id: 'Example',
        root: 'Contact',
        types: {
          Contact: {
            type: 'struct',
            fields: {
              name: {type: 'string', optional: true},
              age: {type: 'u32', optional: true},
              addresses: {type: 'list', fieldType: 'string', optional: true}
              // address: {type: String},
            }
          }
        }
      }

      testRoundTrip(schema, {name: 'seph', age: 21, addresses: ['123 Example St', '456 Somewhere else']})
      testRoundTrip(schema, {name: 'seph', age: null, addresses: ['123 Example St', '456 Somewhere else']})
      testRoundTrip(schema, {name: null, age: null, addresses: null})
      testRoundTrip(schema, {name: null, age: null, addresses: []})
    })

    it('re-encodes foreign fields when serializing', () => {
      const schema: Schema = {
        id: 'Example',
        root: ref('Contact'),
        types: {
          Contact: {
            type: 'struct',
            // encodingOrder: [],
            fields: new Map<string, StructField>([
              ['name', {type: String}],
              ['age', {type: prim('u32'), foreign: true}],
            ])
          },
        }
      }

      testRoundTripFullSchema(schema, {name: 'seph', _foreign: {age: 32}})
      testRoundTripFullSchema(schema, {name: 'seph', age: 32}, {name: 'seph', _foreign: {age: 32}})
    })

    it('supports inlined and non-inlined booleans', () => {
      const schema: Schema = {
        id: 'Example',
        root: ref('Bools'),
        types: {
          Bools: {
            type: 'struct',
            fields: new Map<string, StructField>([
              ['a', {type: Bool, optional: false, inline: false}],
              ['b', {type: Bool, optional: true, inline: false}],

              ['c', {type: Bool, optional: false, inline: true}],
              ['d', {type: Bool, optional: true, inline: true}],
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
              ['a', {type: Bool, optional: false, inline: false, defaultValue: true}],
              ['b', {type: Bool, optional: false, inline: false, defaultValue: false}],
              ['c', {type: Bool, optional: false, inline: true, defaultValue: true}],
              ['d', {type: Bool, optional: false, inline: true, defaultValue: false}],
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

    describe('numerics', () => {
      it('works with default options', () => {
        const schema: AppSchema = {
          id: 'Example',
          root: 'NumTest',
          types: {
            NumTest: {
              type: 'struct',
              fields: {
                u8V: {type: 'u8', numericEncoding: 'varint'},
                s8V: {type: 's8', numericEncoding: 'varint'},
                u8: 'u8',
                u16: 'u16',
                u32: 'u32',
                u64: 'u64',
                u128: 'u128',

                s8: 's8',
                s16: 's16',
                s32: 's32',
                s64: 's64',
                s128: 's128',
              }
            }
          }
        }

        testRoundTrip(schema, {
          u8V: 200, s8V: -127,
          u8: 0xff, u16: 0xffff, u32: 0xffffffff, u64: Number.MAX_SAFE_INTEGER, u128: Number.MAX_SAFE_INTEGER,
          s8: -0x80, s16: -0x8000, s32: -0x80000000, s64: 0, s128: 0,
          // s8: -0x80, s16: -0x8000, s32: -0x80000000, s64: Number.MIN_SAFE_INTEGER, s128: Number.MIN_SAFE_INTEGER,
        })
        testRoundTrip(schema, {
          u8V: 200n, s8V: -127n,
          u8: 0xffn, u16: 0xffffn, u32: 0xffffffffn, u64: BigInt(Number.MAX_SAFE_INTEGER), u128: BigInt(Number.MAX_SAFE_INTEGER),
          s8: -0x80n, s16: -0x8000n, s32: -0x80000000n, s64: 0n, s128: 0n,
        }, {
          u8V: 200, s8V: -127,
          u8: 0xff, u16: 0xffff, u32: 0xffffffff, u64: Number.MAX_SAFE_INTEGER, u128: Number.MAX_SAFE_INTEGER,
          s8: -0x80, s16: -0x8000, s32: -0x80000000, s64: 0, s128: 0,
        })
      })

      it('decodes bigints', () => {
        const schema: AppSchema = {
          id: 'Example',
          root: 'NumTest',
          types: {
            NumTest: {
              type: 'struct',
              fields: {
                u8V: {type: 'u8', decodeAsBigInt: true, numericEncoding: 'varint'},
                s8V: {type: 's8', decodeAsBigInt: true, numericEncoding: 'varint'},
                u8: {type: 'u8', decodeAsBigInt: true},
                u16: {type: 'u16', decodeAsBigInt: true},
                u32: {type: 'u32', decodeAsBigInt: true},
                u64: {type: 'u64', decodeAsBigInt: true},
                u128: {type: 'u128', decodeAsBigInt: true},

                s8: {type: 's8', decodeAsBigInt: true},
                s16: {type: 's16', decodeAsBigInt: true},
                s32: {type: 's32', decodeAsBigInt: true},
                s64: {type: 's64', decodeAsBigInt: true},
                s128: {type: 's128', decodeAsBigInt: true},
              }
            }
          }
        }

        testRoundTrip(schema, {
          u8V: 200n, s8V: -127n,
          u8: 0xffn, u16: 0xffffn, u32: 0xffffffffn, u64: 2n ** 64n - 1n, u128: 2n ** 128n - 1n,
          s8: -0x80n, s16: -0x8000n, s32: -0x80000000n, s64: -(2n ** 63n), s128: -(2n ** 127n - 1n),
        })
      })

    })

    it('ids', () => {
      const schema: AppSchema = {
        id: 'Example',
        root: {type: 'list', fieldType: 'IdTest'},
        types: {
          IdTest: {
            type: 'struct',
            fields: {
              foo: 'id',
              bar: 'id',
            }
          }
        }
      }

      testRoundTrip(schema, [{foo: 'a', bar: 'a'}])
      testRoundTrip(schema, [{foo: 'a', bar: 'b'}])
      testRoundTrip(schema, [{foo: 'a', bar: 'b'}, {foo: 'a', bar: 'b'}])
      testRoundTrip(schema, [{foo: 'a', bar: 'b'}, {foo: 'b', bar: 'a'}])
    })

  })
})
