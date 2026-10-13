import { describe, expect, it, vi } from 'vitest'
import { stylesTools } from '../src/renderer/ai/tools/styles'
import type { DocStyle } from '../src/shared/doc-style'
import { call, ctxWith, fakeApi, fakeEditor } from './helpers/ai-fakes'

const style: DocStyle = {
  id: 'seoul-gian',
  title: '서울시 기안문(공문)',
  version: 1,
  draft: true,
  evidence: { documents: 3, note: '합성' },
  page: {
    paper: 'A4 세로',
    marginMm: { left: 20, right: 15, top: 20, bottom: 15 },
    settable: false,
  },
  roles: [
    {
      id: 'org-name',
      label: '행정기관명',
      marker: 'text',
      lead: 0,
      size: 20,
      bold: true,
      align: 'center',
      marginLeft: 0,
      marginRight: 0,
      indent: 0,
      spacingBefore: 0,
      spacingAfter: 0,
      lineSpacing: 150,
    },
    {
      id: 'item-2',
      label: '2단계',
      marker: '가.',
      lead: 2,
      size: 13,
      bold: false,
      align: 'justify',
      marginLeft: 0,
      marginRight: 0,
      indent: 660,
      spacingBefore: 0,
      spacingAfter: 0,
      lineSpacing: 180,
    },
  ],
  skeleton: [{ slot: 'org', role: 'org-name', required: true }],
}

function ctx(over: Record<string, unknown> = {}) {
  const api = Object.assign(fakeApi({}), {
    listDocStyles: vi.fn(async () => ({
      ok: true as const,
      styles: [{ id: 'seoul-gian', title: style.title, draft: true, evidence: style.evidence }],
      errors: [],
    })),
    readDocStyle: vi.fn(async (id: string) =>
      id === 'seoul-gian'
        ? { ok: true as const, style, description: '설명 본문' }
        : { ok: false as const, error: `no style "${id}"` },
    ),
    createStyledDocument: vi.fn(async () => ({
      ok: true as const,
      path: 'C:/x/서울시 기안문(공문).hwpx',
      paragraphs: 2,
      roleCounts: { 'org-name': 1, 'item-2': 1 },
      warnings: [] as string[],
    })),
    exportDocStyles: vi.fn(async () => ({
      ok: true as const,
      target: 'D:/wiki/genoffice-doc-styles',
      count: 3,
    })),
    ...over,
  })
  return { api, ctx: ctxWith(api, fakeEditor()) }
}

describe('document style tools', () => {
  it('lists the styles and marks drafts', async () => {
    const { ctx: c } = ctx()
    const out = JSON.parse((await stylesTools.execute(c, call('list_document_styles'))).output)
    expect(out.styles[0]).toMatchObject({ id: 'seoul-gian', draft: true })
  })

  it('reads one style as a compact role table with the skeleton and the description', async () => {
    const { ctx: c } = ctx()
    const result = await stylesTools.execute(c, call('read_document_style', { id: 'seoul-gian' }))
    const out = JSON.parse(result.output)
    expect(out.roles[0]).toMatchObject({ id: 'org-name', size: 20, bold: true, align: 'center' })
    expect(out.roles[1]).toMatchObject({ id: 'item-2', lead: 2, align: 'justify' })
    expect(out.skeleton[0]).toMatchObject({ slot: 'org', required: true })
    expect(out.description).toContain('설명 본문')
    expect(out.page).toMatchObject({ settable: false })
  })

  it('reports an unknown style as an error the model can act on', async () => {
    const { ctx: c } = ctx()
    const result = await stylesTools.execute(c, call('read_document_style', { id: 'nope' }))
    expect(result.isError).toBe(true)
    expect(result.output).toMatch(/list_document_styles/)
  })

  it('creates a styled document and says what the user still has to set', async () => {
    const { api, ctx: c } = ctx()
    const blocks = [
      { role: 'org-name', text: '서울특별시 인재개발담당관' },
      { role: 'item-2', text: '가. 근거' },
    ]
    const result = await stylesTools.execute(
      c,
      call('create_styled_document', {
        style: 'seoul-gian',
        blocks,
        file_name: '인사교류',
        done: true,
      }),
    )
    expect(result.isError).toBeUndefined()
    expect(api.createStyledDocument).toHaveBeenCalledWith({
      style: 'seoul-gian',
      blocks,
      fileName: '인사교류',
    })
    expect(result.output).toMatch(/2 paragraph/)
    expect(result.output).toMatch(/margins and fonts|여백|page margins/)
    expect(result.output).toMatch(/⌘S/)
  })

  it('refuses a call without done, so a first stage never becomes a half document', async () => {
    const { api, ctx: c } = ctx()
    const result = await stylesTools.execute(
      c,
      call('create_styled_document', {
        style: 'seoul-gian',
        blocks: [{ role: 'item-2', text: 'x' }],
      }),
    )
    expect(result.isError).toBe(true)
    expect(result.output).toMatch(/done is required/)
    expect(api.createStyledDocument).not.toHaveBeenCalled()
  })

  it('keeps a stage in a draft with done:false and passes the draft id on', async () => {
    const { api, ctx: c } = ctx({
      createStyledDocument: vi.fn(async () => ({
        ok: true as const,
        staged: true as const,
        draftId: 'd1',
        paragraphs: 3,
      })),
    })
    const result = await stylesTools.execute(
      c,
      call('create_styled_document', {
        style: 'seoul-gian',
        blocks: [{ role: 'item-2', text: 'x' }],
        draft_id: 'd1',
        done: false,
      }),
    )
    expect(api.createStyledDocument).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 'd1', done: false }),
    )
    expect(result.output).toMatch(/draft d1 \(3 block/)
  })

  it('passes skeleton warnings on to the model', async () => {
    const { ctx: c } = ctx({
      createStyledDocument: vi.fn(async () => ({
        ok: true as const,
        path: 'C:/x/a.hwpx',
        paragraphs: 1,
        roleCounts: { 'item-2': 1 },
        warnings: ['missing required part "org" (org-name)'],
      })),
    })
    const result = await stylesTools.execute(
      c,
      call('create_styled_document', {
        style: 'seoul-gian',
        blocks: [{ role: 'item-2', text: 'x' }],
        done: true,
      }),
    )
    expect(result.output).toMatch(/missing required part "org"/)
  })

  it.each([
    ['no style', { blocks: [{ role: 'a', text: 'b' }] }],
    ['no blocks', { style: 'seoul-gian' }],
    ['an empty block list', { style: 'seoul-gian', blocks: [] }],
    ['a block without a role', { style: 'seoul-gian', blocks: [{ text: 'b' }] }],
    ['a block with a non-string text', { style: 'seoul-gian', blocks: [{ role: 'a', text: 5 }] }],
  ])('rejects %s before calling main', async (_label, input) => {
    const { api, ctx: c } = ctx()
    const result = await stylesTools.execute(c, call('create_styled_document', input))
    expect(result.isError).toBe(true)
    expect(api.createStyledDocument).not.toHaveBeenCalled()
  })

  it('shows the engine error when creation fails', async () => {
    const { ctx: c } = ctx({
      createStyledDocument: vi.fn(async () => ({
        ok: false as const,
        error: 'block 3: unknown role "x"',
      })),
    })
    const result = await stylesTools.execute(
      c,
      call('create_styled_document', {
        style: 'seoul-gian',
        blocks: [{ role: 'x', text: 'y' }],
        done: true,
      }),
    )
    expect(result.isError).toBe(true)
    expect(result.output).toMatch(/unknown role "x"/)
  })

  it('exports the wiki and reports the folder, or a cancel', async () => {
    const { ctx: c } = ctx()
    const done = await stylesTools.execute(c, call('export_document_styles'))
    expect(done.output).toMatch(/3 page/)
    expect(done.output).toMatch(/genoffice-doc-styles/)
    const { ctx: c2 } = ctx({
      exportDocStyles: vi.fn(async () => ({ ok: false as const, canceled: true })),
    })
    const canceled = await stylesTools.execute(c2, call('export_document_styles'))
    expect(canceled.isError).toBeUndefined()
    expect(canceled.output).toMatch(/cancel/i)
  })
})
