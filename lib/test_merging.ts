import * as assert from 'assert/strict'
import { PureSchema, ref } from './schema.js'
import { mergeSchemas } from './utils.js'

const testClosedEnum = () => {

  const makeS = (color: string, closed?: boolean): PureSchema => ({
    id: 'Example',
    root: ref('Color'),
    types: {
      Color: {
        type: 'enum',
        closed,
        variants: { [color]: {}, }
      }
    }
  })

  {
    const schemaA: PureSchema = makeS('Red')
    const schemaB: PureSchema = makeS('Blue', false)

    const merged = mergeSchemas(schemaA, schemaB)
    assert.equal(Object.keys(merged.types['Color'].variants).length, 2)
    assert.equal(merged.types['Color'].closed, false)
  }

  // But if one of them is closed, we should throw.
  {
    const schemaA: PureSchema = makeS('Red', true)
    const schemaB: PureSchema = makeS('Blue', false)
    assert.throws(() => {
      mergeSchemas(schemaA, schemaB)
    })
  }

  // If they both have the same fields, it should be fine though.
  {
    const schemaA: PureSchema = makeS('Red', true)
    const schemaB: PureSchema = makeS('Red', false)
    const merged = mergeSchemas(schemaA, schemaB)
    assert.equal(merged.types['Color'].closed, true)
  }
}

testClosedEnum()