import { describe, expect, it } from 'vitest'
import {
  AGENT_TOOLS,
  createHwpSkill,
  executeHwpTool,
  SYSTEM_PROMPT,
} from '../src/renderer/ai/hwp-skill'
import { FENCE_RULE } from '../src/renderer/ai/provenance'
import { call, ctxWith, env, fakeApi } from './helpers/ai-fakes'

const EXPECTED = [
  'apply_format',
  'create_document',
  'edit_table',
  'edit_text',
  'fill_fields',
  'find',
  'get_document_overview',
  'get_document_state',
  'insert_element',
  'list_fields',
  'read_pages',
  'read_table',
  'rhwp_query',
  'undo_ai_edit',
]

describe('hwp skill', () => {
  it('exposes exactly the 14 tools of the spec, each with an object input schema', () => {
    expect(AGENT_TOOLS.map((t) => t.name).sort()).toEqual(EXPECTED)
    expect(new Set(AGENT_TOOLS.map((t) => t.name)).size).toBe(AGENT_TOOLS.length)
    for (const tool of AGENT_TOOLS) expect(tool.inputSchema).toMatchObject({ type: 'object' })
  })

  it('states the coordinate discipline, the data fence and undo in the system prompt', () => {
    expect(SYSTEM_PROMPT).toContain(FENCE_RULE)
    expect(SYSTEM_PROMPT).toMatch(/find/)
    expect(SYSTEM_PROMPT).toMatch(/undo_ai_edit/)
    expect(SYSTEM_PROMPT).not.toMatch(/write_content|add_table|set_text_color/)
    const skill = createHwpSkill(ctxWith(fakeApi({})))
    expect(skill.id).toBe('hwp')
    expect(skill.buildContext?.()).toContain('doc.hwp')
  })

  it('routes calls to their module and reports unknown tools', async () => {
    const ctx = ctxWith(fakeApi({}))
    expect(await executeHwpTool(ctx, call('nope'))).toMatchObject({
      isError: true,
      output: 'Unknown tool: nope',
    })
    expect(await executeHwpTool(ctx, call('get_document_state'))).toMatchObject({
      summary: 'hwpx, 3 page(s)',
    })
  })

  it('rhwp_query honours its allow-list, fences the envelope and flags negative results', async () => {
    const ctx = ctxWith(
      fakeApi({
        digest: env({
          excerpt: '본문 발췌',
          paraCount: 7,
          untrustedContent: true,
          untrustedFields: ['excerpt'],
        }),
        verify: { fail: { exitCode: 3, envelope: env({ verdict: 'fail', failCount: 1 }) } },
      }),
    )
    const digest = await executeHwpTool(ctx, call('rhwp_query', { name: 'digest' }))
    expect(digest.isError).toBeUndefined()
    expect(digest.output).toMatch(/"excerpt":"⟦문서 내용:[0-9a-f]{16}⟧본문 발췌⟦\/문서 내용/)
    const verify = await executeHwpTool(
      ctx,
      call('rhwp_query', { name: 'verify', args: { pages: 99 } }),
    )
    expect(verify.output).toMatch(/^Result: negative/)
    expect(verify.summary).toBe('verify (negative)')
    const denied = await executeHwpTool(
      ctx,
      call('rhwp_query', { name: 'search', args: { query: 'x' } }),
    )
    expect(denied).toMatchObject({
      isError: true,
      output: expect.stringMatching(/dedicated tools/),
    })
  })

  it('create_document delegates to the HwpForge IPC', async () => {
    const api = fakeApi({})
    const result = await executeHwpTool(
      ctxWith(api),
      call('create_document', { markdown: '# 제목', file_name: '보고서' }),
    )
    expect(api.createDocument).toHaveBeenCalledWith('# 제목', '보고서')
    expect(result.output).toMatch(/Created "doc\.hwpx"/)
  })
})
