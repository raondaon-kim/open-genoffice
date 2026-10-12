import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseFileToText, setHwpTextExtractor } from '../src/index'

const dir = mkdtempSync(join(tmpdir(), 'hwp-extract-'))
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
const file = (name: string, bytes: Buffer) => {
  const p = join(dir, name)
  writeFileSync(p, bytes)
  return p
}

afterEach(() => setHwpTextExtractor(null))

describe('Hangul attachments', () => {
  it('are unsupported until the shell registers an extractor', async () => {
    const r = await parseFileToText(file('a.hwp', OLE2))
    expect(r).toMatchObject({ ok: false, kind: 'unsupported' })
  })

  it('go through the registered extractor (.hwp and .hwpx)', async () => {
    const extractor = vi.fn(async (path: string) => `text of ${path.slice(-6)}`)
    setHwpTextExtractor(extractor)
    expect(await parseFileToText(file('rfp.hwp', OLE2))).toEqual({
      ok: true,
      kind: 'text',
      text: 'text of fp.hwp',
    })
    const x = await parseFileToText(file('rfp.hwpx', ZIP))
    expect(x).toMatchObject({ ok: true, kind: 'text' })
    expect(extractor).toHaveBeenCalledTimes(2)
  })

  it('refuses a file whose bytes do not match its Hangul extension', async () => {
    const extractor = vi.fn(async () => 'never')
    setHwpTextExtractor(extractor)
    const r = await parseFileToText(file('fake.hwp', ZIP))
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Content mismatch/) })
    expect(extractor).not.toHaveBeenCalled()
  })

  it('reports an extractor failure as a parse error', async () => {
    setHwpTextExtractor(async () => {
      throw new Error('engine failed')
    })
    const r = await parseFileToText(file('bad.hwpx', ZIP))
    expect(r).toMatchObject({ ok: false, error: 'engine failed' })
  })
})
