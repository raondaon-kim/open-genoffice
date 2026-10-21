/**
 * The pdf AI panel uses the work wiki like Docs, Slides and Hangul: its
 * skill list includes the work wiki skill, and the preload exposes
 * window.workWiki for it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8')

describe('work wiki in the pdf AI panel', () => {
  it('the panel composes the work wiki skill', () => {
    const panel = read('src/renderer/ai/AiPanel.tsx')
    expect(panel).toMatch(/import \{ createWorkWikiSkill \} from '@genoffice\/work-wiki'/)
    expect(panel).toMatch(/composeSkills\([\s\S]*createWorkWikiSkill\(\(\) => window\.workWiki\)/)
  })

  it('the preload exposes window.workWiki', () => {
    const preload = read('src/preload/index.ts')
    expect(preload).toMatch(/exposeInMainWorld\(\s*'workWiki',\s*createWorkWikiPreloadApi\(/)
  })
})
