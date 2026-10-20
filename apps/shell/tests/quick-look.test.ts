import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as CFB from 'cfb'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearQuickLookCache, quickLook } from '../src/main/quick-look'

// a 1x1 PNG and the start of a JPEG are enough: the payload checks magic bytes, not pixels
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])

const dir = () => mkdtempSync(join(tmpdir(), 'ql-'))
const text = (value: string) => vi.fn(async () => ({ kind: 'text' as const, text: value }))
const zip = async (entries: Record<string, Buffer | string>) => {
  const z = new JSZip()
  for (const [name, data] of Object.entries(entries)) z.file(name, data)
  return z.generateAsync({ type: 'nodebuffer' })
}

beforeEach(() => clearQuickLookCache())

describe('quickLook', () => {
  it('shows an image file itself', async () => {
    const p = join(dir(), 'photo.png')
    writeFileSync(p, PNG)
    const r = await quickLook(p, { extractText: text('unused') })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.image?.startsWith('data:image/png;base64,')).toBe(true)
    expect(r.text).toBeUndefined()
    expect(r).toMatchObject({ name: 'photo.png', ext: 'png', sizeBytes: PNG.length })
  })

  it('shows the thumbnail an Office file carries, with its text', async () => {
    const p = join(dir(), '보고서.docx')
    writeFileSync(
      p,
      await zip({ 'word/document.xml': '<w:document/>', 'docProps/thumbnail.jpeg': JPEG }),
    )
    const r = await quickLook(p, { extractText: text('Hello') })
    expect(r.ok && r.image?.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(r.ok && r.text).toBe('Hello')
  })

  it('shows the thumbnail of an hwpx and of an HWP5 file', async () => {
    const d = dir()
    const hwpx = join(d, 'a.hwpx')
    writeFileSync(hwpx, await zip({ 'Contents/section0.xml': '<x/>', 'Preview/PrvImage.png': PNG }))
    const hwp = join(d, 'b.hwp')
    const cfb = CFB.utils.cfb_new()
    CFB.utils.cfb_add(cfb, 'PrvImage', PNG)
    writeFileSync(hwp, CFB.write(cfb, { type: 'buffer' }) as Buffer)
    for (const p of [hwpx, hwp]) {
      const r = await quickLook(p, { extractText: text('본문') })
      expect(r.ok && r.image?.startsWith('data:image/png;base64,'), p).toBe(true)
    }
  })

  it('keeps the start of the text, tidied, and says when it was cut', async () => {
    const p = join(dir(), 'long.txt')
    writeFileSync(p, 'x')
    const body = `[page 1]\nfirst\n\n\n\n\nsecond\n${'가'.repeat(10_000)}`
    const r = await quickLook(p, { extractText: text(body) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text!.length).toBe(6000)
    expect(r.truncated).toBe(true)
    expect(r.text).not.toContain('[page')
    expect(r.text).not.toMatch(/\n{3,}/)
    expect(r.text!.startsWith('first\n\nsecond')).toBe(true)
  })

  it('answers a format without a preview with the file facts only', async () => {
    const p = join(dir(), 'setup.exe')
    writeFileSync(p, 'MZ')
    const r = await quickLook(p, {
      extractText: vi.fn(async () => ({ kind: 'name-only' as const })),
    })
    expect(r).toMatchObject({ ok: true, name: 'setup.exe', truncated: false })
    expect(r.ok && (r.image ?? r.text)).toBeUndefined()
  })

  it('reports a missing file', async () => {
    const p = join(dir(), 'gone.pdf')
    expect(await quickLook(p)).toEqual({ ok: false, path: p, name: 'gone.pdf', error: 'missing' })
  })

  it('survives a broken file: no thumbnail from a fake zip, no text from a failing extractor', async () => {
    const p = join(dir(), 'broken.docx')
    writeFileSync(p, 'not a zip at all')
    const r = await quickLook(p, {
      extractText: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    expect(r).toMatchObject({ ok: true, name: 'broken.docx' })
    expect(r.ok && (r.image ?? r.text)).toBeUndefined()
  })

  it('reuses the payload until the file changes', async () => {
    const p = join(dir(), 'note.md')
    writeFileSync(p, '# hi')
    const extract = text('hi')
    await quickLook(p, { extractText: extract })
    await quickLook(p, { extractText: extract })
    expect(extract).toHaveBeenCalledTimes(1)
    utimesSync(p, new Date(), new Date(Date.now() + 5000))
    await quickLook(p, { extractText: extract })
    expect(extract).toHaveBeenCalledTimes(2)
  })
})
