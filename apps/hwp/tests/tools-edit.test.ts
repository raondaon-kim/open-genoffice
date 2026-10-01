import { describe, expect, it } from 'vitest'
import { editTools, snapshotFileName } from '../src/renderer/ai/tools/edit'
import type { AiEditRequest, AiEditResult } from '../src/shared/ai-contract'
import { call, ctxWith, fakeApi, fakeEditor, HWP5_BYTES, SHA, SHA_B } from './helpers/ai-fakes'

const NEW = new TextEncoder().encode('NEW-HWPX')
const okEdit = (request: AiEditRequest): AiEditResult => ({
  ok: true,
  data: NEW.buffer.slice(0),
  outputSha: SHA_B,
  changedPages: [0, 2],
  diffCount: 3,
  journal: request.ops.map((op, i) => ({
    opIndex: i,
    op: op.op,
    command: 'x',
    envelope: { schemaVersion: '1.0', replacedCount: 1 },
  })),
})

describe('edit_text (file path)', () => {
  it('snapshots, edits through main, reloads the bytes, records undo, marks dirty and focuses the target', async () => {
    const api = fakeApi({}, okEdit)
    const editor = fakeEditor()
    const ctx = ctxWith(api, editor)
    const result = await editTools.execute(
      ctx,
      call('edit_text', {
        ops: [
          { op: 'replace_phrase', find: '사업', replace: '프로젝트' },
          { op: 'set_paragraph_text', section: 0, paragraph: 3, text: '새 본문' },
        ],
      }),
    )
    expect(result.isError).toBeUndefined()
    expect(result.mutated).toBe(true)
    expect(api.snapshots).toEqual([SHA])
    expect(api.edits[0]).toMatchObject({
      sha: SHA,
      ops: [{ op: 'replace_phrase' }, { op: 'set_paragraph_text', paragraph: 3 }],
    })
    expect(editor.loadFile).toHaveBeenCalledWith(new Uint8Array(NEW), 'doc.hwpx', {
      skipUnsavedGuard: true,
    })
    expect(editor.focusTarget).toHaveBeenCalledWith({
      kind: 'body_paragraph',
      section: 0,
      paragraph: 3,
      charOffset: 0,
      length: 1,
    })
    expect(ctx.stack.depth).toBe(1)
    expect(ctx.stack.isSent(SHA_B)).toBe(true)
    expect(ctx.dirty).toBe(1)
    expect(result.output).toMatch(/Applied 2 op\(s\); 3 IR change\(s\); pages touched: 1, 3/)
    expect(result.output).toMatch(/op 0 replace_phrase.*replacedCount=1/)
    expect(result.output).toMatch(/undo_ai_edit/)
  })

  it('refuses to apply when the document changed underneath (fence) and leaves no undo entry', async () => {
    const api = fakeApi({}, okEdit)
    const editor = fakeEditor({ shas: [SHA, SHA, SHA_B] })
    const ctx = ctxWith(api, editor)
    const result = await editTools.execute(
      ctx,
      call('edit_text', { ops: [{ op: 'delete_paragraph', section: 0, paragraph: 1 }] }),
    )
    expect(result).toMatchObject({ isError: true, summary: 'document changed' })
    expect(editor.loadFile).not.toHaveBeenCalled()
    expect(ctx.stack.depth).toBe(0)
    expect(ctx.dirty).toBe(0)
  })

  it('reports a failed op with its index and touches nothing', async () => {
    const api = fakeApi({}, () => ({
      ok: false,
      failedOp: 1,
      error: 'Tool argument error (do not retry): 좌표가 격자를 벗어났습니다',
      journal: [],
    }))
    const editor = fakeEditor()
    const ctx = ctxWith(api, editor)
    const result = await editTools.execute(
      ctx,
      call('edit_text', {
        ops: [
          { op: 'delete_paragraph', section: 0, paragraph: 1 },
          { op: 'delete_paragraph', section: 0, paragraph: 2 },
        ],
      }),
    )
    expect(result).toMatchObject({ isError: true, summary: 'op 1 failed' })
    expect(result.output).toMatch(/op 1.*do not retry/)
    expect(editor.loadFile).not.toHaveBeenCalled()
    expect(ctx.stack.depth).toBe(0)
  })

  it('restores the previous bytes when reloading the edited document fails', async () => {
    const api = fakeApi({}, okEdit)
    const editor = fakeEditor()
    let calls = 0
    editor.loadFile = async () => {
      if (calls++ === 0) throw new Error('parse failure')
      return { pageCount: 3 }
    }
    const ctx = ctxWith(api, editor)
    const result = await editTools.execute(
      ctx,
      call('edit_text', { ops: [{ op: 'delete_paragraph', section: 0, paragraph: 1 }] }),
    )
    expect(result).toMatchObject({ isError: true, summary: 'reload failed' })
    expect(calls).toBe(2) // edited bytes, then the snapshot again
    expect(ctx.stack.depth).toBe(0)
  })

  it('enforces the op allow-list and the op count per tool', async () => {
    const ctx = ctxWith(fakeApi({}, okEdit))
    expect(
      await editTools.execute(
        ctx,
        call('edit_text', { ops: [{ op: 'set_cell', table: 0, row: 0, col: 0, text: 'x' }] }),
      ),
    ).toMatchObject({ isError: true, output: expect.stringMatching(/edit_table/) })
    expect(
      await editTools.execute(
        ctx,
        call('edit_table', { ops: [{ op: 'replace_phrase', find: 'a', replace: 'b' }] }),
      ),
    ).toMatchObject({ isError: true, output: expect.stringMatching(/edit_text/) })
    expect(await editTools.execute(ctx, call('edit_text', { ops: [] }))).toMatchObject({
      isError: true,
    })
    expect(
      await editTools.execute(
        ctx,
        call('edit_text', {
          ops: Array.from({ length: 21 }, () => ({
            op: 'delete_paragraph',
            section: 0,
            paragraph: 0,
          })),
        }),
      ),
    ).toMatchObject({ isError: true, output: expect.stringMatching(/20/) })
    expect(await editTools.execute(ctx, call('edit_text', {}))).toMatchObject({ isError: true })
  })
})

describe('edit_table / insert_element', () => {
  it('passes table ops through and focuses nothing (no paragraph coordinate)', async () => {
    const api = fakeApi({}, okEdit)
    const editor = fakeEditor()
    const result = await editTools.execute(
      ctxWith(api, editor),
      call('edit_table', { ops: [{ op: 'set_cell', table: 0, row: 1, col: 1, text: '900,000' }] }),
    )
    expect(result.isError).toBeUndefined()
    expect(api.edits[0].ops).toEqual([
      { op: 'set_cell', table: 0, row: 1, col: 1, text: '900,000' },
    ])
    expect(editor.focusTarget).not.toHaveBeenCalled()
  })

  it('maps element kinds onto edit ops and validates their arguments', async () => {
    // the studio reports the edit's outputSha after reload; this fake editor always says SHA
    const api = fakeApi({}, (request) => ({ ...okEdit(request), outputSha: SHA }))
    const ctx = ctxWith(api)
    await editTools.execute(
      ctx,
      call('insert_element', {
        kind: 'footnote',
        at: { section: 0, paragraph: 2, charOffset: 5 },
        text: '각주',
      }),
    )
    await editTools.execute(
      ctx,
      call('insert_element', { kind: 'header_text', at: { section: 0 }, text: '머리말' }),
    )
    await editTools.execute(
      ctx,
      call('insert_element', { kind: 'bookmark', at: { section: 0, paragraph: 2 }, name: '표시' }),
    )
    await editTools.execute(
      ctx,
      call('insert_element', { kind: 'page_break', at: { section: 0, paragraph: 3 } }),
    )
    expect(api.edits.map((e) => e.ops[0])).toEqual([
      { op: 'insert_footnote', section: 0, paragraph: 2, charOffset: 5, text: '각주' },
      { op: 'header_text', section: 0, text: '머리말' },
      { op: 'add_bookmark', section: 0, paragraph: 2, charOffset: 0, name: '표시' },
      { op: 'insert_page_break', section: 0, paragraph: 3, charOffset: 0 },
    ])
    expect(
      await editTools.execute(
        ctx,
        call('insert_element', { kind: 'bookmark', at: { section: 0, paragraph: 2 } }),
      ),
    ).toMatchObject({ isError: true, output: expect.stringMatching(/name/) })
    expect(
      await editTools.execute(
        ctx,
        call('insert_element', { kind: 'footer_text', at: { section: 0 } }),
      ),
    ).toMatchObject({ isError: true, output: expect.stringMatching(/text/) })
    expect(
      await editTools.execute(
        ctx,
        call('insert_element', { kind: 'image', at: { section: 0, paragraph: 0 } }),
      ),
    ).toMatchObject({ isError: true, output: expect.stringMatching(/kind/) })
  })
})

describe('undo_ai_edit', () => {
  it('reloads the previous snapshot and reports the remaining depth', async () => {
    const api = fakeApi({}, okEdit)
    const editor = fakeEditor()
    const ctx = ctxWith(api, editor)
    await editTools.execute(
      ctx,
      call('edit_text', { ops: [{ op: 'delete_paragraph', section: 0, paragraph: 1 }] }),
    )
    const undo = await editTools.execute(ctx, call('undo_ai_edit'))
    expect(undo).toMatchObject({ mutated: true, summary: 'AI edit reverted' })
    expect(editor.loadFile).toHaveBeenLastCalledWith(new Uint8Array([1, 2, 3]), 'doc.hwpx', {
      skipUnsavedGuard: true,
    })
    expect(ctx.stack.depth).toBe(0)
    expect(ctx.dirty).toBe(2)
    const nothing = await editTools.execute(ctx, call('undo_ai_edit'))
    expect(nothing).toMatchObject({ summary: 'nothing to undo' })
    expect(nothing.isError).toBeUndefined()
  })
})

it("snapshotFileName keeps the base name and names the bytes' real format", () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
  const cfb = new Uint8Array(HWP5_BYTES)
  expect(snapshotFileName('보고서.hwp', zip)).toBe('보고서.hwpx')
  expect(snapshotFileName('a.hwpx', zip)).toBe('a.hwpx')
  expect(snapshotFileName('untitled', zip)).toBe('untitled.hwpx')
  expect(snapshotFileName('보고서.hwp', cfb)).toBe('보고서.hwp')
  expect(snapshotFileName('a.hwpx', cfb)).toBe('a.hwp')
})

describe('an .hwp (HWP5) document', () => {
  it('uploads exportHwp() bytes, reloads the edited HWP5 bytes as .hwp, and undo keeps .hwp', async () => {
    const edited = new Uint8Array([...HWP5_BYTES, 7])
    const api = fakeApi({}, (request) => ({ ...okEdit(request), data: edited.buffer.slice(0) }))
    const editor = fakeEditor({ format: 'hwp' })
    const ctx = ctxWith(api, editor)
    const result = await editTools.execute(
      ctx,
      call('edit_text', { ops: [{ op: 'replace_phrase', find: '사업', replace: '프로젝트' }] }),
    )
    expect(result.isError).toBeUndefined()
    expect(editor.exportHwpx).not.toHaveBeenCalled()
    expect(editor.loadFile).toHaveBeenLastCalledWith(new Uint8Array(edited), 'doc.hwp', {
      skipUnsavedGuard: true,
    })
    await editTools.execute(ctx, call('undo_ai_edit'))
    expect(editor.loadFile).toHaveBeenLastCalledWith(new Uint8Array(HWP5_BYTES), 'doc.hwp', {
      skipUnsavedGuard: true,
    })
  })
})
