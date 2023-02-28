// Test that we can extend schemas
import 'mocha'
import { SimpleSchema } from '../lib/schema.js'
import { enumOfStringsSimple, extendSchema, ref } from '../lib/utils.js'


describe('extend', () => {
  it('simple test', () => {
    const schema: SimpleSchema = {
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

        Shape: {
          type: 'enum',
          numericOnly: false,
          variants: {
            Line: null,
            Square: {
              associatedData: {
                type: 'struct',
                fields: { x: {type: 'f32'}, y: {type: 'f32'} }
              }
            }
          }
        },

        Color: enumOfStringsSimple('Green', 'Red', 'Purple')
      }
    }

    // console.log('encoding', simpleSchemaEncoding(schema))
    // console.log('js', simpleJsMap(schema))


    // TODO: We're not actually checking that this schema makes any sense!
    // console.log(extendSchema(schema))
  })
})