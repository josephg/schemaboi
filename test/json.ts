import 'mocha'
import { AppSchema, extendSchema } from '../lib/index.js'
import { write, writeAppSchema, writeRaw } from '../lib/write.js'
import { read, readRaw } from '../lib/read.js'
import * as assert from 'assert/strict'

// The encoder needs the data to be in a certain shape to correctly encode and decode enums.
type JSONValueEnc = {type: 'null' | 'true' | 'false'}
  | {type: 'float', val: number}
  | {type: 'int', val: number}
  | {type: 'string', val: string}
  | {type: 'object', val: Record<string, JSONValueEnc>}
  | {type: 'list', val: JSONValueEnc[]}

const errExpr = (msg: string): any => {throw Error(msg)}

function encode(val: any): JSONValueEnc {
  return val == null ? {type: 'null'}
    : val === true ? {type: 'true'}
    : val === false ? {type: 'false'}
    : typeof val === 'string' ? {type: 'string', val}
    : typeof val === 'number' ? (Number.isInteger(val) ? {type: 'int', val} : {type: 'float', val})
    : Array.isArray(val) ? {type: 'list', val}
    // : Array.isArray(obj) ? {type: 'list', val: obj.map(encode)}
    : typeof val === 'object' ? {type: 'object', val}
    // : typeof val === 'object' ? {type: 'object', val: objMap(val, encode)}
    : errExpr('Not recognised value: ' + val)
}

function decode(_variant: string, val: Record<string, any> | null): any {
  const variant = _variant as JSONValueEnc['type']

  // console.log('decode', variant, val)

  switch (variant) {
    case 'null': return null
    case 'true': return true
    case 'false': return false
    case 'float': case 'int': case 'string':
    case 'list': case 'object':
      return val!.val
    default:
      let expectNever: never = variant
      throw Error('unexpected type: ' + variant)
  }
}

const json: AppSchema = {
  id: 'json',
  root: 'Any',
  types: {
    Any: {
      type: 'enum',
      exhaustive: true,
      encode,
      decode,
      variants: {
        null: null,
        true: null,
        false: null,
        string: {fields: {val: 'string'}},
        int: {fields: {val: 's64'}},
        float: {fields: {val: 'f64'}},
        object: {fields: {val: {type: 'map', keyType: 'string', valType: 'Any', decodeForm: 'object'}}},
        list: {fields: {val: {type: 'list', fieldType: 'Any'}}},
      }
    }
  }
}
const fullSchema = extendSchema(json)

// console.log(fullSchema.types['Any'].variants)


const testRoundTrip = (input: any) => {
  const bytes = writeRaw(fullSchema, input)
  // console.log('roundtrip', input, bytes)
  const result = readRaw(fullSchema, bytes)

  assert.deepEqual(result, input)

  {
    const opaque = write(fullSchema, input)
    const [fileSchema, result] = read(fullSchema, opaque)
    assert.deepEqual(result, input)
  }
}

describe('json encoding', () => {
  it('can encode and decode simple values', () => {
    testRoundTrip(60)
    testRoundTrip(true)
    testRoundTrip(false)
    testRoundTrip(null)
    testRoundTrip("hi")
    testRoundTrip(["hi"])
    testRoundTrip({hi: true})
    testRoundTrip([{hi: true}])
    testRoundTrip([[[]]])
    testRoundTrip({x:{y:{z:{}}}})
  })
})
