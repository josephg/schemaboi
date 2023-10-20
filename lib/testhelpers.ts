import { AppSchema, SType, Schema, extendSchema, readRaw, writeRaw, read, write } from "./index.js"

// We'll cache the extended schema for performance.
const schemaCache = new WeakMap<AppSchema, Schema>()


type AnyType = null | undefined
  | boolean
  | string
  | number
  | AnyType[]
  | {[k: string]: AnyType}
  | Map<AnyType, AnyType>
  | Set<AnyType>

function simpleDeepEqual(expect: AnyType, actual: AnyType) {
  if (expect === actual) return true // Handle equality for bools, strings, numbers, null.
  // Handle inequality for the above.
  if (typeof expect !== 'object' || typeof actual !== 'object' || expect == null || actual == null) return false

  // Now we should just have objects, lists and maps left.
  if (Array.isArray(expect)) {
    if (!Array.isArray(actual) || expect.length !== actual.length) return false
    for (let i = 0; i < expect.length; i++) {
      if (!simpleDeepEqual(expect[i], actual[i])) return false
    }
  } else if (expect instanceof Map) {
    if (!(actual instanceof Map) || expect.size !== actual.size) return false

    // Its actually non-trivial to compare maps with non-primitive keys, because we need to match
    // them together.
    for (const [k, v1] of expect.entries()) {
      if (k != null && typeof k === 'object') throw Error('Deep equal for maps with object keys is NYI')
      const v2 = actual.get(k)
      if (!simpleDeepEqual(v1, v2)) return false
    }
  } else if (expect instanceof Set) {
    if (!(actual instanceof Set) || expect.size !== actual.size) return false

    if (expect.size > 0) throw Error('Non-empty sets not implemented')
    // for (const k of expect.entries()) {

    // }
  } else {
    // Its an object. At least I hope so.
    if (expect instanceof Set || actual instanceof Set) throw Error('Sets not implemented')
    if (Array.isArray(actual) || actual instanceof Map) return false

    if (Object.keys(expect).length !== Object.keys(actual).length) return false

    for (const k in expect) {
      const v1 = expect[k]
      const v2 = actual[k]
      if (!simpleDeepEqual(v1, v2)) return false
    }
  }
  return true
}

// assert(simpleDeepEqual(2, 2))
// assert(!simpleDeepEqual(2, 3))
// assert(!simpleDeepEqual(2, null))
// assert(simpleDeepEqual(null, null))
// assert(simpleDeepEqual(undefined, undefined))
// assert(simpleDeepEqual(true, true))
// assert(simpleDeepEqual('hi', 'hi'))

// assert(simpleDeepEqual([1,2,3], [1,2,3]))
// assert(!simpleDeepEqual([1,2,3,4], [1,2,3]))
// assert(!simpleDeepEqual([1,2,3], [1,2,3,4]))

// assert(simpleDeepEqual({x:'hi'}, {x:'hi'}))
// assert(!simpleDeepEqual({x:'hi'}, {x:'hiu'}))
// assert(!simpleDeepEqual({x:'hi'}, {x:'hi', y:'x'}))
// assert(!simpleDeepEqual({x:'hi', y:'x'}, {x:'hi'}))

// assert(simpleDeepEqual(new Map<any, any>([['x', 'hi'], ['y', [4,5,6]]]), new Map<any, any>([['x', 'hi'], ['y', [4,5,6]]])))
// assert(!simpleDeepEqual(new Map<any, any>([['x', 'hi'], ['y', [4,5,6]]]), new Map<any, any>([['x', 'hi'], ['y', [4,5,7]]])))



const assertDeepEqual = (expect: AnyType, actual: AnyType) => {
  if (!simpleDeepEqual(expect, actual)) {
    console.log('expected:', expect)
    console.log('actual:  ', actual)
    throw Error('Input and output values did not match')
  }
}

/** This function is a simple smoke test to make sure an application's schema is set up correctly. */
export function testSimpleRoundTrip(appSchema: AppSchema, dataType: string | SType, data: any, expectedOutput = data) {
  let schema = schemaCache.get(appSchema)
  if (schema == null) {
    schema = extendSchema(appSchema)
    schemaCache.set(appSchema, schema)
  }

  const bytes = writeRaw(schema, data, dataType)
  const result = readRaw(schema, bytes, dataType)
  // console.log('result', result)

  // console.log('bytes', bytes.byteLength, 'JSON length', JSON.stringify(data).length, bytes)

  assertDeepEqual(expectedOutput, result)

  {
    const opaque = write(schema, data, dataType)

    // console.log('opaque', opaque)
    // fs.writeFileSync('tmp_test.sb', opaque)
    const [fileSchema, result] = read(schema, opaque, dataType)
    assertDeepEqual(expectedOutput, result)
  }
}
