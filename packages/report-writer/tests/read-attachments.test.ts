import { describe, expect, it } from 'vitest'
import { readAllAttachments } from '../src/read-attachments'

describe('readAllAttachments', () => {
  it('pages through each file until its total and skips images', async () => {
    const texts: Record<string, string> = { 'C:/a.pdf': 'x'.repeat(50000), 'C:/b.docx': '# 목차' }
    const reads: Array<[string, number]> = []
    const got = await readAllAttachments(
      [
        { path: 'C:/a.pdf', name: 'a.pdf', ext: 'pdf' },
        { path: 'C:/p.png', name: 'p.png', ext: 'png' },
        { path: 'C:/b.docx', name: 'b.docx', ext: 'docx' },
      ],
      async (path, offset, max) => {
        reads.push([path, offset])
        const t = texts[path]!
        return { ok: true, text: t.slice(offset, offset + max), totalChars: t.length }
      },
    )
    expect(got.map((a) => [a.name, a.text.length])).toEqual([
      ['a.pdf', 50000],
      ['b.docx', 4],
    ])
    expect(reads).toEqual([
      ['C:/a.pdf', 0],
      ['C:/a.pdf', 24000],
      ['C:/a.pdf', 48000],
      ['C:/b.docx', 0],
    ])
  })

  it('throws naming the file that could not be read', async () => {
    await expect(
      readAllAttachments([{ path: 'C:/x.hwp', name: 'x.hwp', ext: 'hwp' }], async () => ({
        ok: false,
        error: 'locked',
      })),
    ).rejects.toThrow(/x\.hwp.*locked/)
  })
})
