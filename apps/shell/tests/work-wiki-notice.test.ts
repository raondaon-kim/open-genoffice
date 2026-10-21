import { describe, expect, it, vi } from 'vitest'
import { mirrorNoticeText, showMirrorNoticeOnce } from '../src/main/work-wiki-notice'

describe('the one-time notice about saved copies', () => {
  it('is shown once as an OS notification, then the flag keeps it quiet', () => {
    let shown = false
    const notify = vi.fn()
    const deps = {
      shown: () => shown,
      markShown: () => {
        shown = true
      },
      notify,
      lang: 'ko' as const,
    }
    expect(showMirrorNoticeOnce(deps)).toBe(true)
    expect(showMirrorNoticeOnce(deps)).toBe(false)
    expect(notify).toHaveBeenCalledTimes(1)
    const [title, body] = notify.mock.calls[0]!
    expect(title).toBe(mirrorNoticeText('ko').title)
    expect(body).toContain('genoffice-saved')
  })

  it('a failing notification still marks the notice as shown (it is never retried in a loop)', () => {
    let shown = false
    expect(
      showMirrorNoticeOnce({
        shown: () => shown,
        markShown: () => {
          shown = true
        },
        notify: () => {
          throw new Error('notifications off')
        },
        lang: 'en',
      }),
    ).toBe(false)
    expect(shown).toBe(true)
  })

  it('has Korean, Chinese and English texts; other languages read English', () => {
    expect(mirrorNoticeText('ko').body).not.toBe(mirrorNoticeText('en').body)
    expect(mirrorNoticeText('zh').body).not.toBe(mirrorNoticeText('en').body)
    expect(mirrorNoticeText('fr')).toEqual(mirrorNoticeText('en'))
  })
})
