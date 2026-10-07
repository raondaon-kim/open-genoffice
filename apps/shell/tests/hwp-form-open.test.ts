import { describe, expect, it, vi } from 'vitest'
import { loadFormFile, MAX_FORM_BYTES } from '../src/main/hwp-form-open'

const deps = (size: number, bytes = Buffer.from([1, 2, 3])) => ({
  stat: vi.fn(async () => ({ size })),
  readFile: vi.fn(async () => bytes),
})

describe('loadFormFile', () => {
  it('reads an .hwp/.hwpx form into a name and bytes', async () => {
    const d = deps(3)
    const form = await loadFormFile('D:\\양식\\결재문서본문.hwpx', d)
    expect(form).toMatchObject({ ok: true, fileName: '결재문서본문.hwpx' })
    expect(Array.from(new Uint8Array((form as { data: ArrayBuffer }).data))).toEqual([1, 2, 3])
    expect((await loadFormFile('/forms/품의서.HWP', deps(3))).ok).toBe(true)
  })

  it('refuses other extensions without reading', async () => {
    const d = deps(3)
    expect(await loadFormFile('C:/x/report.docx', d)).toMatchObject({ ok: false })
    expect(d.readFile).not.toHaveBeenCalled()
  })

  it('refuses a form over 50 MB without reading', async () => {
    const d = deps(MAX_FORM_BYTES + 1)
    const form = await loadFormFile('C:/x/big.hwpx', d)
    expect(form).toMatchObject({ ok: false })
    expect((form as { error: string }).error).toMatch(/50 MB/)
    expect(d.readFile).not.toHaveBeenCalled()
  })

  it('reports a file that cannot be read', async () => {
    const form = await loadFormFile('C:/x/gone.hwp', {
      stat: async () => {
        throw new Error('ENOENT')
      },
      readFile: async () => Buffer.alloc(0),
    })
    expect(form).toMatchObject({ ok: false })
  })
})
