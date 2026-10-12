import { execFile } from 'node:child_process'

/**
 * Text of a Hangul document for AI attachments (an RFP, a form, a report), through the bundled
 * rhwp CLI: `rhwp export-text <file> --json` gives the text per page. Pages are joined with a
 * page marker so the assistant can cite where a requirement is.
 */

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const TIMEOUT_MS = 60_000

export type RunRhwp = (args: string[]) => Promise<string>

export function runRhwpWith(rhwpPath: string): RunRhwp {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        rhwpPath,
        args,
        { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, encoding: 'utf8' },
        (err, stdout, stderr) => {
          if (err)
            reject(
              new Error(
                String(stderr || err.message)
                  .trim()
                  .slice(0, 500),
              ),
            )
          else resolve(stdout)
        },
      )
    })
}

/** export-text JSON -> one string, "[page N]" before each page's text */
export function joinExportedPages(json: string): string {
  const parsed = JSON.parse(json) as { pages?: Array<{ page?: number; text?: string }> }
  const pages = Array.isArray(parsed.pages) ? parsed.pages : []
  return pages
    .map((p, i) => `[page ${(typeof p.page === 'number' ? p.page : i) + 1}]\n${p.text ?? ''}`)
    .join('\n\n')
    .trim()
}

export function hwpTextExtractor(run: RunRhwp): (filePath: string) => Promise<string> {
  return async (filePath) => {
    const out = await run(['export-text', filePath, '--json'])
    const text = joinExportedPages(out)
    if (!text.replace(/\[page \d+\]/g, '').trim())
      throw new Error('The Hangul document has no text')
    return text
  }
}
