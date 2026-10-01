import { vi } from 'vitest'
import type { AgentToolCall } from '@genoffice/agent-core'
import type { EditorLike, HwpAiApi, HwpAiContext } from '../../src/renderer/ai/context'
import { SnapshotStack } from '../../src/renderer/ai/snapshots'
import type {
  AiEditRequest,
  AiEditResult,
  AiQueryName,
  AiQueryRequest,
  RhwpEnvelope,
} from '../../src/shared/ai-contract'

export const SHA = 'a'.repeat(64)
export const SHA_B = 'b'.repeat(64)

export interface FakeEditor extends EditorLike {
  /** documentSha256 values returned by successive getDocumentState calls (last one repeats) */
  shas: string[]
}

export function fakeEditor(overrides: { shas?: string[]; pageCount?: number } = {}): FakeEditor {
  const shas = overrides.shas ?? [SHA]
  let i = 0
  const editor = {
    shas,
    getDocumentState: vi.fn(async () => ({
      schemaVersion: 1 as const,
      format: 'hwpx' as const,
      documentEpoch: 1,
      changeSeq: 1,
      dirty: false,
      pageCount: overrides.pageCount ?? 3,
      documentSha256: shas[Math.min(i++, shas.length - 1)],
    })),
    exportHwpx: vi.fn(async () => new Uint8Array([1, 2, 3])),
    loadFile: vi.fn(async () => ({ pageCount: 3 })),
    focusTarget: vi.fn(async () => ({ focused: true, page: 1 })),
    commands: {
      list: vi.fn(),
      menuModel: vi.fn(),
      isEnabled: vi.fn(),
      execute: vi.fn(async () => ({ ok: true as const })),
      context: vi.fn(),
    },
    plugins: {
      list: vi.fn(async () => [{ id: 'hwpctrl', apiVersion: 1, active: true }]),
      load: vi.fn(async () => ({ id: 'hwpctrl', methods: [] })),
      unload: vi.fn(),
      invoke: vi.fn(),
    },
    hwpctrl: {
      call: vi.fn(async () => true),
      batch: vi.fn(),
      exportBytes: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
    },
  }
  return editor as unknown as FakeEditor
}

export type Answer =
  | RhwpEnvelope
  | ((args: Record<string, unknown>) => RhwpEnvelope)
  | { fail: { exitCode: 1 | 2 | 3; envelope?: RhwpEnvelope; stderr?: string } }
  | { error: string }

export interface FakeApi extends HwpAiApi {
  queries: AiQueryRequest[]
  snapshots: string[]
  edits: AiEditRequest[]
}

export function fakeApi(
  answers: Partial<Record<AiQueryName, Answer | Answer[]>>,
  edit: (request: AiEditRequest) => AiEditResult = () => ({
    ok: false,
    failedOp: null,
    error: 'no edit scripted',
    journal: [],
  }),
): FakeApi {
  const queries: AiQueryRequest[] = []
  const snapshots: string[] = []
  const edits: AiEditRequest[] = []
  const api = {
    queries,
    snapshots,
    edits,
    aiSnapshot: vi.fn(async ({ sha }: { sha: string }) => {
      snapshots.push(sha)
      return { ok: true as const }
    }),
    aiQuery: vi.fn(async (request: AiQueryRequest) => {
      queries.push(request)
      const scripted = answers[request.tool]
      const answer = Array.isArray(scripted) ? scripted.shift() : scripted
      if (!answer) return { ok: false as const, error: `unexpected query ${request.tool}` }
      if ('error' in answer && typeof answer.error === 'string' && !('schemaVersion' in answer)) {
        return { ok: false as const, error: answer.error }
      }
      if ('fail' in answer && typeof answer.fail === 'object' && !('schemaVersion' in answer)) {
        const { exitCode, envelope, stderr } = answer.fail
        return {
          ok: true as const,
          result: { exitCode, envelope: envelope ?? null, stderr: stderr ?? '' },
        }
      }
      const envelope =
        typeof answer === 'function' ? answer(request.args) : (answer as RhwpEnvelope)
      return { ok: true as const, result: { exitCode: 0 as const, envelope, stderr: '' } }
    }),
    aiEdit: vi.fn(async (request: AiEditRequest) => {
      edits.push(request)
      return edit(request)
    }),
    createDocument: vi.fn(async () => ({ ok: true, path: 'C:/x/doc.hwpx' })),
  }
  return api as unknown as FakeApi
}

export interface FakeContext extends HwpAiContext {
  dirty: number
}

export function ctxWith(api: HwpAiApi, editor: EditorLike | null = fakeEditor()): FakeContext {
  const ctx: FakeContext = {
    editor: () => editor,
    fileName: () => 'doc.hwp',
    api: () => api,
    stack: new SnapshotStack(),
    markAiDirty: () => {
      ctx.dirty++
    },
    dirty: 0,
  }
  return ctx
}

export const call = (name: string, input: Record<string, unknown> = {}): AgentToolCall => ({
  id: 'call-1',
  name,
  input,
})

export const env = (fields: Record<string, unknown>): RhwpEnvelope => ({
  schemaVersion: '1.0',
  untrustedContent: false,
  untrustedFields: [],
  ...fields,
})
