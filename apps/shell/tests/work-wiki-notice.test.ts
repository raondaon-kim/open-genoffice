import { describe, expect, it, vi } from 'vitest'
import { mirrorNoticeText, showMirrorNoticeOnce } from '../src/main/work-wiki-notice'

describe('the one-time notice about saved copies', () => {
  it('is shown once, then the flag keeps it quiet', async () => {
    let shown = false
    const notify = vi.fn(async () => {})
    const deps = {
      shown: () => shown,
      markShown: () => {
        shown = true
      },
      notify,
      lang: 'ko' as const,
    }
    expect(await showMirrorNoticeOnce(deps)).toBe(true)
    expect(await showMirrorNoticeOnce(deps)).toBe(false)
    expect(notify).toHaveBeenCalledTimes(1)
    const [title, body] = notify.mock.calls[0] as unknown as [string, string]
    expect(title).toBe(mirrorNoticeText('ko').title)
    expect(body).toContain('genoffice-saved')
  })

  it('a notice that could not be shown is not marked, so it is shown next time', async () => {
    let shown = false
    const markShown = vi.fn(() => {
      shown = true
    })
    expect(
      await showMirrorNoticeOnce({
        shown: () => shown,
        markShown,
        notify: async () => {
          throw new Error('no window')
        },
        lang: 'en',
      }),
    ).toBe(false)
    expect(markShown).not.toHaveBeenCalled()
  })

  it('names the settings pane where the switch is', () => {
    expect(mirrorNoticeText('ko').body).toContain('설정 › AI 미디어 및 검색 › 업무 위키')
    expect(mirrorNoticeText('en').body).toContain('Settings › AI Media & Search › Work wiki')
    expect(mirrorNoticeText('zh').body).toContain('设置 › 生图、媒体与搜索 › 工作维基')
  })

  it('has Korean, Chinese and English texts; other languages read English', () => {
    expect(mirrorNoticeText('ko').body).not.toBe(mirrorNoticeText('en').body)
    expect(mirrorNoticeText('zh').body).not.toBe(mirrorNoticeText('en').body)
    expect(mirrorNoticeText('fr')).toEqual(mirrorNoticeText('en'))
  })
})
