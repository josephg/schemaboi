// This file contains routines to do length-prefixed varint encoding. I'd use LEB128 but this should
// optimize better because it plays better with branch predictor. (Well, although this isn't an
// optimized version).
//
// This uses a bijective base, where each number has exactly 1 canonical encoding.
// See https://news.ycombinator.com/item?id=11263378 for an explanation as to why.
//
// This format is extremely similar to how UTF8 works internally. Its almost certainly possible to
// reuse existing efficient UTF8 <-> UTF32 SIMD encoders and decoders to make this code faster,
// but frankly its not a priority right now.
//
// 0    - 2^7-1 encodes as `0b0xxx_xxxx`
// 2^7  - 2^14+2^7-1 encodes as `0b10xx_xxxx xxxx_xxxx`
// 2^14+2^7 - 2^21+2^14+2^7-1 encodes as `0b110x_xxxx xxxx_xxxx xxxx_xxxx`
// 2^21 - 2^28-1 encodes as `0b1110_xxxx xxxx_xxxx xxxx_xxxx xxxx_xxxx`
// ... And so on.
//
// For 64 bit integers it would be tempting to use:
// 0x1111_1111 1111_1111 xxxx_xxxx ....
// ... Since then there would be at most 2 bytes of overhead (or 4 bytes of overhead for 128 bits).
// But that breaks the pattern, so instead it uses this as the maximum encoding for 64 bits:
// 0x1111_1111 1111_1111 0xxx_xxxx ...
// And for 128 bits:
// 0x1111_1111 1111_1111 1111_1111 1111_1111 0xxx_xxxx ...

// TODO: This module should probably be packaged separately, as its own npm module.

import { assert } from "./utils.js"

export const MAX_INT_LEN = 9
export const MAX_BIGINT_LEN = 19

export function bytesUsed(bytes: Uint8Array): number {
  // Pull out the first 4 bytes. We'll never encode a number larger than 2^128 with this
  // encoder, but that gives us up to 3 bytes with 1 bits in them.

  // The input byte array might be smaller than 4 bytes long - but bit shift coerces undefined
  // to 0, so conveniently enough, this works fine anyway.
  const x = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]
  return Math.clz32(~x) + 1
}

function leadingOnes(n: number): number {
  return Math.clz32(~(n << 24))
}


// *** Encoding and decoding regular numbers

const VARINT_ENC_CUTOFFS = [1 << 7]
for (let i = 1; i < 7; i++) {
  // There's only 7 values smaller than the MAX_SAFE_INTEGER cutoff.
  VARINT_ENC_CUTOFFS[i] = (VARINT_ENC_CUTOFFS[i - 1] + 1) * (1 << 7)
}
VARINT_ENC_CUTOFFS.push(Number.MAX_VALUE)

export function varintEncode(num: number): Uint8Array {
  const result = new Uint8Array(MAX_INT_LEN)
  const bytesUsed = varintEncodeInto(num, result, 0)
  return result.slice(0, bytesUsed)
}

/** Returns number of bytes consumed in dest. Must have enough capacity for 9 bytes. **/
export function varintEncodeInto(num: number, dest: Uint8Array, offset: number): number {
  if (num > Number.MAX_SAFE_INTEGER) throw Error('Cannot encode integers above MAX_SAFE_INTEGER')
  if (num < 0) throw Error('Varint encoding: Number must be non-negative')

  let prefix = 0
  for (let i = 0; i < VARINT_ENC_CUTOFFS.length; i++) {
    if (num < VARINT_ENC_CUTOFFS[i]) {
      if (i > 0) num -= VARINT_ENC_CUTOFFS[i - 1]
      // console.log('num', num, 'prefix', prefix)

      // console.log('i', i, 'prefix', prefix)
      for (let j = i; j > 0; j--) {
        dest[offset + j] = num & 0xff
        // I'd rather bitshift, but that coerces to a u32.
        // num >>= 8
        num = Math.floor(num / 256)
      }
      assert((prefix & num) === 0) // Must never have overlapping bits.
      assert(num >= 0)
      dest[offset] = prefix | num

      return i + 1
    }
    // prefix = (prefix << 1) + 2
    prefix = (prefix >> 1) + 0x80
  }
  throw Error('unreachable')
}

// Might not use all the bytes of the result. Check bytesUsed().
export function varintDecode(bytes: Uint8Array): number {
  if (bytes.length === 0) throw Error('Unexpected end of input')

  const b0 = bytes[0]
  if (!(b0 & 0b1000_0000)) return b0 // Most common case.

  const numBytes = leadingOnes(b0) + 1

  if (bytes.length < numBytes) {
    throw Error('Unexpected end of input')
  }

  let val = b0 & ((1 << (9 - numBytes)) - 1)
  for (let i = 1; i < numBytes; i++) {
    const b = bytes[i]
    val = (val * 256) + b
  }

  val += VARINT_ENC_CUTOFFS[numBytes - 2];

  return val
}



// Bigint variants

// With bigints, we can store numbers up to 2^128.
const common_mult_n = 1n << 7n
const VARINT_ENC_CUTOFFS_BIGINT = [common_mult_n]
// Enough for u128.
for (let i = 1; i < 19; i++) {
  VARINT_ENC_CUTOFFS_BIGINT[i] = (VARINT_ENC_CUTOFFS_BIGINT[i - 1] + 1n) * common_mult_n
}
// console.log(VARINT_ENC_CUTOFFS_BIGINT)

/** Returns number of bytes consumed in dest. Must have enough capacity for 9 bytes. **/
export function varintEncodeIntoBN(num: bigint, dest: Uint8Array, offset: number): number {
  if (num < 0n) throw Error('Varint encoding: Number must be non-negative')
  // When we can, its faster to immediately convert to a Number rather than deal with BigInts.
  if (num < Number.MAX_SAFE_INTEGER) return varintEncodeInto(Number(num), dest, offset)
  if (num >= 2n**128n) throw Error('Cannot encode unsigned integers above 2^128') // Could support them pretty easily tho.

  // let prefix = 0
  for (let i = 0; i < VARINT_ENC_CUTOFFS_BIGINT.length; i++) {
    if (num < VARINT_ENC_CUTOFFS_BIGINT[i]) {
      if (i > 0) num -= VARINT_ENC_CUTOFFS_BIGINT[i - 1]

      // We're going to use 7*(i+1) bits to store the data.
      // There will be i x 1-bits at the start, and a 0.

      // Prefix always fits in a normal int.
      let leadingOnes = i
      for (; leadingOnes >= 8; leadingOnes -= 8) {
        dest[offset++] = 0xff
      }

      // & 0xff is only here to make the number positive, but its not necessary.
      const prefix = (0xff << (8-leadingOnes)) & 0xff
      const trailingBits = i * 7 + leadingOnes
      // console.log('prefix', prefix.toString(2), num >> BigInt(trailingBits), BigInt.asUintN(8, num >> BigInt(trailingBits)).toString(2))

      // I'm filling the buffer left to right here,
      // but it might be faster / better to fill it right to left?
      dest[offset++] = prefix | Number(num >> BigInt(trailingBits))
      assert(trailingBits % 8 === 0)

      for (let j = trailingBits - 8; j >= 0; j -= 8) {
        // Using BigInt.asUintN here to truncate so we don't overflow the Number. Could equally (x & 0xffn).
        dest[offset++] = Number(BigInt.asUintN(8, num >> BigInt(j)))
      }
      return i + 1 // i+1 === change in offset.
    }
  }
  throw Error('unreachable')
}

export function varintEncodeBN(num: bigint): Uint8Array {
  const result = new Uint8Array(MAX_BIGINT_LEN)
  const bytesUsed = varintEncodeIntoBN(num, result, 0)
  return result.slice(0, bytesUsed)
}

// Might not use all the bytes of the result. Check bytesUsed().
export function varintDecodeBN(bytes: Uint8Array): bigint {
  if (bytes.length === 0) throw Error('Unexpected end of input')

  const b0 = bytes[0]
  if ((b0 & 0b1000_0000) === 0) return BigInt(b0)
  const numBytes = bytesUsed(bytes)
  assert(numBytes >= 2)
  // console.log('numBytes', numBytes)

  if (bytes.length < numBytes) throw Error('Unexpected end of input')

  // There are numBytes-1 leading ones, then a 0, then numBytes * 7 bits of BE data.

  let b = numBytes
  let offset = 0
  while (b >= 8) {
    b -= 8
    ++offset
  }

  // let val = b0 & ((1 << (9 - numBytes)) - 1)
  let val = BigInt(bytes[offset++] & (0xff >> b))
  // console.log('v0', val)
  for (; offset < numBytes; ++offset) {
    val = (val * 256n) + BigInt(bytes[offset])
    // console.log('v', val)
  }

  val += VARINT_ENC_CUTOFFS_BIGINT[numBytes - 2];

  return val
}

export function zigzagEncode(val: number): number {
  return val < 0
    ? -val * 2 - 1
    : val * 2
}

export function zigzagDecode(val: number): number {
  return (val % 2) === 1
    ? -(val + 1) / 2
    : val / 2
}

export function zigzagEncodeBN(val: bigint): bigint {
  return val < 0
    ? (-val << 1n) - 1n
    : val << 1n
}

export function zigzagDecodeBN(val: bigint): bigint {
  return (val % 2n) === 1n
    ? -(val + 1n) / 2n // Will truncate.
    : val / 2n
}

export function mixBit(val: number, bit: boolean): number {
  return (val * 2) + (+bit)
}

export function trimBit(val: number): [boolean, number] {
  // I would use a bit shift for this division, but bit shifts coerce to a i32.
  return [!!(val % 2), Math.floor(val / 2)]
}
