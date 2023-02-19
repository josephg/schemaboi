import * as assert from 'assert/strict'
import { EnumSchema, Schema, SimpleSchema } from './schema.js'
import { extendSchema, mergeSchemas, ref } from './utils.js'

const testClosedEnum = () => {

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

  {
    const schemaA: Schema = makeS('Red')
    const schemaB: Schema = makeS('Blue', false)

    const merged = mergeSchemas(schemaA, schemaB)

    const color = merged.types['Color'] as EnumSchema
    assert.equal(Object.keys(color.variants).length, 2)
    assert.equal(color.closed, false)
  }

  // But if one of them is closed, we should throw.
  {
    const schemaA: Schema = makeS('Red', true)
    const schemaB: Schema = makeS('Blue', false)
    assert.throws(() => {
      mergeSchemas(schemaA, schemaB)
    })
  }

  // If they both have the same fields, it should be fine though.
  {
    const schemaA: Schema = makeS('Red', true)
    const schemaB: Schema = makeS('Red', false)
    const merged = mergeSchemas(schemaA, schemaB)
    const color = merged.types['Color'] as EnumSchema
    assert.equal(color.closed, true)
  }
}

testClosedEnum()
