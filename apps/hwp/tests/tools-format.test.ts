import { describe, expect, it } from 'vitest'
import { formatTools } from '../src/renderer/ai/tools/format'
import type { AiEditRequest, AiEditResult } from '../src/shared/ai-contract'
import { call, ctxWith, fakeApi, fakeEditor, SHA_B } from './helpers/ai-fakes'

const okEdit = (request: AiEditRequest): AiEditResult => ({
  ok: true,
  data: new Uint8Array([9]).buffer,
  outputSha: SHA_B,
  changedPages: [0],
  diffCount: 1,
  journal: request.ops.map((op, i) => ({
    opIndex: i,
    op: op.op,
    command: 'x',
    envelope: { schemaVersion: '1.0', filledCount: 1, notFound: ['없음'] },
  })),
})
const target = { section: 0, paragraph: 2, length: 4 }

describe('apply_format', () => {
  it('routes absolute attributes to a file edit as one undo unit', async () => {
    const api = fakeApi({}, okEdit)
    const editor = fakeEditor()
    const ctx = ctxWith(api, editor)
    const result = await formatTools.execute(
      ctx,
      call('apply_format', { target, format: { bold: true, color: '#00FF00' } }),
    )
    expect(result.isError).toBeUndefined()
    expect(api.edits[0].ops).toEqual([
      {
        op: 'apply_char_format',
        section: 0,
        paragraph: 2,
        props: { bold: true, textColor: '#00FF00' },
      },
    ])
    expect(editor.commands.execute).not.toHaveBeenCalled()
    expect(ctx.stack.depth).toBe(1)
    expect(ctx.dirty).toBe(1)
    expect(result.output).toMatch(/Formatted paragraph 2/)
  })

  it('applies alignment live: focus the paragraph, run the command, keep an undo snapshot, no reload', async () => {
    const api = fakeApi({}, okEdit)
    const editor = fakeEditor()
    const ctx = ctxWith(api, editor)
    const result = await formatTools.execute(
      ctx,
      call('apply_format', { target, format: { align: 'center' } }),
    )
    expect(result).toMatchObject({ mutated: true })
    expect(editor.focusTarget).toHaveBeenCalledWith({
      kind: 'body_paragraph',
      section: 0,
      paragraph: 2,
      charOffset: 0,
      length: 4,
    })
    expect(editor.commands.execute).toHaveBeenCalledWith('format:align-center')
    expect(api.edits).toEqual([])
    expect(editor.loadFile).not.toHaveBeenCalled()
    expect(ctx.stack.depth).toBe(1)
    expect(result.output).toMatch(/format:align-center/)
  })

  it('runs the live phase first and the file phase second, as one undo unit', async () => {
    const api = fakeApi({}, okEdit)
    const editor = fakeEditor()
    const ctx = ctxWith(api, editor)
    await formatTools.execute(
      ctx,
      call('apply_format', { target, format: { sizeDelta: 2, underline: true } }),
    )
    expect(editor.commands.execute).toHaveBeenCalledTimes(2)
    expect(api.edits[0].ops[0]).toMatchObject({
      op: 'apply_char_format',
      props: { underline: true },
    })
    expect(ctx.stack.depth).toBe(1)
  })

  it('fails without applying anything when the target is stale', async () => {
    const editor = fakeEditor()
    editor.focusTarget = async () => ({ focused: false, page: 0 })
    const ctx = ctxWith(fakeApi({}, okEdit), editor)
    const result = await formatTools.execute(
      ctx,
      call('apply_format', { target, format: { align: 'left' } }),
    )
    expect(result).toMatchObject({ isError: true, summary: 'target not found' })
    expect(editor.commands.execute).not.toHaveBeenCalled()
    expect(ctx.stack.depth).toBe(0)
  })

  it('keeps the undo snapshot when a live command is refused midway', async () => {
    const editor = fakeEditor()
    let n = 0
    editor.commands.execute = async () =>
      n++ === 0
        ? { ok: true as const }
        : { ok: false as const, reason: 'disabled', message: 'not on text' }
    const ctx = ctxWith(fakeApi({}, okEdit), editor)
    const result = await formatTools.execute(
      ctx,
      call('apply_format', { target, format: { sizeDelta: 2 } }),
    )
    expect(result).toMatchObject({ isError: true, summary: 'command refused' })
    expect(result.output).toMatch(/disabled.*not on text.*format:font-size-increase/)
    expect(ctx.stack.depth).toBe(1)
  })

  it('leaves no undo entry when the file phase fails and nothing ran live', async () => {
    const failEdit = (): AiEditResult => ({
      ok: false,
      failedOp: 0,
      error: 'Tool argument error (do not retry): bad paragraph',
      journal: [],
    })
    const ctx = ctxWith(fakeApi({}, failEdit), fakeEditor())
    const result = await formatTools.execute(
      ctx,
      call('apply_format', { target, format: { bold: true } }),
    )
    expect(result).toMatchObject({ isError: true })
    expect(ctx.stack.depth).toBe(0)
    expect(ctx.dirty).toBe(0)
  })

  it('keeps the undo entry and says what already ran when the file phase fails after live steps', async () => {
    const failEdit = (): AiEditResult => ({
      ok: false,
      failedOp: 0,
      error: 'Tool argument error (do not retry): bad paragraph',
      journal: [],
    })
    const ctx = ctxWith(fakeApi({}, failEdit), fakeEditor())
    const result = await formatTools.execute(
      ctx,
      call('apply_format', { target, format: { sizeDelta: 1, bold: true } }),
    )
    expect(result).toMatchObject({ isError: true })
    expect(result.output).toMatch(/Already applied live: format:font-size-increase/)
    expect(result.output).toMatch(/undo_ai_edit/)
    expect(ctx.stack.depth).toBe(1)
  })

  it('leaves no undo entry when the very first live command is refused', async () => {
    const editor = fakeEditor()
    editor.commands.execute = async () => ({
      ok: false as const,
      reason: 'disabled',
      message: 'not on text',
    })
    const ctx = ctxWith(fakeApi({}, okEdit), editor)
    const result = await formatTools.execute(
      ctx,
      call('apply_format', { target, format: { align: 'center' } }),
    )
    expect(result).toMatchObject({ isError: true, summary: 'command refused' })
    expect(ctx.stack.depth).toBe(0)
    expect(ctx.dirty).toBe(0)
  })

  it('validates target and format', async () => {
    const ctx = ctxWith(fakeApi({}, okEdit))
    expect(
      await formatTools.execute(ctx, call('apply_format', { format: { bold: true } })),
    ).toMatchObject({ isError: true, output: expect.stringMatching(/target/) })
    expect(
      await formatTools.execute(ctx, call('apply_format', { target, format: {} })),
    ).toMatchObject({ isError: true, output: expect.stringMatching(/at least one/) })
  })
})

describe('fill_fields', () => {
  it('fills live through hwpctrl PutFieldText and skips the CLI when every field took', async () => {
    const api = fakeApi({}, okEdit)
    const editor = fakeEditor()
    const ctx = ctxWith(api, editor)
    const result = await formatTools.execute(
      ctx,
      call('fill_fields', { data: { 회사명: '유비온', 작성자: '홍길동' } }),
    )
    expect(result).toMatchObject({ mutated: true, summary: '2 field(s) filled' })
    expect(editor.hwpctrl.call).toHaveBeenCalledWith('PutFieldText', ['회사명', '유비온'])
    expect(editor.hwpctrl.call).toHaveBeenCalledWith('PutFieldText', ['작성자', '홍길동'])
    expect(api.edits).toEqual([])
    expect(ctx.stack.depth).toBe(1)
    expect(ctx.dirty).toBe(1)
  })

  it('falls back to the CLI for the fields the live control refused', async () => {
    const api = fakeApi({}, okEdit)
    const editor = fakeEditor()
    editor.hwpctrl.call = async (_m: string, args?: unknown[]) =>
      args?.[0] === '작성자[1]' ? false : true
    const ctx = ctxWith(api, editor)
    const result = await formatTools.execute(
      ctx,
      call('fill_fields', { data: { 회사명: '유비온', '작성자[1]': '홍길동' } }),
    )
    expect(result.isError).toBeUndefined()
    expect(api.edits[0].ops).toEqual([{ op: 'fill_fields', data: { '작성자[1]': '홍길동' } }])
    expect(result.output).toMatch(/회사명/)
    expect(result.output).toMatch(/notFound=\["없음"\]/)
    expect(ctx.stack.depth).toBe(1)
  })

  it('leaves no undo entry when every field went to the CLI and the CLI failed', async () => {
    const editor = fakeEditor()
    editor.hwpctrl.call = async () => false
    const ctx = ctxWith(
      fakeApi({}, () => ({ ok: false, failedOp: 0, error: 'engine failed', journal: [] })),
      editor,
    )
    const result = await formatTools.execute(ctx, call('fill_fields', { data: { a: 'b' } }))
    expect(result).toMatchObject({ isError: true })
    expect(ctx.stack.depth).toBe(0)
  })

  it('names the live-filled fields when the CLI fallback fails', async () => {
    const editor = fakeEditor()
    editor.hwpctrl.call = async (_m: string, args?: unknown[]) => args?.[0] !== '작성자'
    const ctx = ctxWith(
      fakeApi({}, () => ({ ok: false, failedOp: 0, error: 'engine failed', journal: [] })),
      editor,
    )
    const result = await formatTools.execute(
      ctx,
      call('fill_fields', { data: { 회사명: '유비온', 작성자: '홍길동' } }),
    )
    expect(result).toMatchObject({ isError: true })
    expect(result.output).toMatch(/Already applied live: 회사명/)
    expect(ctx.stack.depth).toBe(1)
  })

  it('loads the hwpctrl plugin when it is not active yet, and validates data', async () => {
    const editor = fakeEditor()
    editor.plugins.list = async () => []
    const ctx = ctxWith(fakeApi({}, okEdit), editor)
    await formatTools.execute(ctx, call('fill_fields', { data: { a: 'b' } }))
    expect(editor.plugins.load).toHaveBeenCalledWith('hwpctrl')
    expect(await formatTools.execute(ctx, call('fill_fields', { data: {} }))).toMatchObject({
      isError: true,
    })
    expect(await formatTools.execute(ctx, call('fill_fields', { data: { a: 1 } }))).toMatchObject({
      isError: true,
      output: expect.stringMatching(/string/),
    })
  })
})
