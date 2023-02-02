import fs from 'fs'
import assert from 'assert/strict'
import {varintEncode, bytesUsed, varintDecode} from './varint.js'

const tests = fs.readFileSync('varint_tests.txt', 'utf8')
  .split('\n')
  .filter(line => line != '')
  .reverse()

for (const line of tests) {
  let spaceIdx = line.indexOf(' ')
  assert(spaceIdx > 0)
  let num = parseInt(line.slice(0, spaceIdx))
  if (num > Number.MAX_SAFE_INTEGER) continue

  console.log(num)

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

// console.log(tests)

// console.log(10, varintEncode(10))
// console.log(100, varintEncode(100))
// console.log(1000, varintEncode(1000))
// console.log(100000, varintEncode(100000))
// console.log(10000000, varintEncode(10000000))
