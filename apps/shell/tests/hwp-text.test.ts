import { describe, expect, it, vi } from 'vitest'
import { hwpTextExtractor, joinExportedPages } from '../src/main/hwp-text'

const exported = (pages: string[]) =>
  JSON.stringify({ pageCount: pages.length, pages: pages.map((text, page) => ({ page, text })) })

describe('Hangul attachment text through rhwp', () => {
  it('joins the pages with page markers', () => {
    expect(joinExportedPages(exported(['제안서 작성 요령', '평가표 및 배점']))).toBe(
      '[page 1]\n제안서 작성 요령\n\n[page 2]\n평가표 및 배점',
    )
  })

  it('runs export-text in JSON mode on the file', async () => {
    const run = vi.fn(async () => exported(['본문']))
    const text = await hwpTextExtractor(run)('C:/rfp/제안요청서.hwp')
    expect(run).toHaveBeenCalledWith(['export-text', 'C:/rfp/제안요청서.hwp', '--json'])
    expect(text).toBe('[page 1]\n본문')
  })

  it('fails on a document without text and passes engine errors on', async () => {
    await expect(hwpTextExtractor(async () => exported(['', ' ']))('a.hwp')).rejects.toThrow(
      /no text/,
    )
    await expect(
      hwpTextExtractor(async () => {
        throw new Error('UNSUPPORTED_FILE_FORMAT')
      })('a.hwp'),
    ).rejects.toThrow(/UNSUPPORTED_FILE_FORMAT/)
  })
})
