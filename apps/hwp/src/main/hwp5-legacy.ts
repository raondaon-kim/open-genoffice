import * as CFB from 'cfb'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

/**
 * Make an HWP5 file saved by rhwp readable by older Hangul (checked against Hangul 2005).
 *
 * rhwp packs the compressed streams with the standard 32 KB deflate window; Hangul 2005
 * inflates in small pieces with a much smaller window, so it closes or reports a damaged file.
 * Hangul's own writer packs each stream with short back-references and puts the CRC32 and size
 * of the plain data after it; the streams are re-packed the same way with a 4 KB window.
 * Every other stream is kept as is (rhwp's own RhwpHwpxOrigin too: Hangul 2005 ignores it, and
 * rhwp lays the document out by it when the file is opened again).
 *
 * The file version stays as written; older Hangul shows its "made in a newer version" notice,
 * which is expected. Bytes that are not an HWP5 compound file come back unchanged.
 */
export function legacyHangulHwp(bytes: Uint8Array): Uint8Array {
  if (!isCompoundFile(bytes)) return bytes
  let cfb: CFB.CFB$Container
  try {
    cfb = CFB.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      type: 'buffer',
    })
  } catch {
    return bytes
  }
  const header = CFB.find(cfb, 'FileHeader')
  if (!header?.content || header.content.length < 40) return bytes
  const compressed = (Buffer.from(header.content as Uint8Array).readUInt32LE(36) & 1) === 1

  cfb.FileIndex.forEach((entry, i) => {
    if (entry.type !== STREAM) return
    const path = cfb.FullPaths[i]!.replace(/^Root Entry\//, '')
    if (!compressed || !PACKED_STREAM.test(path) || !entry.content) return
    const repacked = repack(Buffer.from(entry.content as Uint8Array))
    if (repacked) {
      entry.content = repacked
      entry.size = repacked.length
    }
  })
  blankWriterMarker(cfb)
  const out = CFB.write(cfb, { type: 'buffer', fileType: 'cfb' }) as Buffer
  freeFatTail(out)
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
}

const FREE_SECTOR = 0xffffffff
const DIFAT_SECTOR_END = 0xfffffffe

/**
 * The cfb writer fills the FAT entries for sectors past the end of the file with end-of-chain
 * instead of free; strict readers (rhwp among them) call that a malformed FAT. Mark them free.
 */
function freeFatTail(file: Buffer): void {
  const sectorSize = 1 << file.readUInt16LE(30)
  const sectors = Math.floor((file.length - 512) / sectorSize)
  const fatSectors: number[] = []
  const fatCount = file.readUInt32LE(44)
  for (let k = 0; k < 109 && fatSectors.length < fatCount; k++) {
    fatSectors.push(file.readUInt32LE(76 + 4 * k))
  }
  // FAT sectors past the first 109 are listed in a chain of DIFAT sectors
  let difat = file.readUInt32LE(68)
  const perDifat = sectorSize / 4 - 1
  while (fatSectors.length < fatCount && difat < sectors && difat !== DIFAT_SECTOR_END) {
    const at = 512 + difat * sectorSize
    for (let k = 0; k < perDifat && fatSectors.length < fatCount; k++) {
      fatSectors.push(file.readUInt32LE(at + 4 * k))
    }
    difat = file.readUInt32LE(at + 4 * perDifat)
  }
  const perFat = sectorSize / 4
  fatSectors.forEach((fatSector, k) => {
    if (fatSector >= sectors) return
    const at = 512 + fatSector * sectorSize
    for (let j = 0; j < perFat; j++) {
      if (k * perFat + j >= sectors) file.writeUInt32LE(FREE_SECTOR, at + 4 * j)
    }
  })
}

const STREAM = 2
/** streams Hangul stores deflated in a compressed document (ViewText is encrypted: left alone) */
const PACKED_STREAM = /^(DocInfo$|BodyText\/|BinData\/|DocHistory\/)/
const WINDOW_BITS = 12
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function isCompoundFile(bytes: Uint8Array): boolean {
  return bytes.length > 512 && CFB_MAGIC.every((b, i) => bytes[i] === b)
}

/**
 * The stream re-packed with a small window plus the trailer, or null to keep it: not deflate
 * (a picture stored as is) or already followed by data (Hangul's own trailer).
 */
function repack(raw: Buffer): Buffer | null {
  let plain: Buffer
  try {
    const r = inflateRawSync(raw, { info: true }) as unknown as {
      buffer: Buffer
      engine: { bytesWritten: number }
    }
    if (r.engine.bytesWritten !== raw.length) return null
    plain = r.buffer
  } catch {
    return null
  }
  const trailer = Buffer.alloc(8)
  trailer.writeUInt32LE(crc32(plain), 0)
  trailer.writeUInt32LE(plain.length >>> 0, 4)
  return Buffer.concat([deflateRawSync(plain, { windowBits: WINDOW_BITS }), trailer])
}

/**
 * The cfb writer adds its own marker stream unless an entry of that name exists; an empty entry
 * of that name passes the check and is not written.
 */
function blankWriterMarker(cfb: CFB.CFB$Container): void {
  const MARKER = '\u0001Sh33tJ5'
  const at = cfb.FullPaths.findIndex((p) => p.endsWith('/' + MARKER))
  if (at >= 0) {
    Object.assign(cfb.FileIndex[at]!, { type: 0, size: 0, content: null })
    return
  }
  cfb.FileIndex.splice(1, 0, { name: MARKER, type: 0, size: 0, content: null } as never)
  cfb.FullPaths.splice(1, 0, cfb.FullPaths[0] + MARKER)
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
