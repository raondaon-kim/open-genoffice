import { describe, expect, it } from 'vitest'
import { editTools } from '../src/renderer/ai/tools/edit'
import { formatTools } from '../src/renderer/ai/tools/format'
import { readTools } from '../src/renderer/ai/tools/read'
import type { AiEditRequest, AiEditResult } from '../src/shared/ai-contract'
import { call, ctxWith, env, fakeApi, fakeEditor, SHA, SHA_B } from './helpers/ai-fakes'

// The model takes coordinates from a read (find / get_document_overview). If the
// user edits the document before the model's edit arrives, those coordinates
// point at shifted text: a coordinate edit must be refused until it reads again.

const okEdit = (request: AiEditRequest): AiEditResult => ({
  ok: true,
  data: new Uint8Array([1]).buffer,
  outputSha: SHA_B,
  changedPages: [0],
  diffCount: 1,
  journal: request.ops.map((op, i) => ({
    opIndex: i,
    op: op.op,
    command: 'x',
    envelope: { schemaVersion: '1.0' },
  })),
})
const searchAnswer = env({ query: '사업', totalMatchCount: 0, matches: [] })

describe('coordinates read before the user edited', () => {
  it('refuses a coordinate edit when the document moved since the last read', async () => {
    const api = fakeApi({ search: searchAnswer }, okEdit)
    // find captures SHA; the user then types → every later state is SHA_B
    const ctx = ctxWith(api, fakeEditor({ shas: [SHA, SHA_B] }))
    await readTools.execute(ctx, call('find', { query: '사업' }))
    const result = await editTools.execute(
      ctx,
      call('edit_text', { ops: [{ op: 'delete_paragraph', section: 0, paragraph: 1 }] }),
    )
    expect(result).toMatchObject({ isError: true, summary: 'document changed' })
    expect(result.output).toMatch(/read/i)
    expect(api.edits).toEqual([])
    expect(ctx.stack.depth).toBe(0)
  })

  it('still runs a search-based replace_phrase batch (no coordinates)', async () => {
    const api = fakeApi({ search: searchAnswer }, okEdit)
    const ctx = ctxWith(api, fakeEditor({ shas: [SHA, SHA_B] }))
    await readTools.execute(ctx, call('find', { query: '사업' }))
    const result = await editTools.execute(
      ctx,
      call('edit_text', { ops: [{ op: 'replace_phrase', find: '사업', replace: '프로젝트' }] }),
    )
    expect(result.isError).toBeUndefined()
    expect(api.edits).toHaveLength(1)
  })

  it("accepts coordinates after the model's own edit moved the document", async () => {
    const api = fakeApi({ search: searchAnswer }, okEdit)
    // find (SHA) · edit 1: before/capture/after (SHA) · reload → the studio reports SHA_B
    const ctx = ctxWith(api, fakeEditor({ shas: [SHA, SHA, SHA, SHA, SHA_B] }))
    await readTools.execute(ctx, call('find', { query: '사업' }))
    const first = await editTools.execute(
      ctx,
      call('edit_text', { ops: [{ op: 'delete_paragraph', section: 0, paragraph: 1 }] }),
    )
    expect(first.isError).toBeUndefined()
    const second = await editTools.execute(
      ctx,
      call('edit_text', { ops: [{ op: 'delete_paragraph', section: 0, paragraph: 2 }] }),
    )
    expect(second.isError).toBeUndefined()
    expect(api.edits).toHaveLength(2)
  })

  it('refuses live formatting at stale coordinates before touching the editor', async () => {
    const editor = fakeEditor({ shas: [SHA, SHA_B] })
    const ctx = ctxWith(fakeApi({ search: searchAnswer }, okEdit), editor)
    await readTools.execute(ctx, call('find', { query: '사업' }))
    const result = await formatTools.execute(
      ctx,
      call('apply_format', {
        target: { section: 0, paragraph: 1, length: 2 },
        format: { align: 'center' },
      }),
    )
    expect(result).toMatchObject({ isError: true, summary: 'document changed' })
    expect(editor.focusTarget).not.toHaveBeenCalled()
    expect(editor.commands.execute).not.toHaveBeenCalled()
    expect(ctx.stack.depth).toBe(0)
  })
})
