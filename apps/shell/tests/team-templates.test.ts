import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TeamLibrary } from '../src/main/team-library'
import { TeamTemplates } from '../src/main/team-templates'
import type { TeamFolders } from '../src/shared/team-library-api'
import { makeDocx, ODA_BLOCKS } from '../../../packages/team-templates/tests/fixtures'

let dir: string
let tpl: string
let docs: string
let drafts: string
let cache: string

/** the AI stand-in: generalizes the one project heading and labels the cover */
const complete = async (_system: string, user: string): Promise<string> => {
  const representative = user.split('### 문서 1 (대표)')[1]!.split(/\n### |\n## /)[0]!
  const first = [...representative.matchAll(/^\s*- \(\d\) (.+)$/gm)].map((m) => m[1]!)
  return JSON.stringify({
    title: 'KOICA ODA 기술제안서',
    purpose: 'KOICA 용역 입찰의 기술제안서 본문',
    materials: ['제안요청서', '회사소개서'],
    wikiPages: ['methods/pmc'],
    headings: first.map((h) => h.replace('과업대상지 분석', '사업대상지 분석')),
    guidance: first.map((h) => `${h.replace(/^[^ ]+ /, '')} 내용을 글머리로`),
    coverLabels: ['사업명', '발주기관'],
    headerFooter: {},
  })
}

function service(overrides: Partial<ConstructorParameters<typeof TeamTemplates>[0]> = {}) {
  const folders: TeamFolders = {
    templates: tpl,
    documents: docs,
    memberName: '공용',
    autoSync: true,
  }
  const library = new TeamLibrary(
    () => folders,
    () => {},
    () => drafts,
  )
  return new TeamTemplates({
    library,
    memberName: () => '공용',
    complete,
    wikiCatalog: async () => '- PMC 제안서 목차 구성 방식 (methods/pmc)',
    cacheDir: cache,
    draftsDir: drafts,
    minDocs: () => 1,
    now: () => new Date('2026-10-28T06:20:00Z'),
    ...overrides,
  })
}

async function putDoc(rel: string, blocks = ODA_BLOCKS) {
  const path = join(docs, ...rel.split('/'))
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, await makeDocx(blocks))
}

async function makeSet(svc = service()) {
  const [candidate] = await svc.candidates()
  const draft = await svc.draft({ candidateKey: candidate!.key })
  return { draft, set: await svc.confirm(draft.draftId, draft.markdown) }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'team-templates-'))
  tpl = join(dir, 'Templates')
  docs = join(dir, 'Documents')
  drafts = join(dir, 'drafts')
  cache = join(dir, 'cache')
  await Promise.all([mkdir(tpl), mkdir(docs), mkdir(drafts), mkdir(cache)])
  await putDoc('P/공용/Word/oda.docx')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('TeamTemplates', () => {
  it('confirm writes a set and an index line', async () => {
    const { set } = await makeSet()
    expect(set.path).toBe('Word/KOICA ODA 기술제안서/')
    const files = (await readdir(join(tpl, 'Word', 'KOICA ODA 기술제안서'))).sort()
    expect(files).toEqual(['form.docx', 'template.md'])
    const index = await readFile(join(tpl, 'index.md'), 'utf8')
    expect(index).toContain(
      '- [KOICA ODA 기술제안서](<Word/KOICA ODA 기술제안서/>) — KOICA 용역 입찰의 기술제안서 본문 · 확정 · ',
    )
    expect((await readdir(tpl)).some((n) => n.endsWith('.tmp'))).toBe(false)
    const md = await readFile(join(tpl, 'Word', 'KOICA ODA 기술제안서', 'template.md'), 'utf8')
    expect(md).toContain('- 1-2. 사업대상지 분석')
    expect(md).toContain('- 상태: 확정 · 2026-10-28 · 공용')
    expect(md).not.toContain('자카르타')
  })

  it('listing trusts the index and does not read the sets', async () => {
    await makeSet()
    await writeFile(join(tpl, 'Word', 'KOICA ODA 기술제안서', 'template.md'), 'broken')
    const list = await service().list()
    expect(list.sets.map((s) => s.title)).toEqual(['KOICA ODA 기술제안서'])
    expect(list.repaired).toBe(false)
  })

  it('a lost index update is repaired from the kind folders', async () => {
    const svc = service()
    await makeSet(svc)
    const before = await readFile(join(tpl, 'index.md'), 'utf8')
    await putDoc('Q/공용/Word/report.docx', [
      { text: '1. 개요', style: 'Heading1' },
      { text: '본문 하나' },
      { text: '2. 결과', style: 'Heading1' },
      { text: '본문 둘' },
    ])
    const candidates = await svc.candidates()
    const other = candidates.find((c) => !c.coveredBy)!
    const draft = await svc.draft({ candidateKey: other.key })
    await svc.confirm(
      draft.draftId,
      draft.markdown.replace('# KOICA ODA 기술제안서', '# 결과 보고서'),
    )
    // another PC wrote its older index over ours
    await writeFile(join(tpl, 'index.md'), before)
    const list = await svc.list()
    expect(list.sets.map((s) => s.title).sort()).toEqual(['KOICA ODA 기술제안서', '결과 보고서'])
    expect(list.repaired).toBe(true)
    expect(await readFile(join(tpl, 'index.md'), 'utf8')).toContain('결과 보고서')
  })

  it('a renamed set folder is repaired without touching its files', async () => {
    await makeSet()
    await rename(join(tpl, 'Word', 'KOICA ODA 기술제안서'), join(tpl, 'Word', 'ODA'))
    const list = await service().list()
    expect(list.sets.map((s) => s.path)).toEqual(['Word/ODA/'])
    expect(await readFile(join(tpl, 'Word', 'ODA', 'template.md'), 'utf8')).toContain('# KOICA ODA')
  })

  it('a read-only member repairs in memory only', async () => {
    await makeSet()
    await rename(join(tpl, 'Word', 'KOICA ODA 기술제안서'), join(tpl, 'Word', 'ODA'))
    const before = await readFile(join(tpl, 'index.md'), 'utf8')
    const list = await service({ canWrite: async () => false }).list()
    expect(list.writable).toBe(false)
    expect(list.sets.map((s) => s.path)).toEqual(['Word/ODA/'])
    expect(await readFile(join(tpl, 'index.md'), 'utf8')).toBe(before)
  })

  it('the source-words gate blocks confirmation and writes nothing', async () => {
    const svc = service()
    const [candidate] = await svc.candidates()
    const draft = await svc.draft({ candidateKey: candidate!.key })
    const edited = draft.markdown.replace(
      '- 용도: ',
      '- 용도: 자카르타 보건소 인력은 2,300명으로 집계되었다 ',
    )
    await expect(svc.confirm(draft.draftId, edited)).rejects.toMatchObject({ code: 'source-words' })
    expect(await readdir(tpl)).toEqual([])
  })

  it('다시 만들기 refuses when the set changed meanwhile', async () => {
    const svc = service()
    const { set } = await makeSet(svc)
    const [candidate] = await svc.candidates()
    const again = await svc.draft({ candidateKey: candidate!.key }, set.path)
    expect(again.replaces).toBe(set.path)
    const mdPath = join(tpl, 'Word', 'KOICA ODA 기술제안서', 'template.md')
    await writeFile(mdPath, `${await readFile(mdPath, 'utf8')}\n`)
    await expect(svc.confirm(again.draftId, again.markdown)).rejects.toMatchObject({
      code: 'changed',
    })
  })

  it('다시 만들기 replaces the files of the same set', async () => {
    const svc = service()
    const { set } = await makeSet(svc)
    const [candidate] = await svc.candidates()
    const again = await svc.draft({ candidateKey: candidate!.key }, set.path)
    const replaced = await svc.confirm(
      again.draftId,
      again.markdown.replace('내용을 글머리로', '내용을 표로'),
    )
    expect(replaced.path).toBe(set.path)
    expect(await readdir(join(tpl, 'Word'))).toEqual(['KOICA ODA 기술제안서'])
    expect(
      await readFile(join(tpl, 'Word', 'KOICA ODA 기술제안서', 'template.md'), 'utf8'),
    ).toContain('내용을 표로')
  })

  it('remove deletes the folder and the index line', async () => {
    const svc = service()
    const { set } = await makeSet(svc)
    await svc.remove(set.path)
    expect(await readdir(join(tpl, 'Word'))).toEqual([])
    expect(await readFile(join(tpl, 'index.md'), 'utf8')).not.toContain('KOICA')
  })

  it('openSet makes a local copy, returns the md and flags a changed form', async () => {
    const svc = service()
    const { set } = await makeSet(svc)
    const opened = await svc.openSet(set.path)
    expect(opened.workingCopy.startsWith(drafts)).toBe(true)
    expect(opened.templateMd).toContain('## 목차')
    expect(opened.status).toBe('ok')
    await writeFile(
      join(tpl, 'Word', 'KOICA ODA 기술제안서', 'form.docx'),
      await makeDocx(ODA_BLOCKS),
    )
    expect((await svc.openSet(set.path)).status).toBe('stale-md')
  })

  it('opening a set whose folder is gone reports it and repairs the list', async () => {
    const svc = service()
    const { set } = await makeSet(svc)
    await rm(join(tpl, 'Word', 'KOICA ODA 기술제안서'), { recursive: true })
    await expect(svc.openSet(set.path)).rejects.toMatchObject({ code: 'moved' })
    expect((await svc.list()).sets).toEqual([])
  })

  it('candidates skip pdf and hwp and mark a covered form', async () => {
    await writeFile(join(docs, 'P', '공용', 'Word', 'note.pdf'), 'x')
    const svc = service()
    await makeSet(svc)
    // a filled copy of the template is saved back by the team sync
    const opened = await svc.openSet('Word/KOICA ODA 기술제안서/')
    await mkdir(join(docs, 'R', '공용', 'Word'), { recursive: true })
    await writeFile(
      join(docs, 'R', '공용', 'Word', 'filled.docx'),
      await readFile(opened.workingCopy),
    )
    const candidates = await svc.candidates()
    expect(candidates.every((c) => c.docs.every((d) => d.name.endsWith('.docx')))).toBe(true)
    expect(candidates.every((c) => c.coveredBy === 'Word/KOICA ODA 기술제안서/')).toBe(true)
  })

  it('loose files of the 0.5.7 layout are listed', async () => {
    await mkdir(join(tpl, 'Word'))
    await writeFile(join(tpl, 'Word', '옛 양식.docx'), await makeDocx(ODA_BLOCKS))
    const list = await service().list()
    expect(list.loose.map((l) => l.id)).toEqual(['Word/옛 양식.docx'])
  })
})

describe('TeamTemplates.openSet into a home folder', () => {
  it('puts the copy beside the user files with a unique name', async () => {
    const svc = service()
    const { set } = await makeSet(svc)
    const home = join(dir, 'home')
    await mkdir(home)
    const first = await svc.openSet(set.path, home)
    const second = await svc.openSet(set.path, home)
    expect(first.workingCopy).toBe(join(home, 'KOICA ODA 기술제안서.docx'))
    expect(second.workingCopy).toBe(join(home, 'KOICA ODA 기술제안서 (2).docx'))
  })
})

describe('TeamTemplates.indexText', () => {
  it('is the repaired index.md, or null when templates are not set up', async () => {
    const svc = service()
    await makeSet(svc)
    expect(await svc.indexText()).toContain(
      '- [KOICA ODA 기술제안서](<Word/KOICA ODA 기술제안서/>)',
    )
    const unset = new TeamTemplates({
      library: new TeamLibrary(
        () => ({ templates: '', documents: '', memberName: 'x', autoSync: true }),
        () => {},
        () => drafts,
      ),
      memberName: () => 'x',
      complete,
      wikiCatalog: async () => '',
      cacheDir: cache,
      draftsDir: drafts,
      minDocs: () => 1,
    })
    expect(await unset.indexText()).toBeNull()
  })
})

describe('TeamTemplates source-words gate scope', () => {
  it('wiki page ids are not source words', async () => {
    const svc = service()
    const [candidate] = await svc.candidates()
    const draft = await svc.draft({ candidateKey: candidate!.key })
    const edited = draft.markdown.replace(
      /- 참고할 업무 위키: .*/,
      '- 참고할 업무 위키: methods/자카르타-보건소-인력은-집계',
    )
    await expect(svc.confirm(draft.draftId, edited)).resolves.toMatchObject({ kind: 'Word' })
  })
})

describe('TeamTemplates source-words detail', () => {
  it('names every offending line at once', async () => {
    const svc = service()
    const [candidate] = await svc.candidates()
    const draft = await svc.draft({ candidateKey: candidate!.key })
    const edited = draft.markdown
      .replace('- 용도: ', '- 용도: 자카르타 보건소 인력은 2,300명으로 ')
      .replace('- 필요한 자료: ', '- 필요한 자료: 서울특별시 중구 세종대로 110, ')
    await expect(svc.confirm(draft.draftId, edited)).rejects.toMatchObject({
      code: 'source-words',
      detail: expect.stringMatching(/자카르타[\s\S]*\n[\s\S]*세종대로/),
    })
  })
})

describe('review fixes (shell)', () => {
  it('a read-only templates folder is found before the AI draft and the list hides writes', async () => {
    let asked = 0
    const svc = service({
      probe: async () => false,
      complete: async (s, u) => {
        asked++
        return complete(s, u)
      },
    })
    const [candidate] = await svc.candidates()
    await expect(svc.draft({ candidateKey: candidate!.key })).rejects.toMatchObject({
      code: 'permission',
    })
    expect(asked).toBe(0)
    expect((await svc.list()).writable).toBe(false)
  })

  it('a set whose md does not parse is listed as broken; a changed form as stale after opening', async () => {
    const svc = service()
    const { set } = await makeSet(svc)
    await mkdir(join(tpl, 'Word', '깨짐'))
    await writeFile(join(tpl, 'Word', '깨짐', 'template.md'), '# 아무거나')
    await writeFile(join(tpl, 'Word', '깨짐', 'form.docx'), 'x')
    expect((await svc.list()).sets.find((s) => s.path === 'Word/깨짐/')!.status).toBe('broken')
    await writeFile(
      join(tpl, 'Word', 'KOICA ODA 기술제안서', 'form.docx'),
      await makeDocx(ODA_BLOCKS),
    )
    expect((await svc.openSet(set.path)).status).toBe('stale-md')
    expect((await svc.list()).sets.find((s) => s.path === set.path)!.status).toBe('stale-md')
  })

  it('a filled copy with an extra chapter and tables still counts as covered', async () => {
    const svc = service()
    const { set } = await makeSet(svc)
    const md = await readFile(join(tpl, 'Word', 'KOICA ODA 기술제안서', 'template.md'), 'utf8')
    const headings = [
      ...md
        .split('## 목차')[1]!
        .split('```')[0]!
        .matchAll(/^( *)- (.+?)(?: — .*)?$/gm),
    ].map((m) => ({ level: m[1]!.length / 2 + 1, text: m[2]! }))
    await mkdir(join(docs, 'R', '공용', 'Word'), { recursive: true })
    await writeFile(
      join(docs, 'R', '공용', 'Word', 'filled.docx'),
      await makeDocx([
        { text: '르완다 사업', style: 'Title' },
        ...headings.flatMap((h) => [
          { text: h.text, style: `Heading${h.level}` },
          { text: '채운 본문' },
          {
            table: [
              ['열1', '열2'],
              ['a', 'b'],
            ],
          },
        ]),
        { text: '확인 필요 사항', style: 'Heading1' },
        { text: '남은 항목' },
      ]),
    )
    // the source document is gone: coverage must not rest on grouping with it
    await rm(join(docs, 'P'), { recursive: true })
    const candidates = await svc.candidates()
    const filled = candidates.find((c) => c.docs.some((d) => d.name === 'filled.docx'))!
    expect(filled.coveredBy).toBe(set.path)
  })
})

describe('NAS safety: confirm, remake and delete', () => {
  const realIo = () => import('node:fs/promises')

  it('a confirm that fails while writing leaves no half-made set and no staging folder', async () => {
    const fs = await realIo()
    let writes = 0
    const svc = service({
      io: {
        ...fs,
        writeFile: (async (...args: Parameters<typeof fs.writeFile>) => {
          // the second file of the set fails
          if (String(args[0]).endsWith('template.md') && ++writes === 1)
            throw new Error('NAS dropped')
          return fs.writeFile(...args)
        }) as typeof fs.writeFile,
      },
    })
    const [candidate] = await svc.candidates()
    const draft = await svc.draft({ candidateKey: candidate!.key })
    await expect(svc.confirm(draft.draftId, draft.markdown)).rejects.toThrow()
    const word = await readdir(join(tpl, 'Word')).catch(() => [] as string[])
    expect(word).toEqual([])
    // a retry works and takes the plain name
    const set = await svc.confirm(draft.draftId, draft.markdown)
    expect(set.path).toBe('Word/KOICA ODA 기술제안서/')
  })

  it('two sets with the same title get distinct folders', async () => {
    const svc = service()
    await makeSet(svc)
    const [candidate] = await svc.candidates()
    const again = await svc.draft({ candidateKey: candidate!.key })
    const second = await svc.confirm(again.draftId, again.markdown)
    expect(second.path).toBe('Word/KOICA ODA 기술제안서 (2)/')
  })

  it('a 다시 만들기 that fails half way keeps the old set intact', async () => {
    const fs = await realIo()
    const svc0 = service()
    const { set } = await makeSet(svc0)
    const folder = join(tpl, 'Word', 'KOICA ODA 기술제안서')
    const oldMd = await readFile(join(folder, 'template.md'), 'utf8')
    const oldForm = await readFile(join(folder, 'form.docx'))
    let renames = 0
    const svc = service({
      io: {
        ...fs,
        rename: (async (from: string, to: string) => {
          // the new md cannot be moved into place
          if (
            to.endsWith('template.md') &&
            String(from).includes('.genoffice-') &&
            ++renames === 1
          ) {
            throw new Error('NAS dropped')
          }
          return fs.rename(from, to)
        }) as typeof fs.rename,
      },
    })
    const [candidate] = await svc.candidates()
    const again = await svc.draft({ candidateKey: candidate!.key }, set.path)
    await expect(
      svc.confirm(again.draftId, again.markdown.replace('내용을 글머리로', '내용을 표로')),
    ).rejects.toThrow()
    expect(await readFile(join(folder, 'template.md'), 'utf8')).toBe(oldMd)
    expect(Buffer.compare(await readFile(join(folder, 'form.docx')), oldForm)).toBe(0)
    expect((await readdir(folder)).sort()).toEqual(['form.docx', 'template.md'])
  })

  it('delete removes only the template files and keeps a folder that holds other files', async () => {
    const svc = service()
    const { set } = await makeSet(svc)
    const folder = join(tpl, 'Word', 'KOICA ODA 기술제안서')
    await writeFile(join(folder, '메모.txt'), '팀원이 둔 파일')
    await expect(svc.remove(set.path)).resolves.toEqual({ keptFolder: true })
    expect(await readdir(folder)).toEqual(['메모.txt'])
    expect(await readFile(join(tpl, 'index.md'), 'utf8')).not.toContain('KOICA')
  })

  it('delete refuses a folder that is not a template set', async () => {
    const svc = service()
    await mkdir(join(tpl, 'Word', '다른 폴더'), { recursive: true })
    await writeFile(join(tpl, 'Word', '다른 폴더', '자료.docx'), 'x')
    await expect(svc.remove('Word/다른 폴더/')).rejects.toMatchObject({ code: 'invalid-path' })
    expect(await readdir(join(tpl, 'Word', '다른 폴더'))).toEqual(['자료.docx'])
  })
})

describe('listing depth and cost', () => {
  it('목록 다시 만들기 finds loose files deep in plain folders; the list keeps them', async () => {
    const svc = service()
    await mkdir(join(tpl, 'Word', 'a', 'b', 'c'), { recursive: true })
    await writeFile(join(tpl, 'Word', 'a', 'b', 'c', '깊은 양식.docx'), await makeDocx(ODA_BLOCKS))
    expect((await svc.list()).loose.map((l) => l.id)).not.toContain('Word/a/b/c/깊은 양식.docx')
    expect((await svc.rebuildIndex()).loose.map((l) => l.id)).toContain('Word/a/b/c/깊은 양식.docx')
    expect((await svc.list()).loose.map((l) => l.id)).toContain('Word/a/b/c/깊은 양식.docx')
  })

  it('a listing takes loose file sizes from index.md instead of asking the NAS again', async () => {
    const svc = service()
    await mkdir(join(tpl, 'Word'))
    const file = join(tpl, 'Word', '옛 양식.docx')
    await writeFile(file, 'x'.repeat(100))
    expect((await svc.list()).loose[0]!.sizeBytes).toBe(100)
    await writeFile(file, 'x'.repeat(250))
    expect((await svc.list()).loose[0]!.sizeBytes).toBe(100)
    expect((await svc.rebuildIndex()).loose[0]!.sizeBytes).toBe(250)
  })
})
