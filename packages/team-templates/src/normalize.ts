/** a heading without its numbering, bracketed notes, digits, punctuation and spaces */
export function normalizeHeading(text: string): string {
  return (
    text
      .normalize('NFC')
      .trim()
      // Ⅱ-1. / 1-1. / 3) / 가.
      .replace(/^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ\d]+(?:[-.]\d+)*[.)]?|[가-하][.)])\s*/u, '')
      .replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/gu, '')
      .replace(/[\d\s\p{P}\p{S}]/gu, '')
  )
}
