const assert = (a: boolean, msg?: string) => {
  if (!a) throw Error(msg ?? 'Assertion failed')
}

const VARINT_ENC_CUTOFFS = [1 << 7]
for (let i = 1; i < 7; i++) {
  VARINT_ENC_CUTOFFS[i] = (VARINT_ENC_CUTOFFS[i - 1] + 1) * (1 << 7)
}
VARINT_ENC_CUTOFFS.push(Number.MAX_VALUE)

export function varintEncode(num: number): Uint8Array {
  const result = new Uint8Array(9)
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

      // let result = new Uint8Array(i + 1)
      for (let j = i; j > 0; j--) {
        dest[offset + j] = num & 0xff
        // I'd rather bitshift, but that coerces to a u32.
        // num >>= 8
        num = Math.floor(num / 256)
      }
      assert(num < 0xff)
      assert(num >= 0)
      dest[offset] = prefix | num

      return i + 1
    }
    // prefix = (prefix << 1) + 2
    prefix = (prefix >> 1) + 0x80
  }
  throw Error('unreachable')
}

export function bytesUsed(bytes: Uint8Array): number {
  return leadingOnes(bytes[0]) + 1
}

function leadingOnes(n: number): number {
  return Math.clz32(~(n << 24))
}

// Might not use all the bytes of the result. Check bytesUsed().
export function varintDecode(bytes: Uint8Array): number {
  if (bytes.length === 0) throw Error('Unexpected end of input')

  const b0 = bytes[0]
  const numBytes = leadingOnes(b0) + 1

  if (numBytes === 1) {
    return b0
  } else {
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
}


export function zigzagEncode(val: number): number {
  return val < 0
    ? -val * 2 + 1
    : val * 2
}

export function zigzagDecode(val: number): number {
  return (val % 1) === 1
    ? -Math.floor(val / 2)
    : Math.floor(val / 2)
}

export function mixBit(val: number, bit: boolean): number {
  return (val * 2) + (+bit)
}

export function trimBit(val: number): [boolean, number] {
  // I would use a bit shift for this division, but bit shifts coerce to a i32.
  return [!!(val % 2), Math.floor(val / 2)]
}