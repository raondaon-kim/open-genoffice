import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

/**
 * Which Markdown note belongs to which PDF: one JSON file in userData,
 * `{ version: 1, links: { <canonical PDF path>: <note path> } }`.
 *
 * - A link whose note file no longer exists is no link (the next Open note asks again).
 * - Save As and the redacted copy share the note: `copy`.
 * - In-app moves and renames follow: `movePdf` for the PDF, `moveNote` for the note.
 * - Moves outside the app are not tracked.
 */
export interface NoteLinkStore {
  /** the note of this PDF, or null when there is none or its file is gone */
  get(pdfPath: string): Promise<string | null>
  set(pdfPath: string, notePath: string): Promise<void>
  /** a copy of `fromPdf` uses the same note, unless it already has one */
  copy(fromPdf: string, toPdf: string): Promise<void>
  movePdf(oldPath: string, newPath: string): Promise<void>
  /** every PDF whose note was `oldPath` now points at `newPath` */
  moveNote(oldPath: string, newPath: string): Promise<void>
  /** a folder moved or renamed in the app: every PDF and note path under it follows */
  rebaseDir(oldDir: string, newDir: string): Promise<void>
}

interface LinkFile {
  version: 1
  links: Record<string, string>
}

const canonical = (path: string, platform: NodeJS.Platform): string => {
  const full = resolve(path)
  return platform === 'win32' ? full.toLowerCase() : full
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function createNoteLinkStore(
  file: string,
  platform: NodeJS.Platform = process.platform,
): NoteLinkStore {
  const key = (path: string) => canonical(path, platform)
  /** changes run one after another so concurrent writes never drop a link */
  let queue: Promise<unknown> = Promise.resolve()

  /**
   * The links on disk. Missing: none yet. Damaged JSON: a copy is kept as `.bad` and the
   * file starts over. Any other read error (a file held by another program) rejects, so
   * a change never writes over links it could not read.
   */
  async function read(): Promise<LinkFile> {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, links: {} }
      throw err
    }
    try {
      const parsed = JSON.parse(text) as Partial<LinkFile>
      if (parsed && parsed.version === 1 && parsed.links && typeof parsed.links === 'object') {
        return { version: 1, links: { ...parsed.links } }
      }
    } catch {
      // damaged: fall through to the backup below
    }
    await copyFile(file, `${file}.bad`).catch(() => undefined)
    return { version: 1, links: {} }
  }

  async function write(data: LinkFile): Promise<void> {
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await rename(tmp, file)
  }

  /** read, change and write as one step in the queue; writes only when something changed */
  function change(edit: (links: Record<string, string>) => boolean): Promise<void> {
    const next = queue.then(async () => {
      const data = await read()
      if (edit(data.links)) await write(data)
    })
    queue = next.catch(() => undefined)
    return next
  }

  return {
    async get(pdfPath) {
      await queue
      const notePath = (await read()).links[key(pdfPath)]
      return notePath && (await exists(notePath)) ? notePath : null
    },
    set: (pdfPath, notePath) =>
      change((links) => {
        links[key(pdfPath)] = notePath
        return true
      }),
    copy: (fromPdf, toPdf) =>
      change((links) => {
        const notePath = links[key(fromPdf)]
        if (!notePath || links[key(toPdf)]) return false
        links[key(toPdf)] = notePath
        return true
      }),
    movePdf: (oldPath, newPath) =>
      change((links) => {
        const notePath = links[key(oldPath)]
        if (!notePath) return false
        delete links[key(oldPath)]
        links[key(newPath)] = notePath
        return true
      }),
    rebaseDir: (oldDir, newDir) =>
      change((links) => {
        const prefix = key(oldDir).replace(/[\\/]+$/, '') + sep
        const under = (path: string) => key(path).startsWith(prefix)
        const rebased = (path: string) => resolve(newDir, resolve(path).slice(prefix.length))
        let moved = false
        for (const [pdf, notePath] of Object.entries(links)) {
          const pdfUnder = under(pdf)
          const noteUnder = under(notePath)
          if (!pdfUnder && !noteUnder) continue
          const nextNote = noteUnder ? rebased(notePath) : notePath
          if (pdfUnder) {
            delete links[pdf]
            links[key(rebased(pdf))] = nextNote
          } else links[pdf] = nextNote
          moved = true
        }
        return moved
      }),
    moveNote: (oldPath, newPath) =>
      change((links) => {
        const old = key(oldPath)
        let moved = false
        for (const [pdf, notePath] of Object.entries(links)) {
          if (key(notePath) !== old) continue
          links[pdf] = newPath
          moved = true
        }
        return moved
      }),
  }
}
