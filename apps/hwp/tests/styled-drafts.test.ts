import { describe, expect, it } from 'vitest'
import { MAX_DRAFT_BLOCKS, StyledDrafts } from '../src/main/styled-drafts'

const b = (n: number, role = 'chapter') =>
  Array.from({ length: n }, (_, i) => ({ role, text: `${role} ${i + 1}` }))

describe('staged styled documents', () => {
  it('collects stages under one draft and hands the whole document over once', () => {
    const drafts = new StyledDrafts()
    const first = drafts.add('bid-proposal', b(3, 'cover-title'))
    expect(first).toMatchObject({ ok: true })
    const id = (first as { draftId: string }).draftId
    const second = drafts.add('bid-proposal', b(5), id)
    expect(second).toMatchObject({ ok: true, draftId: id })
    expect((second as { blocks: unknown[] }).blocks).toHaveLength(8)
    expect(drafts.take(id)).toHaveLength(8)
    // taken: gone
    expect(drafts.take(id)).toBeUndefined()
  })

  it('refuses an unknown draft, another style, and too many blocks', () => {
    const drafts = new StyledDrafts()
    expect(drafts.add('bid-proposal', b(1), 'nope')).toMatchObject({ ok: false })
    const id = (drafts.add('bid-proposal', b(1)) as { draftId: string }).draftId
    expect(drafts.add('seoul-gian', b(1), id)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/uses style "bid-proposal"/),
    })
    expect(drafts.add('bid-proposal', b(MAX_DRAFT_BLOCKS), id)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/at most 1500 blocks/),
    })
  })

  it('forgets drafts that were abandoned', () => {
    let t = 0
    const drafts = new StyledDrafts(() => t)
    const id = (drafts.add('bid-proposal', b(1)) as { draftId: string }).draftId
    t += 3 * 60 * 60 * 1000
    expect(drafts.add('bid-proposal', b(1), id)).toMatchObject({ ok: false })
  })
})
