import 'mocha'
import fs from 'fs'
import assert from 'assert/strict'
import {varintEncode, bytesUsed, varintDecode, zigzagEncode, zigzagDecode, varintEncodeBN, varintDecodeBN} from '../lib/varint.js'
import {randomBytes} from 'crypto'

// Helper function while debugging.
const printBinary = (x: Uint8Array) => {
  console.log([...x].map(b => b.toString(2).padStart(8, '0')).join(' '))
}

const checkZigZag = (n: number) => {
  let zz = zigzagEncode(n)
  assert(zz >= 0)
  let out = zigzagDecode(zz)
  assert.equal(n, out)
}

const roundtripUint = (n: number) => {
  const encoded = varintEncode(n)
  const decoded = varintDecode(encoded)
  assert.equal(decoded, n)

  if (n < Number.MAX_SAFE_INTEGER / 2) {
    checkZigZag(n)
    if (n !== 0) checkZigZag(-n)
  }

  roundtripBN(BigInt(n))
}

const roundtripBN = (n: bigint) => {
  // console.log('\nx', n)
  const encoded = varintEncodeBN(n)
  const decoded = varintDecodeBN(encoded)
  assert.equal(decoded, n)
  // if (n !== decoded) {
  //   console.log('MISMATCH', n)
  //   console.log('enc', encoded)
  //   printBinary(encoded)
  //   if (n < Number.MAX_SAFE_INTEGER) {
  //     console.log('old encoding', varintEncode(Number(n)))
  //   }
  //   console.log('dec', decoded)
  //   // console.log(

  //   throw Error('Bad encode / decode')
  // }
  // assert(n === decoded)
}



describe('varint encoding', () => {
  it('roundtrip encodes simple numbers correctly', () => {
    roundtripUint(0)
    roundtripUint(1)
    roundtripUint(100)
    roundtripUint(1000000)
    roundtripUint(Number.MAX_SAFE_INTEGER)
  })

  it('zigzag encodes correctly', () => {
    checkZigZag(0)
    checkZigZag(1)
    checkZigZag(-1)
    checkZigZag(10000)
    checkZigZag(-10000)
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

  it('handles simple bigints', () => {
    roundtripBN(0n)
    roundtripBN(1n)
    roundtripBN(0xffffffffffffn)
    roundtripBN(2n**128n - 1n) // Largest number we support.
  })

  it('fuzzes', () => {
    // Ideally we'd use a stable RNG here, but it should be fine as any
    // errors are trivially reproducable.

    for (let i = 0; i < 20000; i++) {
      // We'll generate a number with a random number of bits.
      const bits = Math.ceil(Math.random() * 128)
      const numBytes = Math.ceil(bits / 8)

      // Using crypto.randomBytes because its easier than Math.random, and I'm lazy.
      const bytes = randomBytes(numBytes)
      bytes[0] &= 0xff >> (8-(bits % 8))

      let num = 0n
      for (const b of bytes) {
        num = num << 8n | BigInt(b)
      }

      // console.log(num)

      roundtripBN(num)
      if (num < Number.MAX_SAFE_INTEGER) {
        roundtripUint(Number(num))
      }
    }
  })
})

// console.log(10, varintEncode(10))
// console.log(100, varintEncode(100))
// console.log(1000, varintEncode(1000))
// console.log(100000, varintEncode(100000))
// console.log(10000000, varintEncode(10000000))
