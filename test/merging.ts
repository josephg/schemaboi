import * as assert from 'assert/strict'
import { EnumSchema, EnumVariant, Schema, StructField, StructSchema } from '../lib/schema.js'
import { enumOfStrings, enumOfStringsSimple, extendSchema, mergeSchemas, ref } from '../lib/utils.js'
// import {Console} from 'node:console'
// const console = new Console({
//   stdout: process.stdout,
//   stderr: process.stderr,
//   inspectOptions: {depth: null}
// })

describe('merging', () => {
  describe('closed enums', () => {
    const makeS = (color: string, closed?: boolean): Schema => (extendSchema({
      id: 'Example',
      root: ref('Color'),
      types: {
        Color: {
          type: 'enum',
          numericOnly: true,
          closed,
          variants: { [color]: {}, }
        }
      }
    }))

    it('merges if it can', () => {
      const schemaA: Schema = makeS('Red')
      const schemaB: Schema = makeS('Blue', false)

      const merged = mergeSchemas(schemaA, schemaB)

      const color = merged.types['Color'] as EnumSchema
      assert.equal(color.variants.size, 2)
      assert.equal(color.closed, false)
    })

    it('throws if one of them is closed', () => {
      const schemaA: Schema = makeS('Red', true)
      const schemaB: Schema = makeS('Blue', false)
      assert.throws(() => {
        mergeSchemas(schemaA, schemaB)
      })
    })

    it('supports merging closed structs when they have the same fields', () => {
      const schemaA: Schema = makeS('Red', true)
      const schemaB: Schema = makeS('Red', false)
      const merged = mergeSchemas(schemaA, schemaB)
      const color = merged.types['Color'] as EnumSchema
      assert.equal(color.closed, true)
    })
  })

  describe('foreign merges', () => {
    const fileSchema: Schema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          type: 'struct',
          // encodingOrder: ['age', 'name'],
          foreign: true,
          fields: new Map<string, StructField>([
            ['name', {type: 'string', foreign: true, optional: false}],
            ['age', {type: 'uint', foreign: true, optional: false}],
            // address: {type: 'string'},
          ])
        },
        Color: enumOfStrings('Red', 'Blue'),
      }
    }

    const appSchema: Schema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          type: 'struct',
          // encodingOrder: [],
          fields: new Map<string, StructField>([
            // name: {type: 'string'},
            ['age', {type: 'uint', skip: true, renameFieldTo: 'yearsOld'}],
            ['address', {type: 'string', skip: true, defaultValue: 'unknown location'}],
          ])
        },
        Color: enumOfStrings('Red', 'Bronze'),
      }
    }

    it('merges', () => {
      const merged = mergeSchemas(fileSchema, appSchema)
      // console.log(merged)

      assert.equal(true, (merged.types.Contact as StructSchema).fields.get('name')!.foreign)
      assert.equal(false, (merged.types.Contact as StructSchema).fields.get('age')!.foreign)
      assert.equal(false, (merged.types.Contact as StructSchema).fields.get('address')!.foreign)

      assert.equal(false, (merged.types.Color as EnumSchema).variants.get('Red')!.foreign ?? false)
      assert.equal(true, (merged.types.Color as EnumSchema).variants.get('Blue')!.foreign ?? false)
      assert.equal(false, (merged.types.Color as EnumSchema).variants.get('Bronze')!.foreign ?? false)
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
            name: {type: 'string'},
            address: {type: 'string'},
          }
        },
        Color: enumOfStringsSimple('Red', 'Green'),
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
        Color: enumOfStringsSimple('Green', 'Blue'),
      }
    })

    const merged = mergeSchemas(remote, local)

    const expected: Schema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          type: 'struct',
          foreign: false,
          fields: new Map<string, StructField>([
            ['name', {type: 'string', foreign: false, skip: false, defaultValue: 'Bruce', optional: false, renameFieldTo: undefined}],
            ['address', {type: 'string', foreign: true, skip: false, defaultValue: undefined, optional: false, renameFieldTo: undefined}],
            ['phoneNo', {type: 'string', foreign: false, skip: true, defaultValue: undefined, optional: false, renameFieldTo: undefined}],
          ])
        },

        Color: {
          type: 'enum',
          foreign: false,
          numericOnly: true,
          closed: false,
          variants: new Map<string, EnumVariant>([
            ['Red', {foreign: true, skip: false, associatedData: undefined}],
            ['Green', {foreign: false, skip: false, associatedData: undefined}],
            ['Blue', {foreign: false, skip: true, associatedData: undefined}],
          ])
        }
      }
    }
    assert.deepEqual(merged, expected)
  })
})
