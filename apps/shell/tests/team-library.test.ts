import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  TeamLibrary,
  TeamLibraryError,
  teamFolderName,
  teamProjectName,
  localTeamDocuments,
  teamResult,
} from '../src/main/team-library'
import type { TeamFolders } from '../src/shared/team-library-api'

let root: string
let folders: TeamFolders
let library: TeamLibrary

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'team-library-'))
  folders = {
    templates: join(root, 'templates'),
    documents: join(root, 'documents'),
    memberName: '김민수',
    autoSync: true,
  }
  await Promise.all([mkdir(folders.templates), mkdir(folders.documents)])
  library = new TeamLibrary(
    () => folders,
    (next) => {
      folders = next
    },
    () => join(root, 'local'),
    // structural tests use text stand-ins for documents; masking has its own tests below
    async (_name, bytes) => ({ ok: true, bytes, counts: {} }),
  )
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('team library', () => {
  it('validates distinct existing folders without creating missing NAS directories', async () => {
    await expect(library.configure(folders)).resolves.toEqual(folders)
    await expect(
      library.configure({ ...folders, documents: folders.templates }),
    ).rejects.toBeInstanceOf(TeamLibraryError)
    await mkdir(join(folders.templates, 'nested'))
    await expect(
      library.configure({ ...folders, documents: join(folders.templates, 'nested') }),
    ).rejects.toBeInstanceOf(TeamLibraryError)
    await expect(
      library.configure({ ...folders, templates: 'relative/path' }),
    ).rejects.toBeInstanceOf(TeamLibraryError)
    await expect(library.configure({ ...folders, memberName: '' })).rejects.toBeInstanceOf(
      TeamLibraryError,
    )
  })

  it('lists categorized templates, skipping temporary files and unsupported types', async () => {
    const category = join(folders.templates, 'Word')
    await mkdir(category)
    await mkdir(join(folders.templates, 'Network Trashes Folder'))
    await writeFile(join(folders.templates, 'Network Trashes Folder', 'deleted.docx'), 'deleted')
    await Promise.all([
      writeFile(join(category, '공문.docx'), 'template'),
      writeFile(join(category, '~$공문.docx'), 'lock'),
      writeFile(join(category, 'reference.pdf'), 'pdf'),
      writeFile(join(category, 'run.exe'), 'exe'),
      writeFile(join(category, '.partial.docx'), 'partial'),
    ])
    const list = await library.list('templates')
    expect(list.partial).toBe(false)
    expect(list.entries.map((entry) => entry.id)).toEqual(['Word/공문.docx'])
  })

  it('creates independent local copies and leaves the original unchanged', async () => {
    await writeFile(join(folders.templates, '양식.hwpx'), 'original')
    const first = await library.createWorkingCopy('templates', '양식.hwpx')
    const second = await library.createWorkingCopy('templates', '양식.hwpx')
    expect(first).not.toBe(second)
    await writeFile(first, 'edited')
    expect(await readFile(join(folders.templates, '양식.hwpx'), 'utf8')).toBe('original')
    expect(await readFile(second, 'utf8')).toBe('original')
  })

  it('rejects traversal and linked folders outside the shared root', async () => {
    await writeFile(join(root, 'outside.docx'), 'private')
    for (const id of [
      '../outside.docx',
      '/outside.docx',
      '..\\outside.docx',
      'C:/outside.docx',
      'Word/../outside.docx',
    ]) {
      await expect(library.resolveEntry('templates', id)).rejects.toBeInstanceOf(TeamLibraryError)
    }
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.docx'), 'secret')
    await symlink(
      outside,
      join(folders.templates, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(library.resolveEntry('templates', 'linked/secret.docx')).rejects.toBeInstanceOf(
      TeamLibraryError,
    )
    expect((await library.list('templates')).entries).toEqual([])
  })

  it('registers simultaneous same-name templates without replacing either file', async () => {
    const first = join(root, 'first')
    const second = join(root, 'second')
    await Promise.all([mkdir(first), mkdir(second)])
    await Promise.all([
      writeFile(join(first, '양식.docx'), 'one'),
      writeFile(join(second, '양식.docx'), 'two'),
    ])
    const results = await Promise.all([
      library.publish('templates', join(first, '양식.docx')),
      library.publish('templates', join(second, '양식.docx')),
    ])
    expect(new Set(results.map((entry) => entry.id)).size).toBe(2)
    expect(
      new Set(
        await Promise.all(
          results.map((entry) => readFile(join(folders.templates, entry.id), 'utf8')),
        ),
      ),
    ).toEqual(new Set(['one', 'two']))
    expect(
      (await readdir(join(folders.templates, 'Word'))).every((name) => !name.startsWith('.')),
    ).toBe(true)
  })

  it('groups uploads by project, member and document type and updates only the same document', async () => {
    const source = join(root, '제안발표.pptx')
    await writeFile(source, 'v1')
    const first = await library.syncDocument(source, '사업제안', '김민수', '0123456789abcdef')
    expect(first).toContain(join('사업제안', '김민수', 'PowerPoint'))
    await writeFile(source, 'v2')
    expect(await library.syncDocument(source, '사업제안', '김민수', '0123456789abcdef')).toBe(first)
    expect(await readFile(first, 'utf8')).toBe('v2')
    const other = await library.syncDocument(source, '사업제안', '김민수', 'fedcba9876543210')
    expect(other).not.toBe(first)
    expect(
      (await readdir(join(folders.documents, '사업제안', '김민수', 'PowerPoint'))).length,
    ).toBe(2)
  })

  it('does not create directories through a linked project folder', async () => {
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(
      outside,
      join(folders.documents, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const source = join(root, 'doc.docx')
    await writeFile(source, 'doc')
    await expect(
      library.syncDocument(source, 'linked', '김민수', '0123456789abcdef'),
    ).rejects.toBeInstanceOf(TeamLibraryError)
    expect(await readdir(outside)).toEqual([])
  })

  it('reports disconnected and permission errors distinctly', async () => {
    folders = { ...folders, templates: '' }
    expect(await teamResult(() => library.list('templates'))).toEqual({
      ok: false,
      error: 'not-configured',
    })
    expect(
      await teamResult(async () => {
        throw Object.assign(new Error(), { code: 'EACCES' })
      }),
    ).toEqual({ ok: false, error: 'permission' })
    expect(teamFolderName('../팀:문서/')).not.toMatch(/[/:\\]/)
    expect(teamFolderName('CON')).toBe('_CON')
    expect(teamFolderName('Network Trashes Folder')).toBe('_Network Trashes Folder')
  })
})

describe('home folders as projects', () => {
  it('names the project after the innermost home folder holding the document', () => {
    const roots = [
      join(root, 'GenOffice'),
      join(root, 'GenOffice', 'KOICA 제안'),
      join(root, '외부'),
    ]
    expect(teamProjectName(join(root, 'GenOffice', 'KOICA 제안', 'a', '보고서.docx'), roots)).toBe(
      'KOICA 제안',
    )
    expect(teamProjectName(join(root, 'GenOffice', '메모.docx'), roots)).toBe('GenOffice')
    expect(teamProjectName(join(root, '외부', 'x.xlsx'), roots)).toBe('외부')
    expect(teamProjectName(join(root, 'elsewhere', 'x.xlsx'), roots)).toBe('Default')
    // a sibling whose name only starts with a root's name is not inside it
    expect(teamProjectName(join(root, '외부2', 'x.xlsx'), roots)).toBe('Default')
  })

  it('creates a working copy inside a chosen folder without replacing a file there', async () => {
    await writeFile(join(folders.templates, '양식.hwpx'), 'template')
    const target = join(root, 'my-folder')
    await mkdir(target)
    await writeFile(join(target, '양식.hwpx'), 'mine')
    const copy = await library.createWorkingCopy('templates', '양식.hwpx', target)
    expect(copy).toBe(join(target, '양식 (2).hwpx'))
    expect(await readFile(copy, 'utf8')).toBe('template')
    expect(await readFile(join(target, '양식.hwpx'), 'utf8')).toBe('mine')
    expect((await readdir(target)).sort()).toEqual(['양식 (2).hwpx', '양식.hwpx'])
  })

  it('refuses a working-copy folder inside the shared library', async () => {
    await writeFile(join(folders.templates, '양식.hwpx'), 'template')
    await expect(
      library.createWorkingCopy('templates', '양식.hwpx', folders.documents),
    ).rejects.toBeInstanceOf(TeamLibraryError)
  })
})

describe('localTeamDocuments', () => {
  it('finds supported documents under a folder, skipping lock files, hidden files and links', async () => {
    const folder = join(root, 'home')
    await mkdir(join(folder, 'sub', 'deeper'), { recursive: true })
    await Promise.all([
      writeFile(join(folder, '보고서.docx'), 'a'),
      writeFile(join(folder, '~$보고서.docx'), 'lock'),
      writeFile(join(folder, '.hidden.docx'), 'h'),
      writeFile(join(folder, 'notes.md'), 'md'),
      writeFile(join(folder, 'sub', '표.xlsx'), 'b'),
      writeFile(join(folder, 'sub', 'deeper', '양식.hwpx'), 'c'),
    ])
    const found = await localTeamDocuments(folder)
    expect(found.map((p) => p.slice(folder.length + 1).replace(/[\\/]/g, '/')).sort()).toEqual([
      'sub/deeper/양식.hwpx',
      'sub/표.xlsx',
      '보고서.docx',
    ])
  })

  it('stops at the given limit', async () => {
    const folder = join(root, 'many')
    await mkdir(folder)
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => writeFile(join(folder, `${i}.docx`), 'x')),
    )
    expect(await localTeamDocuments(folder, { maxFiles: 3 })).toHaveLength(3)
  })
})

describe('what reaches the NAS is masked', () => {
  const PHONE = '010-1234-5678'
  let real: TeamLibrary
  beforeEach(() => {
    // the production masker (@genoffice/doc-mask)
    real = new TeamLibrary(
      () => folders,
      () => {},
      () => join(root, 'local'),
    )
  })

  async function docx(text: string, extra: Record<string, Uint8Array> = {}): Promise<Buffer> {
    const zip = new JSZip()
    zip.file(
      'word/document.xml',
      `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    )
    for (const [name, data] of Object.entries(extra)) zip.file(name, data)
    return zip.generateAsync({ type: 'nodebuffer' })
  }
  const bodyOf = async (path: string) =>
    (await JSZip.loadAsync(await readFile(path))).file('word/document.xml')!.async('string')

  it('an automatic upload carries the masked copy and leaves the local file alone', async () => {
    const source = join(root, '연락처.docx')
    await writeFile(source, await docx(`담당 ${PHONE}`))
    const remote = await real.syncDocument(source, '제안', '김민수', 'abcdef0123456789')
    expect(await bodyOf(remote)).toContain('[전화번호]')
    expect(await bodyOf(remote)).not.toContain(PHONE)
    expect(await bodyOf(source)).toContain(PHONE)
  })

  it('a registered document is masked, file name included', async () => {
    const source = join(root, `명함 ${PHONE}.docx`)
    await writeFile(source, await docx(PHONE))
    const entry = await real.publish('documents', source, '제안')
    expect(entry.name).toBe('명함 [전화번호].docx')
    expect(await bodyOf(join(folders.documents, ...entry.id.split('/')))).toContain('[전화번호]')
  })

  it('a format that cannot be masked is not sent', async () => {
    const source = join(root, '공문.hwp')
    await writeFile(source, 'binary hwp')
    await expect(
      real.syncDocument(source, '제안', '김민수', 'abcdef0123456789'),
    ).rejects.toMatchObject({
      code: 'not-maskable',
    })
    expect(await readdir(folders.documents)).toEqual([])
  })

  it('a document that cannot be masked completely is not sent and leaves nothing behind', async () => {
    const source = join(root, 'ole.docx')
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
    await writeFile(source, await docx('x', { 'word/embeddings/oleObject1.bin': ole }))
    await expect(
      real.syncDocument(source, '제안', '김민수', 'abcdef0123456789'),
    ).rejects.toMatchObject({
      code: 'masking-failed',
    })
    expect(await readdir(folders.documents)).toEqual([])
  })
})
