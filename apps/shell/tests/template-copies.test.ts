import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TemplateCopies } from '../src/main/template-copies'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'template-copies-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('TemplateCopies', () => {
  it('remembers which template a working copy came from, across instances', async () => {
    const file = join(dir, 'team-template-copies.json')
    new TemplateCopies(file).remember(join(dir, 'a.docx'), '# 템플릿 (Word)')
    expect(new TemplateCopies(file).lookup(join(dir, 'a.docx'))).toBe('# 템플릿 (Word)')
    expect(new TemplateCopies(file).lookup(join(dir, 'b.docx'))).toBeNull()
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveProperty('version', 1)
  })

  it('follows a save-as to a new path', () => {
    const copies = new TemplateCopies(join(dir, 'c.json'))
    copies.remember(join(dir, 'a.docx'), 'md')
    copies.moved(join(dir, 'a.docx'), join(dir, 'renamed.docx'))
    expect(copies.lookup(join(dir, 'renamed.docx'))).toBe('md')
    expect(copies.lookup(join(dir, 'a.docx'))).toBeNull()
  })

  it('keeps at most 200 entries, dropping the oldest', () => {
    const copies = new TemplateCopies(join(dir, 'd.json'))
    for (let i = 0; i < 205; i++) copies.remember(join(dir, `${i}.docx`), `md${i}`)
    expect(copies.lookup(join(dir, '0.docx'))).toBeNull()
    expect(copies.lookup(join(dir, '204.docx'))).toBe('md204')
  })

  it('an unreadable file starts empty', () => {
    expect(
      new TemplateCopies(join(dir, 'missing', 'x.json')).lookup(join(dir, 'a.docx')),
    ).toBeNull()
  })
})
