// Test that we can extend schemas
import 'mocha'
import { AppSchema } from '../lib/schema.js'
import { Bool, enumOfStringsSimple, extendSchema, prim, ref, String } from '../lib/utils.js'

import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

describe('extend', () => {
  it('simple test', () => {
    const schema: AppSchema = {
      id: 'Example',
      root: ref('Contact'),
      types: {
        Contact: {
          type: 'struct',
          fields: {
            name: 'string',
            address: 'string',
            coolness: 'bool',
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
                fields: { x: {type: 'f32'}, y: 'f32'}
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