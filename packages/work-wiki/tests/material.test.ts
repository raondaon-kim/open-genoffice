import { describe, expect, it, vi } from 'vitest'
import { isWikiMaterial, WIKI_MATERIAL_EXTS } from '../src/material'
import { createWorkWikiPreloadApi, WIKI_CHANNELS } from '../src/index'

describe('wiki material contract', () => {
  it('accepts the formats Home’s dialog takes, by extension, any case', () => {
    expect([...WIKI_MATERIAL_EXTS]).toEqual([
      'hwp',
      'hwpx',
      'docx',
      'pptx',
      'xlsx',
      'pdf',
      'md',
      'txt',
    ])
    expect(isWikiMaterial('제안요청서.PDF')).toBe(true)
    expect(isWikiMaterial('a.hwpx')).toBe(true)
    expect(isWikiMaterial('photo.png')).toBe(false)
    expect(isWikiMaterial('data.csv')).toBe(false)
    expect(isWikiMaterial('README')).toBe(false)
  })

  it('the preload API calls the two new channels', async () => {
    const invoke = vi.fn(async () => 'ok')
    const api = createWorkWikiPreloadApi(invoke)
    await api.status()
    await api.addMaterial(['C:/a.pdf'])
    expect(invoke).toHaveBeenCalledWith(WIKI_CHANNELS.status)
    expect(invoke).toHaveBeenCalledWith(WIKI_CHANNELS.addMaterial, ['C:/a.pdf'])
    expect(WIKI_CHANNELS.status).toBe('wiki:status')
    expect(WIKI_CHANNELS.addMaterial).toBe('wiki:add-material')
  })
})
