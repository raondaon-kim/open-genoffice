import { randomUUID } from 'node:crypto'

/**
 * A long styled document written in stages: the assistant sends the cover and contents, then one
 * chapter per call (done: false), and the last call (done: true) builds the whole document once.
 * The drafts live here in main until then; nothing is written or opened before the last call.
 */

export interface DraftBlock {
  role: string
  text: string
}

interface Draft {
  style: string
  blocks: DraftBlock[]
  touched: number
}

export const MAX_DRAFT_BLOCKS = 1500
const MAX_DRAFTS = 4
const DRAFT_TTL_MS = 2 * 60 * 60 * 1000

export class StyledDrafts {
  private readonly drafts = new Map<string, Draft>()
  constructor(private readonly now: () => number = Date.now) {}

  private prune(): void {
    const t = this.now()
    for (const [id, d] of this.drafts) if (t - d.touched > DRAFT_TTL_MS) this.drafts.delete(id)
    while (this.drafts.size > MAX_DRAFTS) {
      const oldest = [...this.drafts.entries()].sort((a, b) => a[1].touched - b[1].touched)[0]
      if (!oldest) break
      this.drafts.delete(oldest[0])
    }
  }

  /**
   * Add a stage. Without a draft id a new draft starts. Returns the blocks so far, or an error
   * (unknown or expired draft, a different style, too many blocks).
   */
  add(
    style: string,
    blocks: DraftBlock[],
    draftId?: string,
  ): { ok: true; draftId: string; blocks: DraftBlock[] } | { ok: false; error: string } {
    this.prune()
    let id = draftId
    let draft = id ? this.drafts.get(id) : undefined
    if (id && !draft) {
      return { ok: false, error: `unknown or expired draft "${id}" — start again without draft_id` }
    }
    if (draft && draft.style !== style) {
      return { ok: false, error: `draft "${id}" uses style "${draft.style}", not "${style}"` }
    }
    const total = (draft?.blocks.length ?? 0) + blocks.length
    if (total > MAX_DRAFT_BLOCKS) {
      return { ok: false, error: `at most ${MAX_DRAFT_BLOCKS} blocks per document (got ${total})` }
    }
    if (!draft) {
      id = randomUUID().slice(0, 8)
      draft = { style, blocks: [], touched: this.now() }
      this.drafts.set(id, draft)
      this.prune()
    }
    draft.blocks.push(...blocks)
    draft.touched = this.now()
    return { ok: true, draftId: id!, blocks: draft.blocks }
  }

  /** the whole draft, removed (the last stage builds it) */
  take(draftId: string): DraftBlock[] | undefined {
    const d = this.drafts.get(draftId)
    this.drafts.delete(draftId)
    return d?.blocks
  }

  drop(draftId: string): void {
    this.drafts.delete(draftId)
  }
}
