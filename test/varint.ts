import 'mocha'
import fs from 'fs'
import assert from 'assert/strict'
import {varintEncode, bytesUsed, varintDecode, zigzagEncode, zigzagDecode} from '../lib/varint.js'

const roundtripSint = (n: number) => {
  const zz = zigzagEncode(n)
  const encoded = varintEncode(zz)
  const decoded = varintDecode(encoded)
  const output = zigzagDecode(decoded)
  assert.equal(output, n)
}

const roundtripUint = (n: number) => {
  const encoded = varintEncode(n)
  const decoded = varintDecode(encoded)
  assert.equal(decoded, n)

  if (n < Number.MAX_SAFE_INTEGER / 2) {
    roundtripSint(n)
  }
}

describe('varint encoding', () => {
  it('roundtrip encodes simple numbers correctly', () => {
    roundtripUint(0)
    roundtripUint(1)
    roundtripUint(100)
    roundtripUint(1000000)
    roundtripUint(Number.MAX_SAFE_INTEGER)
  })

  it('correctly handles conformance tests from varint_tests.txt', () => {
    const tests = fs.readFileSync('varint_tests.txt', 'utf8')
      .split('\n')
      .filter(line => line != '')
      .reverse()

    for (const line of tests) {
      let spaceIdx = line.indexOf(' ')
      assert(spaceIdx > 0)
      let num = parseInt(line.slice(0, spaceIdx))
      if (num > Number.MAX_SAFE_INTEGER) continue

      // console.log(num)

      let bytes = line.slice(spaceIdx + 1)

      const expectBytes = new Uint8Array(JSON.parse(bytes) as number[])
      // return [parseInt(num), JSON.parse(bytes)]

      const actualBytes = varintEncode(num)

      const reportedBytes = bytesUsed(actualBytes)
      assert.equal(reportedBytes, actualBytes.length)
      const actualDecode = varintDecode(actualBytes)
      assert.equal(num, actualDecode)

      assert.deepEqual(expectBytes, actualBytes)

      // console.log(actualBytes, expectBytes)
    }
  })
})

// console.log(10, varintEncode(10))
// console.log(100, varintEncode(100))
// console.log(1000, varintEncode(1000))
// console.log(100000, varintEncode(100000))
// console.log(10000000, varintEncode(10000000))
