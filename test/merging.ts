import * as assert from 'assert/strict'
import { EnumSchema, EnumVariant, Schema, Field } from '../lib/schema.js'
import { enumOfStringsEncoding, enumOfStrings, extendSchema, fillSchemaDefaults, mergeSchemas, prim, ref, String, structSchema } from '../lib/utils.js'
import { write } from '../lib/write.js'
import { read } from '../lib/read.js'
// import {Console} from 'node:console'
// const console = new Console({
//   stdout: process.stdout,
//   stderr: process.stderr,
//   inspectOptions: {depth: null}
// })

describe('merging', () => {
  describe('exhaustive enums', () => {
    const makeS = (color: string, exhaustive?: boolean): Schema => (extendSchema({
      id: 'Example',
      root: ref('Color'),
      types: {
        Color: {
          type: 'enum',
          numericOnly: true,
          exhaustive: exhaustive,
          variants: { [color]: true, }
        }
      }
    }))

    it('merges if it can', () => {
      const schemaA: Schema = makeS('Red')
      const schemaB: Schema = makeS('Blue', false)

      const merged = mergeSchemas(schemaA, schemaB)

      const color = merged.types['Color'] as EnumSchema
      assert.equal(color.variants.size, 2)
      assert.equal(color.exhaustive, false)
    })

    it('throws if one of them is exhaustive', () => {
      const schemaA: Schema = makeS('Red', true)
      const schemaB: Schema = makeS('Blue', false)
      assert.throws(() => {
        mergeSchemas(schemaA, schemaB)
      })
    })

    it('supports merging exhaustive structs when they have the same fields', () => {
      const schemaA: Schema = makeS('Red', true)
      const schemaB: Schema = makeS('Red', false)
      const merged = mergeSchemas(schemaA, schemaB)
      const color = merged.types['Color'] as EnumSchema
      assert.equal(color.exhaustive, true)
    })
  })

  describe('foreign merges', () => {
    const fileSchema: Schema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          foreign: true,
          exhaustive: false,
          numericOnly: false,
          localStructIsVariant: 'default',
          variants: new Map([['default', {
            foreign: false,
            skip: false,
            fields: new Map<string, Field>([
              ['name', {type: String, foreign: true, optional: false}],
              ['age', {type: prim('u32'), foreign: true, optional: false}],
              // address: {type: String},
            ])
          }]]),

          // encodingOrder: ['age', 'name'],
        },
        Color: enumOfStringsEncoding('Red', 'Blue'),
      }
    }

    const appSchema: Schema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: structSchema('default', [
            // name: {type: String},
            ['age', {type: prim('u32'), renameFieldTo: 'yearsOld'}],
            ['address', {type: String, defaultValue: 'unknown location'}],
            // ['age', {type: prim('u32'), skip: true, renameFieldTo: 'yearsOld'}],
            // ['address', {type: String, skip: true, defaultValue: 'unknown location'}],
        ]),
        Color: enumOfStringsEncoding('Red', 'Bronze'),
      }
    }

    it('merges', () => {
      const merged = mergeSchemas(fileSchema, appSchema)
      // console.log(merged)

      assert.equal(true, merged.types.Contact.variants.get('default')!.fields!.get('name')!.foreign)
      assert.equal(false, merged.types.Contact.variants.get('default')!.fields!.get('age')!.foreign)
      assert.equal(false, merged.types.Contact.variants.get('default')!.fields!.get('address')!.foreign)

      assert.equal(false, (merged.types.Color).variants.get('Red')!.foreign ?? false)
      assert.equal(true, (merged.types.Color).variants.get('Blue')!.foreign ?? false)
      assert.equal(false, (merged.types.Color).variants.get('Bronze')!.foreign ?? false)
    })

    it('merges via opaque data', () => {
      // const data = writeOpaqueData(appSchema, {age: 12, address: 'somewhere'})
      const data = write(fileSchema, {name: 'simone', age: 41})
      const [schema, loaded] = read(appSchema, data)
      assert.deepEqual(loaded, {yearsOld: 41, address: 'unknown location', _foreign: {name: 'simone'}})
    })
  })

  it('merges non-overlapping struct fields', () => {
    const remote: Schema = extendSchema({
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          type: 'struct',
          fields: {
            name: 'string',
            address: 'string',
          }
        },
        Color: enumOfStrings('Red', 'Green'),
      }
    })

    const local: Schema = extendSchema({
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          type: 'struct',
          fields: {
            name: {type: 'string', defaultValue: 'Bruce'},
            phoneNo: {type: 'string'},
          }
        },
        Color: enumOfStrings('Green', 'Blue'),
      }
    })

    const merged = mergeSchemas(remote, local)

    const expected: Schema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          foreign: false,
          exhaustive: false,
          numericOnly: false,
          localStructIsVariant: 'default',
          variants: new Map<string, EnumVariant>([['default', {
            foreign: false,
            fields: new Map<string, Field>([
              ['name', {type: String, foreign: false, skip: false, defaultValue: 'Bruce', optional: false}],
              ['address', {type: String, foreign: true, skip: false, optional: false}],
              ['phoneNo', {type: String, foreign: false, skip: true, optional: false}],
            ])
          }]]),
        },

        Color: {
          foreign: false,
          exhaustive: false,
          numericOnly: true,
          variants: new Map<string, EnumVariant>([
            ['Red', {foreign: true}],
            ['Green', {foreign: false}],
            ['Blue', {foreign: false}],
          ])
        },

      }
    }
    fillSchemaDefaults(merged, false)
    fillSchemaDefaults(expected, false)

    assert.deepEqual(merged, expected)
  })
})
