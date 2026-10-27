import { describe, expect, it, vi } from 'vitest'
import {
  AI_SETTINGS_CHANGED,
  broadcastAiSettingsChanged,
  followAiSettings,
} from '../src/live-settings'

/**
 * Settings › AI saves the connection for every editor, but Word, PowerPoint and Excel read the
 * settings once when a document opens and send that copy with every request. A document left
 * open across a switch to Codex kept asking LiteLLM ("litellm의 API 키가 설정되지 않았습니다").
 */

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function fakeApi(first: string) {
  let listener: (() => void) | null = null
  let current = first
  const off = vi.fn(() => {
    listener = null
  })
  return {
    api: {
      getAiSettings: vi.fn(async () => current),
      onAiSettingsChanged: (cb: () => void) => {
        listener = cb
        return off
      },
    },
    save(next: string) {
      current = next
      listener?.()
    },
    off,
  }
}

describe('followAiSettings', () => {
  it('reads the settings when it starts', async () => {
    const f = fakeApi('litellm')
    const apply = vi.fn()
    followAiSettings(f.api, apply)
    await flush()
    expect(apply).toHaveBeenLastCalledWith('litellm')
  })

  it('reads them again when Settings saves', async () => {
    const f = fakeApi('litellm')
    const apply = vi.fn()
    followAiSettings(f.api, apply)
    await flush()
    f.save('codex')
    await flush()
    expect(apply).toHaveBeenLastCalledWith('codex')
  })

  it('stops following and ignores a read still in flight', async () => {
    const f = fakeApi('litellm')
    const apply = vi.fn()
    const stop = followAiSettings(f.api, apply)
    stop()
    await flush()
    expect(apply).not.toHaveBeenCalled()
    expect(f.off).toHaveBeenCalledTimes(1)
  })

  it('works with a preload that has no change signal', async () => {
    const apply = vi.fn()
    followAiSettings({ getAiSettings: async () => 'litellm' }, apply)
    await flush()
    expect(apply).toHaveBeenCalledWith('litellm')
  })

  it('a later read wins over an earlier one that resolves last', async () => {
    let resolveFirst!: (v: string) => void
    const reads = [
      new Promise<string>((r) => {
        resolveFirst = r
      }),
      Promise.resolve('codex'),
    ]
    let listener: () => void = () => {}
    const apply = vi.fn()
    followAiSettings(
      {
        getAiSettings: () => reads.shift()!,
        onAiSettingsChanged: (cb) => {
          listener = cb
          return () => {}
        },
      },
      apply,
    )
    listener()
    await flush()
    resolveFirst('litellm')
    await flush()
    expect(apply).toHaveBeenLastCalledWith('codex')
    expect(apply).not.toHaveBeenCalledWith('litellm')
  })
})

describe('broadcastAiSettingsChanged', () => {
  it('signals every live window without sending the settings', () => {
    const a = { isDestroyed: () => false, send: vi.fn() }
    const gone = { isDestroyed: () => true, send: vi.fn() }
    expect(broadcastAiSettingsChanged([a, gone])).toBe(1)
    expect(a.send).toHaveBeenCalledWith(AI_SETTINGS_CHANGED)
    expect(a.send.mock.calls[0]).toHaveLength(1)
    expect(gone.send).not.toHaveBeenCalled()
  })

  it('a window that fails to receive does not stop the others', () => {
    const bad = {
      isDestroyed: () => false,
      send: vi.fn(() => {
        throw new Error('render frame disposed')
      }),
    }
    const good = { isDestroyed: () => false, send: vi.fn() }
    expect(broadcastAiSettingsChanged([bad, good])).toBe(1)
    expect(good.send).toHaveBeenCalledTimes(1)
  })
})
