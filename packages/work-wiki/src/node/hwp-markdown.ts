/**
 * LLM Wiki cannot read Hangul files, so their text goes into the wiki as
 * Markdown: a title line, then the extracted text without the converter's
 * `[page N]` markers. Empty when there is no text.
 */
export function hwpTextAsMarkdown(stem: string, text: string): string {
  const body = text.replace(/^\[page \d+\]\r?\n/gm, '').trim()
  return body ? `# ${stem}\n\n${body}\n` : ''
}
