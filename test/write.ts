import 'mocha'
import * as assert from 'assert/strict'
import { writeRaw } from '../lib/write.js'
import { Schema, AppSchema, Field, EnumSchema } from '../lib/schema.js'
import { Bool, extendSchema, prim, ref, String, structSchema } from '../lib/utils.js'

describe('write', () => {
  it('simple test', () => {
    const schema: Schema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: structSchema([
          ['name', {type: String, optional: true}],
          ['age', {type: prim('u32')}]
          // address: {type: String},
        ])
      }
    }

    const data = {name: 'seph', age: 21}

    const out = writeRaw(schema, data)
    // console.log('out', out)
    assert.deepEqual(out, new Uint8Array([1, 4, 115, 101, 112, 104, 21]))
  })

  it('kitchen sink test', () => {
    const schema: AppSchema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          fields: {
            name: String,
            age: {type: 'u32', optional: false},
            supercool: {type: 'bool', defaultValue: true},
            addresses: {type: 'list', fieldType: String},
            // address: {type: String},
            favoriteColor: {type: 'ref', key: 'Color'},
            worstColor: {type: 'ref', key: 'Color'},
            hairColor: {type: 'ref', key: 'Color'},
          }
        },
  
        Color: {
          type: 'enum',
          numericOnly: false,
          variants: {
            Blue: null,
            Red: null,
            RGB: {
              fields: {
                r: 'u32',
                g: 'u32',
                b: 'u32',
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

    const out = writeRaw(extendSchema(schema), data)
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

  it('encodes varint when asked', () => {
    {
      const schema: AppSchema = {
        id: 'Example',
        root: {type: 'u8', numericEncoding: 'le'},
        types: {}
      }

      const out = writeRaw(extendSchema(schema), 205)
      assert.deepEqual(out, new Uint8Array([205]))
    }

    {
      const schema: AppSchema = {
        id: 'Example',
        root: {type: 'u8', numericEncoding: 'varint'},
        types: {}
      }

      const out = writeRaw(extendSchema(schema), 205)
      assert.deepEqual(out, new Uint8Array([0x80, 77]))
    }
  })
})
