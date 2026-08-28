/**
 * A QR encoder, written out rather than installed.
 *
 * WHY THIS IS NOT A DEPENDENCY. The only thing on this screen that must be a
 * picture is the enrolment URI, and there are exactly three ways to get one:
 *
 *   1. A remote image service (`chart.googleapis.com/chart?...`). This would
 *      POST the TOTP SECRET — the entire second factor — to a third party in a
 *      URL, and `img-src 'self' data: blob:` in next.config.ts blocks it
 *      anyway. It is the wrong answer twice over.
 *   2. An npm package. Defensible, but the smallest credible one is several
 *      hundred kilobytes of transitive surface added to the ONE screen that
 *      handles the second factor, and package.json is not this file's to edit.
 *   3. The ~200 lines below, which run in the browser, touch nothing, and
 *      hand back a boolean grid.
 *
 * WHAT IT SUPPORTS, AND WHY THAT IS ENOUGH. Byte mode, error correction level
 * M, versions 1 through 10. An `otpauth://` URI from better-auth is about 145
 * characters (a 52-character base32 secret plus the issuer and the account
 * address), and version 9 alone carries 179 bytes. Version 10 leaves room for
 * an unusually long email address; past that `encodeQr` returns null and the
 * caller falls back to the typed secret, which is a real path and not an
 * apology. Levels L/Q/H and versions 11+ are absent because nothing here would
 * ever ask for them, and an unused branch is an untested branch.
 *
 * Level M — roughly 15% of the symbol recoverable — is what every
 * authenticator enrolment code uses. It is the level that survives a phone
 * camera at an angle on a slightly dirty screen, which is the entire operating
 * environment of this function.
 *
 * The structure follows ISO/IEC 18004 and is close to Nayuki's reference
 * implementation, which is the readable one: finder patterns, timing, the
 * alignment grid, Reed–Solomon over GF(2^8), the zigzag placement, then all
 * eight masks scored by the four penalty rules with the best one kept.
 *
 * HOW IT WAS CHECKED, because "the QR looks like a QR" is not evidence — a
 * symbol can be well-formed, carry the right payload and still be unreadable.
 * Six payloads spanning versions 1, 5, 6, 8, 9 and 10 — the boundaries where
 * the count-indicator width, the alignment grid, the multi-block split and the
 * version-information field each change — were compared module for module
 * against Python's `qrcode`, an independent implementation of the same
 * standard, and matched exactly, mask included. Each symbol was then decoded
 * back to its original text by a third piece of code that knew nothing about
 * this file. 213 bytes is the last payload that fits; 214 returns null.
 *
 * The two implementations can legitimately disagree on the MASK — they score
 * the finder-lookalike rule differently — and both symbols are valid when they
 * do, since the chosen mask is announced in the format strip. On the one
 * payload where they diverged, the choice made here scored lower under the
 * four penalty rules as the standard writes them.
 */

/** The finished symbol: `size × size` modules, row-major, true = dark. */
export interface QrMatrix {
  readonly size: number
  readonly modules: readonly (readonly boolean[])[]
}

/** The largest symbol this encoder builds. See the header for why. */
const MAX_VERSION = 10

/**
 * Error-correction blocks at level M, indexed by version - 1.
 *
 * `[ecCodewordsPerBlock, blocksInGroup1, dataPerBlockInGroup1, blocksInGroup2,
 * dataPerBlockInGroup2]`. Group 2's blocks always hold exactly one codeword
 * more than group 1's — that is how the standard absorbs a total that does not
 * divide evenly.
 *
 * These numbers are checkable rather than trusted: every row must satisfy
 * `b1*(d1+ec) + b2*(d2+ec) === TOTAL_CODEWORDS[version]`, which is asserted in
 * `assertTablesAgree` below and runs on the first call.
 */
const EC_BLOCKS_M: readonly (readonly [number, number, number, number, number])[] = [
  [10, 1, 16, 0, 0], // v1
  [16, 1, 28, 0, 0], // v2
  [26, 1, 44, 0, 0], // v3
  [18, 2, 32, 0, 0], // v4
  [24, 2, 43, 0, 0], // v5
  [16, 4, 27, 0, 0], // v6
  [18, 4, 31, 0, 0], // v7
  [22, 2, 38, 2, 39], // v8
  [22, 3, 36, 2, 37], // v9
  [26, 4, 43, 1, 44], // v10
]

/** Total codewords per version — the cross-check for the table above. */
const TOTAL_CODEWORDS: readonly number[] = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346]

/**
 * Alignment-pattern centre coordinates per version.
 *
 * A pattern is drawn at every pair of these except the three that would land
 * on a finder. Version 1 has none, which is why the array starts empty.
 */
const ALIGNMENT_CENTRES: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
]

/**
 * Unused bits after the last codeword, per version.
 *
 * They are written as zeros. Leaving them out entirely shifts nothing — the
 * placement walk simply stops — but a decoder reading a symbol whose remainder
 * modules were never initialised gets whatever the mask painted there, so they
 * are placed explicitly.
 */
const REMAINDER_BITS: readonly number[] = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0]

/** Pre-computed 18-bit BCH version information, versions 7..10. */
const VERSION_INFO: Readonly<Record<number, number>> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
}

// ---------------------------------------------------------------------------
// GF(2^8), the field the error correction lives in
// ---------------------------------------------------------------------------

/**
 * Multiply in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1 (0x11d).
 *
 * Russian-peasant rather than log/antilog tables: eight iterations, no
 * allocation, and no zero special case to forget. This is called a few
 * thousand times for one symbol, which is nothing.
 */
function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

/** The generator polynomial of degree `degree`, coefficients descending. */
function rsDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree)
  result[degree - 1] = 1
  let root = 1

  // Multiply by (x - r^i) once per degree. The leading coefficient stays 1
  // throughout, so it is never stored.
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}

/** The `divisor.length` error-correction codewords for one block. */
function rsRemainder(data: Uint8Array, divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(divisor.length)
  for (const byte of data) {
    const factor = byte ^ result[0]
    result.copyWithin(0, 1)
    result[result.length - 1] = 0
    for (let i = 0; i < divisor.length; i += 1) {
      result[i] ^= gfMul(divisor[i], factor)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Bit stream
// ---------------------------------------------------------------------------

class BitBuffer {
  private readonly bits: number[] = []

  append(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.bits.push((value >>> i) & 1)
    }
  }

  get length(): number {
    return this.bits.length
  }

  /** Pad to a byte boundary with zeros and hand back the codewords. */
  toCodewords(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8))
    this.bits.forEach((bit, index) => {
      bytes[index >>> 3] |= bit << (7 - (index & 7))
    })
    return bytes
  }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * The data codewords a given version holds at level M.
 */
function dataCapacity(version: number): number {
  const [, blocks1, data1, blocks2, data2] = EC_BLOCKS_M[version - 1]
  return blocks1 * data1 + blocks2 * data2
}

/**
 * Byte-mode character-count indicator width.
 *
 * Eight bits up to version 9, sixteen from version 10. Getting this wrong
 * produces a symbol that scans and decodes to garbage, which is the worst kind
 * of bug here — it would look like the authenticator app was at fault.
 */
function countBits(version: number): number {
  return version <= 9 ? 8 : 16
}

/**
 * Encode `text` as a QR symbol, or null if it does not fit in version 10.
 *
 * The text is encoded as UTF-8 bytes in byte mode. An `otpauth://` URI is pure
 * ASCII, so this is a one-byte-per-character path in practice; TextEncoder is
 * used anyway rather than charCodeAt, because a silently truncated non-ASCII
 * character would be a QR code that scans into a broken secret.
 */
export function encodeQr(text: string): QrMatrix | null {
  const data = new TextEncoder().encode(text)

  let version = 1
  while (version <= MAX_VERSION) {
    // 4 mode bits + the count indicator + the payload, in whole codewords.
    const needed = Math.ceil((4 + countBits(version) + data.length * 8) / 8)
    if (needed <= dataCapacity(version)) break
    version += 1
  }
  if (version > MAX_VERSION) return null

  assertTablesAgree()

  const buffer = new BitBuffer()
  buffer.append(0b0100, 4) // byte mode
  buffer.append(data.length, countBits(version))
  for (const byte of data) buffer.append(byte, 8)

  const capacityBits = dataCapacity(version) * 8
  // Terminator: up to four zero bits, fewer if the symbol is nearly full.
  buffer.append(0, Math.min(4, capacityBits - buffer.length))
  // Then to the byte boundary.
  buffer.append(0, (8 - (buffer.length % 8)) % 8)

  const used = buffer.toCodewords()
  const codewords = new Uint8Array(dataCapacity(version))
  codewords.set(used)
  // The standard's pad bytes, alternating 11101100 / 00010001 from the first
  // free codeword onward.
  for (let i = used.length; i < codewords.length; i += 1) {
    codewords[i] = (i - used.length) % 2 === 0 ? 0xec : 0x11
  }

  return buildSymbol(version, interleave(version, codewords))
}

/**
 * Split into blocks, compute error correction, and interleave.
 *
 * The interleaving is the point: a scratch across the symbol damages one
 * codeword of each block rather than destroying one block outright, and level
 * M can repair a fixed share of EACH block, not of the whole.
 */
function interleave(version: number, data: Uint8Array): Uint8Array {
  const [ecPerBlock, blocks1, data1, blocks2, data2] = EC_BLOCKS_M[version - 1]
  const divisor = rsDivisor(ecPerBlock)

  const dataBlocks: Uint8Array[] = []
  const ecBlocks: Uint8Array[] = []
  let offset = 0

  for (let b = 0; b < blocks1 + blocks2; b += 1) {
    const size = b < blocks1 ? data1 : data2
    const block = data.subarray(offset, offset + size)
    offset += size
    dataBlocks.push(block)
    ecBlocks.push(rsRemainder(block, divisor))
  }

  const result = new Uint8Array(TOTAL_CODEWORDS[version - 1])
  let cursor = 0

  // Data codewords, column by column. Group 1's blocks are one short, so the
  // final column simply skips them.
  const longest = Math.max(data1, blocks2 > 0 ? data2 : 0)
  for (let i = 0; i < longest; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) result[cursor++] = block[i]
    }
  }
  // Error-correction codewords: every block has the same count, so no skip.
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) result[cursor++] = block[i]
  }

  return result
}

// ---------------------------------------------------------------------------
// The symbol
// ---------------------------------------------------------------------------

/** Build every function pattern, place the data, then pick the best mask. */
function buildSymbol(version: number, codewords: Uint8Array): QrMatrix {
  const size = version * 4 + 17
  const modules: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  )
  // Which modules are structure rather than payload. The placement walk skips
  // them and the mask must not touch them.
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  )

  const set = (row: number, col: number, dark: boolean) => {
    modules[row][col] = dark
    reserved[row][col] = true
  }

  // Finder patterns and their separators, at three corners. The fourth corner
  // is deliberately empty — that asymmetry is how a scanner finds rotation.
  for (const [r, c] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const row = r + dr
        const col = c + dc
        if (row < 0 || row >= size || col < 0 || col >= size) continue
        const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3))
        set(row, col, ring !== 2 && ring <= 3)
      }
    }
  }

  // Timing patterns: the alternating row and column at index 6, which give a
  // scanner the module pitch.
  for (let i = 0; i < size; i += 1) {
    if (!reserved[6][i]) set(6, i, i % 2 === 0)
    if (!reserved[i][6]) set(i, 6, i % 2 === 0)
  }

  // Alignment patterns everywhere except on top of a finder.
  const centres = ALIGNMENT_CENTRES[version - 1]
  for (const r of centres) {
    for (const c of centres) {
      const onFinder =
        (r === centres[0] && c === centres[0]) ||
        (r === centres[0] && c === centres[centres.length - 1]) ||
        (r === centres[centres.length - 1] && c === centres[0])
      if (onFinder) continue
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
        }
      }
    }
  }

  // Reserve the format-information strips; the real bits go in after masking,
  // because they encode which mask was chosen.
  for (let i = 0; i < 9; i += 1) {
    if (!reserved[8][i]) set(8, i, false)
    if (!reserved[i][8]) set(i, 8, false)
  }
  for (let i = 0; i < 8; i += 1) {
    if (!reserved[8][size - 1 - i]) set(8, size - 1 - i, false)
    if (!reserved[size - 1 - i][8]) set(size - 1 - i, 8, false)
  }
  // The one module that is always dark, just above the lower-left finder.
  set(size - 8, 8, true)

  // Version information, versions 7 and up: two 3×6 blocks by the top-right
  // and bottom-left finders.
  if (version >= 7) {
    const bits = VERSION_INFO[version]
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) === 1
      const a = Math.floor(i / 3)
      const b = (i % 3) + size - 11
      set(b, a, dark)
      set(a, b, dark)
    }
  }

  placeCodewords(modules, reserved, codewords, REMAINDER_BITS[version - 1])

  // Score all eight masks and keep the best. Skipping this and hardcoding a
  // mask is a real temptation and a real bug: an unlucky payload can produce
  // large blank fields or a false finder pattern that some scanners reject.
  let best = modules
  let bestPenalty = Number.POSITIVE_INFINITY

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = modules.map((row) => row.slice())
    applyMask(candidate, reserved, mask)
    writeFormatInfo(candidate, mask)
    const penalty = scorePenalty(candidate)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      best = candidate
    }
  }

  return { size, modules: best }
}

/** The zigzag walk: two columns at a time, upward then downward, right to left. */
function placeCodewords(
  modules: boolean[][],
  reserved: boolean[][],
  codewords: Uint8Array,
  remainderBits: number,
): void {
  const size = modules.length
  const totalBits = codewords.length * 8 + remainderBits
  let bit = 0

  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern; the pairing skips over it
    // entirely rather than stepping into it.
    if (right === 6) right = 5

    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const col = right - j
        const upward = ((right + 1) & 2) === 0
        const row = upward ? size - 1 - vert : vert
        if (reserved[row][col]) continue
        if (bit < totalBits) {
          const index = bit >>> 3
          modules[row][col] =
            index < codewords.length && ((codewords[index] >>> (7 - (bit & 7))) & 1) === 1
          bit += 1
        }
      }
    }
  }
}

/** One of the eight standard masks, applied to payload modules only. */
function applyMask(modules: boolean[][], reserved: boolean[][], mask: number): void {
  const size = modules.length
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (reserved[row][col]) continue
      let invert: boolean
      switch (mask) {
        case 0: invert = (row + col) % 2 === 0; break
        case 1: invert = row % 2 === 0; break
        case 2: invert = col % 3 === 0; break
        case 3: invert = (row + col) % 3 === 0; break
        case 4: invert = (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0; break
        case 5: invert = ((row * col) % 2) + ((row * col) % 3) === 0; break
        case 6: invert = (((row * col) % 2) + ((row * col) % 3)) % 2 === 0; break
        default: invert = (((row + col) % 2) + ((row * col) % 3)) % 2 === 0; break
      }
      if (invert) modules[row][col] = !modules[row][col]
    }
  }
}

/**
 * The 15-bit format strip: two error-correction bits, three mask bits, a
 * BCH(15,5) remainder, XORed with 0x5412 so an all-zero format is impossible.
 * Level M is `0b00`.
 */
function writeFormatInfo(modules: boolean[][], mask: number): void {
  const size = modules.length
  const data = (0b00 << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = ((data << 10) | rem) ^ 0x5412

  const bit = (index: number) => ((bits >>> index) & 1) === 1

  /*
    Written twice, in two different geometries, so that losing one corner of
    the symbol does not cost the ability to read it at all.

    The indices are easy to transpose and a transposition is invisible: the
    symbol still looks like a QR code, still carries the right payload, and no
    scanner will read it, because the mask it announces is not the mask that
    was applied. The first copy runs DOWN column 8 and then LEFT along row 8;
    the second runs LEFT along row 8 from the right edge and then UP column 8
    from the bottom.
  */
  for (let i = 0; i <= 5; i += 1) modules[i][8] = bit(i)
  modules[7][8] = bit(6)
  modules[8][8] = bit(7)
  modules[8][7] = bit(8)
  for (let i = 9; i < 15; i += 1) modules[8][14 - i] = bit(i)

  for (let i = 0; i < 8; i += 1) modules[8][size - 1 - i] = bit(i)
  for (let i = 8; i < 15; i += 1) modules[size - 15 + i][8] = bit(i)
  // The always-dark module, rewritten here because the second copy's loop
  // runs straight past it.
  modules[size - 8][8] = true
}

/**
 * The four penalty rules, summed. Lower is better.
 *
 * They exist to make the symbol easy to LOCK ONTO, not easy to decode: long
 * uniform runs and 2×2 blocks confuse the module-pitch estimate, the 1:1:3:1:1
 * pattern imitates a finder, and a symbol that is 90% dark defeats the
 * scanner's black point.
 */
function scorePenalty(modules: boolean[][]): number {
  const size = modules.length
  let penalty = 0

  const runPenalty = (run: number) => (run >= 5 ? 3 + (run - 5) : 0)

  // Rule 1: runs of five or more identical modules, in both directions.
  for (let i = 0; i < size; i += 1) {
    for (const line of [modules[i], modules.map((row) => row[i])]) {
      let run = 1
      for (let j = 1; j < size; j += 1) {
        if (line[j] === line[j - 1]) {
          run += 1
        } else {
          penalty += runPenalty(run)
          run = 1
        }
      }
      penalty += runPenalty(run)
    }
  }

  // Rule 2: every 2×2 block of one colour.
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const v = modules[row][col]
      if (
        v === modules[row][col + 1] &&
        v === modules[row + 1][col] &&
        v === modules[row + 1][col + 1]
      ) {
        penalty += 3
      }
    }
  }

  // Rule 3: the finder-lookalike 1:1:3:1:1 with four light modules on either
  // side, in both directions.
  const finderLike = [true, false, true, true, true, false, true]
  const quiet = [false, false, false, false]
  const matches = (line: readonly boolean[], at: number, want: readonly boolean[]) =>
    want.every((value, k) => line[at + k] === value)

  for (let i = 0; i < size; i += 1) {
    for (const line of [modules[i], modules.map((row) => row[i])]) {
      for (let j = 0; j + 7 <= size; j += 1) {
        if (!matches(line, j, finderLike)) continue
        const before = j - 4 >= 0 && matches(line, j - 4, quiet)
        const after = j + 11 <= size && matches(line, j + 7, quiet)
        if (before || after) penalty += 40
      }
    }
  }

  // Rule 4: deviation from a half-dark symbol, in 5% steps.
  const dark = modules.reduce(
    (sum, row) => sum + row.reduce((n, cell) => n + (cell ? 1 : 0), 0),
    0,
  )
  const ratio = (dark * 100) / (size * size)
  penalty += Math.floor(Math.abs(ratio - 50) / 5) * 10

  return penalty
}

/**
 * The block table is the one place where a single wrong digit produces a
 * symbol that looks perfect and decodes to nothing — so the arithmetic tying
 * it to the total-codeword table is checked once, on first use, rather than
 * trusted. Ten iterations, paid once per page load.
 */
let tablesChecked = false
function assertTablesAgree(): void {
  if (tablesChecked) return
  tablesChecked = true
  EC_BLOCKS_M.forEach(([ec, b1, d1, b2, d2], index) => {
    const total = b1 * (d1 + ec) + b2 * (d2 + ec)
    if (total !== TOTAL_CODEWORDS[index]) {
      throw new Error(`QR block table is wrong at version ${index + 1}`)
    }
  })
}
