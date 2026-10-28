import { assertZipInflatesWithinLimits } from '@genoffice/zip-gate'
import JSZip from 'jszip'

/** One file inside an Office/Hangul package, in archive order. */
export interface PackageEntry {
  name: string
  data: Uint8Array
}

/** bounds for documents users save; the zip gate also catches parts that lie about their size */
const LIMITS = { maxParts: 10000, maxPartBytes: 256 * 1024 * 1024, maxTotalBytes: 512 * 1024 * 1024 }

export async function readPackage(bytes: Uint8Array): Promise<PackageEntry[]> {
  await assertZipInflatesWithinLimits(bytes, LIMITS)
  const zip = await JSZip.loadAsync(bytes)
  const out: PackageEntry[] = []
  for (const file of Object.values(zip.files)) {
    if (file.dir) continue
    out.push({ name: file.name, data: await file.async('uint8array') })
  }
  return out
}

/** entry order kept; an hwpx/ODF `mimetype` entry goes first and uncompressed, as readers require */
export async function writePackage(entries: PackageEntry[]): Promise<Uint8Array> {
  const zip = new JSZip()
  const mimetype = entries.find((e) => e.name === 'mimetype')
  if (mimetype) zip.file('mimetype', mimetype.data, { compression: 'STORE' })
  for (const e of entries) {
    if (e === mimetype) continue
    zip.file(e.name, e.data, { compression: 'DEFLATE' })
  }
  return zip.generateAsync({ type: 'uint8array' })
}

export function isXmlPart(name: string): boolean {
  return /\.(xml|rels|vml|hpf)$/i.test(name)
}

/** XML part bytes as text, remembering the encoding so a changed part is written back the same way */
export function decodePart(data: Uint8Array): { text: string; encode(s: string): Uint8Array } {
  if (data[0] === 0xff && data[1] === 0xfe) {
    const text = new TextDecoder('utf-16le').decode(data.subarray(2))
    return {
      text,
      encode: (s) => {
        const body = Buffer.from(s, 'utf16le')
        return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), body]))
      },
    }
  }
  const bom = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf
  const text = new TextDecoder('utf-8').decode(bom ? data.subarray(3) : data)
  return {
    text,
    encode: (s) => {
      const body = Buffer.from(s, 'utf8')
      return new Uint8Array(bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body)
    },
  }
}
