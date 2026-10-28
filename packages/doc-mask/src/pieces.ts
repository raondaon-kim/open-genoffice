import { type Counts, detectSensitive, PLACEHOLDER } from './rules'

/**
 * Masks numbers in text that is stored in pieces (the runs of a paragraph: `010-` in one run,
 * `1234-5678` in the next). Detection runs on the joined text; each match is written back as
 * its placeholder into the piece where the match starts, and the match's characters are removed
 * from every piece it covers. Text before and after a match stays in its own piece, so its run
 * formatting is kept. Pieces a match does not touch come back identical.
 */
export function maskPieces(pieces: string[]): { pieces: string[]; counts: Counts } {
  const joined = pieces.join('')
  const found = detectSensitive(joined)
  if (found.length === 0) return { pieces: pieces.slice(), counts: {} }

  const counts: Counts = {}
  for (const m of found) counts[m.rule] = (counts[m.rule] ?? 0) + 1

  const out: string[] = []
  let offset = 0
  let mi = 0
  for (const piece of pieces) {
    const start = offset
    const end = offset + piece.length
    let text = ''
    let pos = start
    while (pos < end) {
      while (mi < found.length && found[mi].end <= pos) mi++
      const m = found[mi]
      if (!m || m.start >= end) {
        text += joined.slice(pos, end)
        pos = end
      } else if (m.start > pos) {
        text += joined.slice(pos, m.start)
        pos = m.start
      } else {
        // pos lies inside the match: the placeholder goes where the match starts
        if (m.start === pos && m.start >= start) text += PLACEHOLDER[m.rule]
        pos = Math.min(m.end, end)
      }
    }
    out.push(text)
    offset = end
  }
  return { pieces: out, counts }
}
