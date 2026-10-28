import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, extname, join, relative, sep } from 'node:path'
import { detectSensitive, maskDocument, type MaskOutcome } from '@genoffice/doc-mask'
import {
  buildFormDocx,
  packageTexts,
  draftPrompt,
  groupCandidates,
  headerFooterTexts,
  measureDocxStyle,
  normalizeHeading,
  outlineSignature,
  parseDraft,
  parseIndexMd,
  parseTemplateMd,
  readDocxOutline,
  removeSet,
  renderIndexMd,
  renderTemplateMd,
  setFormHeadings,
  signatureHash,
  similarity,
  sourceContentTexts,
  strictContentTexts,
  validateDocxXml,
  sourceWordsHits,
  upsertSet,
  type CandidateDoc,
  type CandidateGroup,
  type DocxOutline,
  type IndexSet,
  type TemplateDef,
  type TemplateIndex,
} from '@genoffice/team-templates'
import type {
  TeamLibraryEntry,
  TeamTemplateCandidate,
  TeamTemplateDraftView,
  TeamTemplateList,
  TeamTemplateSet,
  TeamTemplateSource,
} from '../shared/team-library-api'
import {
  localTeamDocuments,
  TEAM_TEMPLATE_EXTENSIONS,
  TeamLibrary,
  TeamLibraryError,
  teamFolderName,
} from './team-library'

export interface TeamTemplatesDeps {
  library: TeamLibrary
  memberName(): string
  /** one completion with the configured model */
  complete(system: string, user: string): Promise<string>
  /** the work wiki's catalog text (page ids in parentheses or `id | title` lines) */
  wikiCatalog(): Promise<string>
  /** this PC's cache of outline signatures */
  cacheDir: string
  /** where local working copies of a set's form are made */
  draftsDir: string
  minDocs(): number
  now?(): Date
  /** can this member write to the templates folder (default: fs.access W_OK) */
  canWrite?(dir: string): Promise<boolean>
  /** the write probe run before a draft or a delete (default: create and remove a staged file) */
  probe?(dir: string): Promise<boolean>
  mask?(fileName: string, bytes: Uint8Array): Promise<MaskOutcome>
}

const KINDS = ['Word', 'Hangul', 'PowerPoint', 'Excel']
const INDEX = 'index.md'
const MD = 'template.md'
const FORM = 'form.docx'
const DRAFT_TTL_MS = 60 * 60 * 1000
const MAX_GROUP_DOCS = 5
/** how alike a document's outline must be to a set's to count as that template's form */
const COVERED_SIMILARITY = 0.8

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')
const pad = (n: number) => String(n).padStart(2, '0')
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const minute = (d: Date) => `${day(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
const toId = (root: string, path: string) => relative(root, path).split(sep).join('/')

interface Draft {
  createdAt: number
  form: Uint8Array
  outlines: DocxOutline[]
  /** the source's own form texts: headings and table header rows */
  allowed: string[]
  /** the source's header/footer texts (checked against what the form keeps) */
  headerFooter: string[]
  docHashes: string[]
  replaces?: string
  replacesMdHash?: string
}

interface SigCacheEntry {
  sig: string[]
  certain: boolean
}

/** page ids a work-wiki catalog mentions: `… (folder/page)` or `folder/page | title` */
function wikiIds(catalog: string): Set<string> {
  const ids = new Set<string>()
  for (const line of catalog.split('\n')) {
    const paren = /\(([\p{L}\p{N}_-]+\/[^()\s]+)\)\s*$/u.exec(line)
    if (paren) ids.add(paren[1]!)
    const lead = /^\s*-?\s*([\p{L}\p{N}_-]+\/[^\s|]+)\s*\|/u.exec(line)
    if (lead) ids.add(lead[1]!)
  }
  return ids
}

function outermostJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object in the answer')
  return JSON.parse(text.slice(start, end + 1))
}

/**
 * Team template sets on the NAS: `<kind>/<set>/template.md + form.docx`, catalogued by
 * `index.md`. The NAS is written only by confirm and remove (and by an index repair when the
 * member can write); listing reads index.md and one directory listing per kind folder.
 */
export class TeamTemplates {
  private readonly drafts = new Map<string, Draft>()
  private lastGroups: CandidateGroup[] = []
  private lastDocPaths = new Map<string, string>()
  /** templates roots a write probe found read-only (Windows access() ignores ACLs) */
  private readonly readOnlyRoots = new Set<string>()
  /** what reading a set found: a changed form or an unreadable md */
  private readonly statuses = new Map<string, TeamTemplateSet['status']>()

  constructor(private readonly deps: TeamTemplatesDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private async writable(root: string): Promise<boolean> {
    if (this.readOnlyRoots.has(root)) return false
    if (this.deps.canWrite) return this.deps.canWrite(root)
    try {
      await access(root, constants.W_OK)
      return true
    } catch {
      return false
    }
  }

  /**
   * A real write test: a staged file created and removed. Only user actions that will write run
   * it (a draft, a delete), never a listing; a read-only result is remembered for the list.
   */
  private async requireWritable(root: string): Promise<void> {
    const ok = this.deps.probe
      ? await this.deps.probe(root)
      : await (async () => {
          const staged = join(root, `.genoffice-probe-${randomUUID()}.tmp`)
          try {
            await writeFile(staged, '', { flag: 'wx' })
            await rm(staged, { force: true })
            return true
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return false
            throw error
          }
        })()
    if (!ok) {
      this.readOnlyRoots.add(root)
      throw new TeamLibraryError('permission')
    }
    this.readOnlyRoots.delete(root)
  }

  private async stagedWrite(path: string, data: Uint8Array | string): Promise<void> {
    const staged = join(path, '..', `.genoffice-${randomUUID()}.tmp`)
    try {
      await writeFile(staged, data, { flag: 'wx' })
      await rename(staged, path)
    } finally {
      await rm(staged, { force: true }).catch(() => {})
    }
  }

  // ── index ─────────────────────────────────────────────

  private async readIndex(root: string): Promise<TemplateIndex | null> {
    try {
      return parseIndexMd(await readFile(join(root, INDEX), 'utf8'))
    } catch {
      return null
    }
  }

  private async writeIndex(root: string, index: TemplateIndex): Promise<void> {
    const next = { ...index, updatedAt: minute(this.now()), author: this.deps.memberName() }
    await this.stagedWrite(join(root, INDEX), renderIndexMd(next))
  }

  /** a set's index line from its template.md, or null when the folder is not a set */
  private async setFromFolder(root: string, kind: string, name: string): Promise<IndexSet | null> {
    let text: string
    try {
      text = await readFile(join(root, kind, name, MD), 'utf8')
    } catch {
      return null
    }
    const parsed = parseTemplateMd(text)
    if (!parsed.ok) this.statuses.set(`${kind}/${name}/`, 'broken')
    return {
      title: parsed.ok ? parsed.def.title : name,
      path: `${kind}/${name}/`,
      kind,
      purpose: parsed.ok ? parsed.def.purpose : '',
      hash8: parsed.ok ? parsed.def.formSha256.slice(0, 8) : '00000000',
    }
  }

  private async looseEntry(root: string, path: string): Promise<TeamLibraryEntry> {
    const info = await stat(path)
    return {
      id: toId(root, path),
      name: basename(path),
      ext: extname(path).slice(1).toLowerCase(),
      sizeBytes: info.size,
      mtimeMs: info.mtimeMs,
    }
  }

  /**
   * The index checked against one listing of each kind folder: lines of vanished folders go,
   * folders the index does not know are read and added, loose files are listed.
   */
  private async reconcile(
    root: string,
    full: boolean,
  ): Promise<{ index: TemplateIndex; loose: TeamLibraryEntry[]; repaired: boolean }> {
    const stored = full ? null : await this.readIndex(root)
    const index: TemplateIndex = stored ?? { updatedAt: '', author: '', sets: [], loose: [] }
    let repaired = stored === null
    const known = new Map(index.sets.map((s) => [s.path, s]))
    const sets: IndexSet[] = []
    const loose: TeamLibraryEntry[] = []
    const supported = (name: string) =>
      TEAM_TEMPLATE_EXTENSIONS.includes(extname(name).slice(1).toLowerCase()) &&
      !name.startsWith('~$') &&
      !name.startsWith('.')
    const rootEntries = await readdir(root, { withFileTypes: true })
    for (const e of rootEntries) {
      if (e.isFile() && supported(e.name))
        loose.push(await this.looseEntry(root, join(root, e.name)))
    }
    for (const kind of KINDS) {
      if (!rootEntries.some((e) => e.isDirectory() && e.name === kind)) continue
      const entries = await readdir(join(root, kind), { withFileTypes: true })
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name.toLowerCase() === 'network trashes folder') continue
        if (e.isFile()) {
          if (supported(e.name)) loose.push(await this.looseEntry(root, join(root, kind, e.name)))
          continue
        }
        if (!e.isDirectory()) continue
        const path = `${kind}/${e.name}/`
        const hit = known.get(path)
        if (hit) {
          sets.push(hit)
          continue
        }
        const found = await this.setFromFolder(root, kind, e.name)
        if (found) {
          sets.push(found)
          repaired = true
          continue
        }
        // a plain folder of the 0.5.7 layout: its documents are loose files
        for (const f of await readdir(join(root, kind, e.name), { withFileTypes: true }).catch(
          () => [],
        )) {
          if (f.isFile() && supported(f.name)) {
            loose.push(await this.looseEntry(root, join(root, kind, e.name, f.name)))
          }
        }
      }
    }
    if (sets.length !== index.sets.length) repaired = true
    const looseIds = loose.map((l) => l.id).sort()
    const indexLoose = index.loose.map((l) => l.path).sort()
    if (looseIds.join('\n') !== indexLoose.join('\n')) repaired = true
    return {
      index: {
        ...index,
        sets,
        loose: loose.map((l) => ({ name: l.name, path: l.id })),
      },
      loose,
      repaired,
    }
  }

  private view(s: IndexSet): TeamTemplateSet {
    return {
      path: s.path,
      title: s.title,
      kind: s.kind,
      purpose: s.purpose,
      status: this.statuses.get(s.path) ?? 'ok',
      hash8: s.hash8,
    }
  }

  private async listing(full: boolean): Promise<TeamTemplateList> {
    const root = await this.deps.library.root('templates')
    const writable = await this.writable(root)
    const { index, loose, repaired } = await this.reconcile(root, full)
    if (repaired && writable) await this.writeIndex(root, index).catch(() => {})
    return { sets: index.sets.map((s) => this.view(s)), loose, writable, repaired }
  }

  list(): Promise<TeamTemplateList> {
    return this.listing(false)
  }

  rebuildIndex(): Promise<TeamTemplateList> {
    return this.listing(true)
  }

  /** the catalog as index.md text (repaired in memory), or null when templates are not set up */
  async indexText(): Promise<string | null> {
    try {
      const root = await this.deps.library.root('templates')
      const { index } = await this.reconcile(root, false)
      return renderIndexMd({
        ...index,
        updatedAt: index.updatedAt || minute(this.now()),
        author: index.author || this.deps.memberName(),
      })
    } catch {
      return null
    }
  }

  // ── candidates ────────────────────────────────────────

  private async sigCache(): Promise<Record<string, SigCacheEntry>> {
    try {
      return JSON.parse(await readFile(join(this.deps.cacheDir, 'signatures.json'), 'utf8'))
    } catch {
      return {}
    }
  }

  /**
   * Per set: the signature hashes it was made from and its outline as a signature (level and
   * normalized heading), cached per set and form hash.
   */
  private async setSignatures(
    root: string,
    sets: IndexSet[],
  ): Promise<Map<string, { hashes: string[]; outline: string[] }>> {
    const file = join(this.deps.cacheDir, 'sets.json')
    let cache: Record<string, { hashes: string[]; outline: string[] }>
    try {
      cache = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      cache = {}
    }
    const out = new Map<string, { hashes: string[]; outline: string[] }>()
    let changed = false
    for (const s of sets) {
      const key = `v2|${s.path}|${s.hash8}`
      if (!cache[key]) {
        const parsed = parseTemplateMd(
          await readFile(join(root, s.path, MD), 'utf8').catch(() => ''),
        )
        cache[key] = parsed.ok
          ? {
              hashes: parsed.def.signatures,
              outline: parsed.def.outline.map((e) => `${e.level}:${normalizeHeading(e.heading)}`),
            }
          : { hashes: [], outline: [] }
        changed = true
      }
      out.set(s.path, cache[key]!)
    }
    if (changed) {
      await mkdir(this.deps.cacheDir, { recursive: true })
      await writeFile(file, JSON.stringify(cache))
    }
    return out
  }

  async candidates(): Promise<TeamTemplateCandidate[]> {
    const docsRoot = await this.deps.library.root('documents')
    const files = (await localTeamDocuments(docsRoot)).filter(
      (p) => extname(p).toLowerCase() === '.docx',
    )
    const cache = await this.sigCache()
    const next: Record<string, SigCacheEntry> = {}
    const docs: CandidateDoc[] = []
    this.lastDocPaths = new Map()
    for (const path of files) {
      let info
      try {
        info = await stat(path)
      } catch {
        continue
      }
      const id = toId(docsRoot, path)
      const key = `${id}|${info.size}|${info.mtimeMs}`
      let entry = cache[key]
      if (!entry) {
        try {
          const outline = await readDocxOutline(new Uint8Array(await readFile(path)))
          entry = { sig: outlineSignature(outline), certain: outline.certain }
        } catch {
          continue
        }
      }
      next[key] = entry
      this.lastDocPaths.set(id, path)
      docs.push({ id, signature: entry.sig, certain: entry.certain, mtimeMs: info.mtimeMs })
    }
    await mkdir(this.deps.cacheDir, { recursive: true })
    await writeFile(join(this.deps.cacheDir, 'signatures.json'), JSON.stringify(next))
    const groups = groupCandidates(docs, { minDocs: this.deps.minDocs() })
    this.lastGroups = groups

    let covered = new Map<string, { hashes: string[]; outline: string[] }>()
    try {
      const root = await this.deps.library.root('templates')
      const index = (await this.readIndex(root)) ?? (await this.reconcile(root, false)).index
      covered = await this.setSignatures(root, index.sets)
    } catch {
      covered = new Map()
    }
    return groups.map((g) => {
      const hashes = new Set(g.docs.map((d) => signatureHash(d.signature)))
      // the same form: a source it was made from, or an outline at least as alike as a group
      // (a filled copy adds a 확인 필요 사항 chapter and its own tables)
      const coveredBy = [...covered.entries()].find(
        ([, set]) =>
          set.hashes.some((s) => hashes.has(s)) ||
          (set.outline.length > 0 &&
            g.docs.some((d) => similarity(d.signature, set.outline) >= COVERED_SIMILARITY)),
      )?.[0]
      return {
        key: g.signatureHash,
        docs: g.docs.map((d) => ({ id: d.id, name: basename(d.id), mtimeMs: d.mtimeMs })),
        certain: g.certain,
        ...(coveredBy ? { coveredBy } : {}),
      }
    })
  }

  // ── draft and confirm ─────────────────────────────────

  private async sourceFiles(source: TeamTemplateSource): Promise<string[]> {
    if ('loose' in source) {
      const path = await this.deps.library.resolveEntry('templates', source.loose)
      if (extname(path).toLowerCase() !== '.docx') throw new TeamLibraryError('unsupported')
      return [path]
    }
    const group = this.lastGroups.find((g) => g.signatureHash === source.candidateKey)
    if (!group) throw new TeamLibraryError('changed')
    const ids = group.docs.map((d) => d.id)
    const first = source.docId && ids.includes(source.docId) ? source.docId : ids[0]!
    return [first, ...ids.filter((id) => id !== first)]
      .slice(0, MAX_GROUP_DOCS)
      .map((id) => this.lastDocPaths.get(id)!)
      .filter(Boolean)
  }

  async draft(source: TeamTemplateSource, replaces?: string): Promise<TeamTemplateDraftView> {
    // a read-only member learns it before waiting for the AI
    await this.requireWritable(await this.deps.library.root('templates'))
    const paths = await this.sourceFiles(source)
    const bytes = await Promise.all(paths.map(async (p) => new Uint8Array(await readFile(p))))
    const outlines = await Promise.all(bytes.map((b) => readDocxOutline(b)))
    const rep = bytes[0]!
    const outline = outlines[0]!
    if (outline.headings.length === 0) throw new TeamLibraryError('unsupported')
    let replacesMdHash: string | undefined
    if (replaces) {
      const root = await this.deps.library.root('templates')
      const md = await readFile(join(root, this.setFolder(replaces), MD), 'utf8').catch(() => null)
      if (md === null) throw new TeamLibraryError('moved')
      replacesMdHash = sha256(md)
    }
    const catalog = await this.deps.wikiCatalog().catch(() => '')
    const headerFooter = await headerFooterTexts(rep)
    let draft
    try {
      const prompt = draftPrompt({
        outlines,
        cover: outline.cover,
        headerFooter,
        wikiCatalog: catalog,
      })
      draft = parseDraft(
        outermostJson(await this.deps.complete(prompt.system, prompt.user)),
        outline,
        wikiIds(catalog),
      )
    } catch (error) {
      throw new TeamLibraryError(
        'draft-failed',
        error instanceof Error ? error.message : String(error),
      )
    }
    const form = await buildFormDocx(rep, {
      headings: draft.headings,
      coverLabels: draft.coverLabels,
      headerFooter: draft.headerFooter,
    })
    const docHashes = outlines.map((o) => signatureHash(outlineSignature(o)))
    const formHash = signatureHash(outlineSignature(await readDocxOutline(form)))
    const style = await measureDocxStyle(rep, {
      id: `team-${docHashes[0]!.slice(0, 12)}`,
      title: draft.title,
      documents: outlines.length,
    })
    const def: TemplateDef = {
      title: draft.title,
      kind: 'Word',
      purpose: draft.purpose,
      confirmedAt: day(this.now()),
      author: this.deps.memberName(),
      documents: outlines.length,
      signatures: [...new Set([formHash, ...docHashes])],
      formSha256: sha256(form),
      materials: draft.materials,
      wikiPages: draft.wikiPages,
      outline: outline.headings.map((h, i) => ({
        level: h.level,
        heading: draft.headings[i]!,
        guidance: draft.guidance[i]!,
      })),
      notes: '',
      style,
    }
    const draftId = randomUUID()
    this.dropOldDrafts()
    this.drafts.set(draftId, {
      createdAt: Date.now(),
      form,
      outlines,
      allowed: outlines.flatMap((o) => [
        ...o.headings.map((h) => h.text),
        ...o.tables.flatMap((t) => t.header),
      ]),
      docHashes,
      headerFooter: Object.values(headerFooter),
      ...(replaces ? { replaces, replacesMdHash } : {}),
    })
    return {
      draftId,
      markdown: renderTemplateMd(def),
      formHeadings: draft.headings,
      headerFooter: draft.headerFooter,
      coverLabels: draft.coverLabels,
      ...(replaces ? { replaces } : {}),
    }
  }

  private dropOldDrafts(): void {
    const cutoff = Date.now() - DRAFT_TTL_MS
    for (const [id, d] of this.drafts) if (d.createdAt < cutoff) this.drafts.delete(id)
  }

  /** `Word/<name>/` → `Word/<name>` after checking its shape */
  private setFolder(path: string): string {
    const m = /^([^/\\]+)\/([^/\\]+)\/?$/.exec(path)
    if (!m || !KINDS.includes(m[1]!) || m[2] === '.' || m[2] === '..') {
      throw new TeamLibraryError('invalid-path')
    }
    return join(m[1]!, m[2]!)
  }

  private async gates(draft: Draft, form: Uint8Array, markdown: string): Promise<void> {
    const mdLines = markdown
      .slice(
        0,
        markdown.indexOf('```json style') >= 0 ? markdown.indexOf('```json style') : undefined,
      )
      .split('\n')
    // hash lines and wiki page ids are the app's own data, not text taken from the document
    const contentLines = mdLines.filter(
      (l) => !/^- (근거 서명|형태 파일|참고할 업무 위키):/.test(l),
    )
    const broken = await validateDocxXml(form)
    if (broken) throw new TeamLibraryError('invalid-template', `form.docx: ${broken}`)
    const hits = sourceWordsHits(
      [...draft.outlines.flatMap(sourceContentTexts), ...draft.headerFooter],
      // every XML part of the form, not only the body: charts, properties, anything unknown
      [...(await packageTexts(form)), ...contentLines],
      8,
      draft.allowed,
      draft.outlines.flatMap(strictContentTexts),
    )
    // every offending line at once (up to 10), so the reviewer fixes them in one pass
    if (hits.length) {
      throw new TeamLibraryError(
        'source-words',
        `\n${hits
          .slice(0, 10)
          .map((l) => l.trim())
          .join('\n')}`,
      )
    }
    const mask = this.deps.mask ?? maskDocument
    const masked = await mask(FORM, form)
    if (!masked.ok || Object.values(masked.counts).some((n) => n > 0)) {
      throw new TeamLibraryError('masking-failed')
    }
    // the hash lines are hex, not numbers people wrote
    const prose = mdLines.filter((l) => !/^- (근거 서명|형태 파일):/.test(l)).join('\n')
    if (detectSensitive(prose).length > 0) throw new TeamLibraryError('masking-failed')
  }

  async confirm(draftId: string, markdown: string): Promise<TeamTemplateSet> {
    const draft = this.drafts.get(draftId)
    if (!draft) throw new TeamLibraryError('changed')
    const parsed = parseTemplateMd(markdown)
    if (!parsed.ok) throw new TeamLibraryError('invalid-template', parsed.error)
    const formOutline = await readDocxOutline(draft.form)
    const levels = formOutline.headings.map((h) => h.level).join(',')
    if (parsed.def.outline.map((e) => e.level).join(',') !== levels) {
      throw new TeamLibraryError('invalid-template', '목차의 제목 수나 단계가 형태 파일과 다릅니다')
    }
    const form = await setFormHeadings(
      draft.form,
      parsed.def.outline.map((e) => e.heading),
    )
    const formHash = signatureHash(outlineSignature(await readDocxOutline(form)))
    const def: TemplateDef = {
      ...parsed.def,
      confirmedAt: day(this.now()),
      author: this.deps.memberName(),
      documents: draft.outlines.length,
      signatures: [...new Set([formHash, ...draft.docHashes])],
      formSha256: sha256(form),
    }
    const md = renderTemplateMd(def)
    await this.gates(draft, form, md)

    const root = await this.deps.library.root('templates')
    await this.requireWritable(root)
    let folder: string
    if (draft.replaces) {
      folder = this.setFolder(draft.replaces)
      const current = await readFile(join(root, folder, MD), 'utf8').catch(() => null)
      if (current === null || sha256(current) !== draft.replacesMdHash) {
        throw new TeamLibraryError('changed')
      }
    } else {
      await mkdir(join(root, 'Word'), { recursive: true })
      const base = teamFolderName(def.title)
      folder = ''
      for (let n = 1; n <= 1000 && !folder; n++) {
        const name = n === 1 ? base : `${base} (${n})`
        try {
          await mkdir(join(root, 'Word', name))
          folder = join('Word', name)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
      }
      if (!folder) throw new TeamLibraryError('copy-failed')
    }
    await this.stagedWrite(join(root, folder, FORM), form)
    await this.stagedWrite(join(root, folder, MD), md)
    const path = `${folder.split(sep).join('/')}/`
    const set: IndexSet = {
      title: def.title,
      path,
      kind: 'Word',
      purpose: def.purpose,
      hash8: def.formSha256.slice(0, 8),
    }
    const { index } = await this.reconcile(root, false)
    await this.writeIndex(root, upsertSet(index, set))
    this.drafts.delete(draftId)
    return this.view(set)
  }

  async remove(setPath: string): Promise<void> {
    const root = await this.deps.library.root('templates')
    const folder = this.setFolder(setPath)
    await this.requireWritable(root)
    await rm(join(root, folder), { recursive: true, force: true })
    const { index } = await this.reconcile(root, false)
    await this.writeIndex(root, removeSet(index, setPath))
  }

  // ── open ──────────────────────────────────────────────

  /**
   * A local working copy of the set's form. `targetDir` (a home folder the caller has checked)
   * puts it beside the user's files under a fresh name; otherwise it goes to the drafts folder.
   */
  async openSet(
    setPath: string,
    targetDir?: string,
  ): Promise<{ workingCopy: string; templateMd: string; status: TeamTemplateSet['status'] }> {
    const root = await this.deps.library.root('templates')
    const folder = this.setFolder(setPath)
    let md: string
    let form: Buffer
    try {
      ;[md, form] = await Promise.all([
        readFile(join(root, folder, MD), 'utf8'),
        readFile(join(root, folder, FORM)),
      ])
    } catch {
      await this.list().catch(() => undefined)
      throw new TeamLibraryError('moved')
    }
    const parsed = parseTemplateMd(md)
    if (!parsed.ok) throw new TeamLibraryError('invalid-template', parsed.error)
    const status: TeamTemplateSet['status'] =
      sha256(form) === parsed.def.formSha256 ? 'ok' : 'stale-md'
    this.statuses.set(setPath, status)
    const stem = teamFolderName(parsed.def.title)
    if (targetDir !== undefined) {
      for (let n = 1; n <= 1000; n++) {
        const workingCopy = join(targetDir, n === 1 ? `${stem}.docx` : `${stem} (${n}).docx`)
        try {
          await writeFile(workingCopy, form, { flag: 'wx' })
          return { workingCopy, templateMd: md, status }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
      }
      throw new TeamLibraryError('copy-failed')
    }
    await mkdir(this.deps.draftsDir, { recursive: true })
    const workdir = await mkdtemp(join(this.deps.draftsDir, 'team-'))
    const workingCopy = join(workdir, `${stem}.docx`)
    await writeFile(workingCopy, form, { flag: 'wx' })
    return { workingCopy, templateMd: md, status }
  }
}
