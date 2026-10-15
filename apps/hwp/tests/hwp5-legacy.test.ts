import * as CFB from 'cfb'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  crc32,
  isLegacyReadable,
  legacyHangulHwp,
  legacyHangulHwpChecked,
} from '../src/main/hwp5-legacy'

const OLD_HANGUL_INFLATE = { windowBits: 12, chunkSize: 64 }

/** an HWP5 file the way rhwp writes one: 32 KB-window deflate, no trailer, an rhwp marker stream */
function rhwpStyleHwp(opts: { compressed?: boolean } = {}): { bytes: Uint8Array; body: Buffer } {
  const compressed = opts.compressed ?? true
  const header = Buffer.alloc(256)
  header.write('HWP Document File', 0, 'latin1')
  header.writeUInt32LE(0x05010000, 32)
  header.writeUInt32LE(compressed ? 1 : 0, 36)
  // a 6000-byte block without inner repeats, twice: a standard encoder copies it from 6000 back
  const block = Buffer.alloc(6000)
  let x = 0x9e3779b9
  for (let i = 0; i < block.length; i++) {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    block[i] = x & 0xff
  }
  const body = Buffer.concat([block, block])
  const docInfo = Buffer.from('docinfo records '.repeat(40))
  const pack = (b: Buffer): Buffer => (compressed ? deflateRawSync(b, { windowBits: 15 }) : b)
  const cfb = CFB.utils.cfb_new()
  CFB.utils.cfb_add(cfb, 'FileHeader', header)
  CFB.utils.cfb_add(cfb, 'DocInfo', pack(docInfo))
  CFB.utils.cfb_add(cfb, 'BodyText/Section0', pack(body))
  CFB.utils.cfb_add(cfb, 'PrvText', Buffer.from('\r\0\n\0', 'latin1'))
  CFB.utils.cfb_add(cfb, 'RhwpHwpxOrigin', Buffer.from('1'))
  const bytes = CFB.write(cfb, { type: 'buffer', fileType: 'cfb' }) as Buffer
  return { bytes: new Uint8Array(bytes), body }
}

const streams = (bytes: Uint8Array): Map<string, Buffer> => {
  const cfb = CFB.read(Buffer.from(bytes), { type: 'buffer' })
  const out = new Map<string, Buffer>()
  cfb.FileIndex.forEach((e, i) => {
    if (e.type === 2)
      out.set(cfb.FullPaths[i]!.replace(/^Root Entry\//, ''), Buffer.from(e.content as Uint8Array))
  })
  return out
}

describe('legacyHangulHwp', () => {
  it('re-packs compressed streams so a 4 KB inflate window reads them, with the CRC32 + size trailer', () => {
    const { bytes, body } = rhwpStyleHwp()
    const before = streams(bytes).get('BodyText/Section0')!
    // the problem: an old Hangul inflates piece by piece with a small window, so it cannot
    // reach far back; inflating in 64-byte output pieces with a 4 KB window does the same
    expect(() => inflateRawSync(before, OLD_HANGUL_INFLATE)).toThrow(/too far back/)

    const after = streams(legacyHangulHwp(bytes)).get('BodyText/Section0')!
    const r = inflateRawSync(after, { ...OLD_HANGUL_INFLATE, info: true }) as unknown as {
      buffer: Buffer
      engine: { bytesWritten: number }
    }
    expect(r.buffer.equals(body)).toBe(true)
    const trailer = after.subarray(r.engine.bytesWritten)
    expect(trailer.length).toBe(8)
    expect(trailer.readUInt32LE(0)).toBe(crc32(body))
    expect(trailer.readUInt32LE(4)).toBe(body.length)
  })

  it("keeps rhwp's own stream (rhwp lays the document out by it) and adds none of its own", () => {
    const names = [...streams(legacyHangulHwp(rhwpStyleHwp().bytes)).keys()].sort()
    expect(names).toEqual([
      'BodyText/Section0',
      'DocInfo',
      'FileHeader',
      'PrvText',
      'RhwpHwpxOrigin',
    ])
  })

  it('keeps the other streams byte for byte', () => {
    const { bytes } = rhwpStyleHwp()
    const a = streams(bytes)
    const b = streams(legacyHangulHwp(bytes))
    for (const name of ['FileHeader', 'PrvText', 'RhwpHwpxOrigin']) {
      expect(b.get(name)!.equals(a.get(name)!)).toBe(true)
    }
  })

  it('is idempotent: a stream that already has the trailer is left alone', () => {
    const once = legacyHangulHwp(rhwpStyleHwp().bytes)
    const twice = legacyHangulHwp(once)
    expect(
      streams(twice).get('BodyText/Section0')!.equals(streams(once).get('BodyText/Section0')!),
    ).toBe(true)
  })

  it('leaves an uncompressed document uncompressed', () => {
    const { bytes, body } = rhwpStyleHwp({ compressed: false })
    const out = streams(legacyHangulHwp(bytes))
    expect(out.get('BodyText/Section0')!.equals(body)).toBe(true)
    expect(out.get('DocInfo')!.equals(streams(bytes).get('DocInfo')!)).toBe(true)
  })

  it('marks FAT entries past the end of the file free, as strict compound-file readers require', () => {
    const file = Buffer.from(legacyHangulHwp(rhwpStyleHwp().bytes))
    const sectorSize = 1 << file.readUInt16LE(30)
    const sectors = (file.length - 512) / sectorSize
    expect(Number.isInteger(sectors)).toBe(true)
    const fatCount = file.readUInt32LE(44)
    const fat: number[] = []
    for (let k = 0; k < fatCount; k++) {
      const start = 512 + file.readUInt32LE(76 + 4 * k) * sectorSize
      for (let pos = 0; pos < sectorSize; pos += 4) fat.push(file.readUInt32LE(start + pos))
    }
    expect(fat.slice(sectors).every((v) => v === 0xffffffff)).toBe(true)
    // and the file still reads back
    expect(streams(file).has('BodyText/Section0')).toBe(true)
  })

  it('returns bytes that are not an HWP5 file unchanged', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])
    expect(legacyHangulHwp(zip)).toBe(zip)
  })
})

describe('isLegacyReadable', () => {
  it('accepts the re-packed file and an uncompressed document', () => {
    expect(isLegacyReadable(legacyHangulHwp(rhwpStyleHwp().bytes))).toBe(true)
    expect(isLegacyReadable(rhwpStyleHwp({ compressed: false }).bytes)).toBe(true)
  })

  it('rejects rhwp output that still lacks the trailer, and bytes that are not an HWP5 file', () => {
    expect(isLegacyReadable(rhwpStyleHwp().bytes)).toBe(false)
    expect(isLegacyReadable(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]))).toBe(false)
    expect(isLegacyReadable(new Uint8Array(0))).toBe(false)
  })

  it('rejects a stream whose CRC or size does not match its content', () => {
    const good = legacyHangulHwp(rhwpStyleHwp().bytes)
    const cfb = CFB.read(Buffer.from(good), { type: 'buffer' })
    const entry = CFB.find(cfb, '/BodyText/Section0')!
    const content = Buffer.from(entry.content as Uint8Array)
    content.writeUInt32LE(
      (content.readUInt32LE(content.length - 8) ^ 0xff) >>> 0,
      content.length - 8,
    )
    entry.content = content
    const bad = new Uint8Array(CFB.write(cfb, { type: 'buffer', fileType: 'cfb' }) as Buffer)
    expect(isLegacyReadable(bad)).toBe(false)
  })

  it('rejects a document whose body stream is not valid deflate', () => {
    const good = legacyHangulHwp(rhwpStyleHwp().bytes)
    const cfb = CFB.read(Buffer.from(good), { type: 'buffer' })
    const entry = CFB.find(cfb, '/BodyText/Section0')!
    entry.content = Buffer.from('this is not deflate data at all, only text')
    const bad = new Uint8Array(CFB.write(cfb, { type: 'buffer', fileType: 'cfb' }) as Buffer)
    expect(isLegacyReadable(bad)).toBe(false)
  })
})

describe('legacyHangulHwpChecked', () => {
  it('returns the re-packed file when it checks out', () => {
    const { bytes } = rhwpStyleHwp()
    const r = legacyHangulHwpChecked(bytes)
    expect(r.repacked).toBe(true)
    expect(isLegacyReadable(r.bytes)).toBe(true)
  })

  it('falls back to the bytes rhwp wrote when the re-packed file fails its check', () => {
    const { bytes } = rhwpStyleHwp()
    const r = legacyHangulHwpChecked(bytes, () => false)
    expect(r.repacked).toBe(false)
    expect(r.bytes).toBe(bytes)
  })

  it('does not call a non-HWP5 input re-packed', () => {
    const zip = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0])
    const r = legacyHangulHwpChecked(zip)
    expect(r.bytes).toBe(zip)
    expect(r.repacked).toBe(false)
  })
})
