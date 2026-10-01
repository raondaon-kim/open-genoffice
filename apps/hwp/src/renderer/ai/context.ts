import type { AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'
import type { RhwpEditor } from '@rhwp/editor'
import type { HwpApi } from '../../shared/ipc'
import type { SnapshotStack } from './snapshots'

/** the slice of the studio bridge the tools use — tests pass fakes */
export type EditorLike = Pick<
  RhwpEditor,
  | 'getDocumentState'
  | 'exportHwp'
  | 'exportHwpx'
  | 'loadFile'
  | 'focusTarget'
  | 'commands'
  | 'hwpctrl'
  | 'plugins'
>

/** the slice of the preload API the tools use */
export type HwpAiApi = Pick<HwpApi, 'aiSnapshot' | 'aiQuery' | 'aiEdit' | 'createDocument'>

/** what App hands the AI panel; getters because the agent loop outlives render closures */
export interface HwpAiDeps {
  editor(): RhwpEditor | null
  fileName(): string
  /** an AI edit reloaded the document — the studio's own dirty flag is reset by loadFile */
  markAiDirty(): void
  /** AI undo history + snapshot cache; owned by the app so a panel collapse keeps it */
  stack: SnapshotStack
}

/** what every tool sees */
export interface HwpAiContext {
  editor(): EditorLike | null
  fileName(): string
  api(): HwpAiApi
  stack: SnapshotStack
  markAiDirty(): void
}

export interface ToolModule {
  tools: AgentToolDef[]
  /** may throw ToolError; the skill maps it to an isError execution */
  execute(ctx: HwpAiContext, call: AgentToolCall): Promise<ToolExecution>
}
