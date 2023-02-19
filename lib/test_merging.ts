import * as assert from 'assert/strict'
import { EnumSchema, Schema, StructSchema } from './schema.js'
import { enumOfStrings, enumOfStringsSimple, extendSchema, mergeSchemas, ref } from './utils.js'
import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

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

const testForeignMergesProperly = () => {
  const fileSchema: Schema = {
    id: 'Example',
    root: ref('Contact'),
    types: {
      Contact: {
        type: 'struct',
        encodingOrder: ['age', 'name'],
        foreign: true,
        fields: {
          name: {type: 'string', foreign: true, optional: false},
          age: {type: 'uint', foreign: true, optional: false}
          // address: {type: 'string'},
        }
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
        encodingOrder: [],
        fields: {
          // name: {type: 'string'},
          age: {type: 'uint', optional: true, renameFieldTo: 'yearsOld'},
          address: {type: 'string', optional: true, defaultValue: 'unknown location'},
        }
      },
      Color: enumOfStrings('Red', 'Bronze'),
    }
  }

  const merged = mergeSchemas(fileSchema, appSchema)
  console.log(merged)

  assert.equal(true, (merged.types.Contact as StructSchema).fields.name.foreign)
  assert.equal(false, (merged.types.Contact as StructSchema).fields.age.foreign)
  assert.equal(false, (merged.types.Contact as StructSchema).fields.address.foreign)

  assert.equal(false, (merged.types.Color as EnumSchema).variants.Red.foreign ?? false)
  assert.equal(true, (merged.types.Color as EnumSchema).variants.Blue.foreign ?? false)
  assert.equal(false, (merged.types.Color as EnumSchema).variants.Bronze.foreign ?? false)
}

// testClosedEnum()
testForeignMergesProperly()
