import 'mocha'
import * as assert from 'assert/strict'
import { toBinary } from '../lib/write.js'
import { Schema, SimpleSchema } from '../lib/schema.js'
import { extendSchema, mergeSchemas, ref } from '../lib/utils.js'

describe('write', () => {
  it('simple test', () => {
    const schema: Schema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          type: 'struct',
          fields: new Map([
            ['name', {type: 'string', encoding: 'optional'}],
            ['age', {type: 'uint', encoding: 'required'}]
            // address: {type: 'string'},
          ])
        }
      }
    }
  
    const data = {name: 'seph', age: 21}

    const out = toBinary(schema, data)
    // console.log('out', out)
    assert.deepEqual(out, new Uint8Array([1, 4, 115, 101, 112, 104, 21]))
  })

  it('kitchen sink test', () => {
    const schema: SimpleSchema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          type: 'struct',
          fields: {
            name: {type: 'string'},
            age: {type: 'uint', optional: false},
            supercool: {type: 'bool', defaultValue: true},
            addresses: {type: {type: 'list', fieldType: 'string'}},
            // address: {type: 'string'},
            favoriteColor: {type: {type: 'ref', key: 'Color'}},
            worstColor: {type: {type: 'ref', key: 'Color'}},
            hairColor: {type: {type: 'ref', key: 'Color'}},
          }
        },
  
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
  
    const data = {
      name: 'seph',
      age: 21,
      addresses: ['123 Example St', '456 Somewhere else'],
      favoriteColor: 'Red',
      hairColor: {type: 'Blue'},
      worstColor: {type: 'RGB', r: 10, g: 50, b: 100},
    }

    // console.log('schema', extendSchema(schema))
    // console.log(toBinary(extendSchema(schema), data))

    const out = toBinary(extendSchema(schema), data)
    // console.log(out)

    const expected = new Uint8Array([
      1,   4, 115, 101, 112, 104,  21,   2,  14,  49,
      50,  51,  32,  69, 120,  97, 109, 112, 108, 101,
      32,  83, 116,  18,  52,  53,  54,  32,  83, 111,
      109, 101, 119, 104, 101, 114, 101,  32, 101, 108,
      115, 101,   1,   2,  10,  50, 100,   0
    ])
    // This will fail if the encoding system changes.
    assert.deepEqual(expected, out)
  })
})
