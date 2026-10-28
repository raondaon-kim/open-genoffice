import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (f: string) => readFileSync(join(__dirname, '..', 'src', f), 'utf8')

describe('the browser-safe entry', () => {
  it('re-exports only modules without Node or zip imports', () => {
    const entry = src('md.ts')
    const files = [...entry.matchAll(/from '\.\/([\w-]+)'/g)].map((m) => `${m[1]}.ts`)
    expect(files.sort()).toEqual(['index-md.ts', 'normalize.ts', 'run-view.ts', 'template-md.ts'])
    for (const f of files)
      expect(src(f)).not.toMatch(
        /from 'node:|from 'jszip'|from '\.\/(xml|form|signature|measure|docx-outline)'/,
      )
  })

  it('is published as @genoffice/team-templates/md', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
    expect(pkg.exports['./md']).toBe('./src/md.ts')
  })
})
