/**
 * Standard namespace prefixes for OOXML parts that were written with other ones.
 *
 * XML lets a writer pick any prefix for a namespace, and a deck re-saved by a script
 * (Python's ElementTree, for one) comes out as <ns0:presentation xmlns:ns0="…">.
 * PowerPoint opens such files. This engine, like most OOXML code, finds elements by
 * their usual qualified names ('p:sldId', '@_r:id', 'Relationship'), so before any
 * part is read its prefixes are renamed to the standard ones. A part that already uses
 * them is returned as is (same string), so ordinary decks stay byte-identical.
 */

/** namespace URI -> its usual prefix ('' = the default namespace) */
const STANDARD_PREFIX: Record<string, string> = {
  'http://schemas.openxmlformats.org/presentationml/2006/main': 'p',
  'http://schemas.openxmlformats.org/drawingml/2006/main': 'a',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
  'http://schemas.openxmlformats.org/drawingml/2006/chart': 'c',
  'http://schemas.openxmlformats.org/drawingml/2006/diagram': 'dgm',
  'http://schemas.openxmlformats.org/drawingml/2006/picture': 'pic',
  'http://schemas.openxmlformats.org/drawingml/2006/chartDrawing': 'cdr',
  'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
  'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes': 'vt',
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties': 'cp',
  'http://schemas.microsoft.com/office/powerpoint/2010/main': 'p14',
  'http://schemas.microsoft.com/office/powerpoint/2012/main': 'p15',
  'http://schemas.microsoft.com/office/powerpoint/2015/9/main': 'p159',
  'http://schemas.microsoft.com/office/powerpoint/2018/8/main': 'p188',
  'http://schemas.microsoft.com/office/drawing/2010/main': 'a14',
  'http://schemas.microsoft.com/office/drawing/2014/main': 'a16',
  'http://schemas.microsoft.com/office/drawing/2017/decorative': 'adec',
  'http://schemas.microsoft.com/office/drawing/2014/chartex': 'cx',
  'http://schemas.microsoft.com/office/drawing/2007/8/2/chart': 'c14',
  'http://schemas.microsoft.com/office/drawing/2008/diagram': 'dsp',
  'urn:schemas-microsoft-com:vml': 'v',
  'urn:schemas-microsoft-com:office:office': 'o',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://purl.org/dc/terms/': 'dcterms',
  'http://purl.org/dc/dcmitype/': 'dcmitype',
  'http://www.w3.org/2001/XMLSchema-instance': 'xsi',
  // parts whose elements are written without a prefix
  'http://schemas.openxmlformats.org/package/2006/relationships': '',
  'http://schemas.openxmlformats.org/package/2006/content-types': '',
  'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties': '',
}

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
/** markup-compatibility attributes whose values list prefixes or prefixed names */
const MC_PREFIX_LISTS = new Set([
  'Ignorable',
  'ProcessContent',
  'MustUnderstand',
  'PreserveElements',
  'PreserveAttributes',
])

interface Attr {
  space: string
  name: string
  eq: string
  quote: string
  value: string
}
interface Tag {
  close: boolean
  name: string
  attrs: Attr[]
  tail: string
}

const NAME = /^(\/?)([^\s/>]+)/
const ATTR = /(\s+)([^\s=/>]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/y

/** split into markup and text; markup that is not an element tag is kept as text */
function tokens(xml: string): Array<string | Tag> {
  const out: Array<string | Tag> = []
  let i = 0
  let text = 0
  const flush = (end: number) => {
    if (end > text) out.push(xml.slice(text, end))
  }
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) break
    const skip = (open: string, close: string): boolean => {
      if (!xml.startsWith(open, lt)) return false
      const end = xml.indexOf(close, lt + open.length)
      i = end < 0 ? xml.length : end + close.length
      return true
    }
    if (skip('<!--', '-->') || skip('<![CDATA[', ']]>') || skip('<?', '?>') || skip('<!', '>'))
      continue
    // an element tag: find its '>' outside quoted values
    let j = lt + 1
    let quote = ''
    for (; j < xml.length; j++) {
      const c = xml[j]
      if (quote) {
        if (c === quote) quote = ''
      } else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
    }
    const body = xml.slice(lt + 1, j)
    const head = NAME.exec(body)
    if (!head) {
      i = j + 1
      continue
    }
    const attrs: Attr[] = []
    ATTR.lastIndex = head[0].length
    let m: RegExpExecArray | null
    let last = head[0].length
    while ((m = ATTR.exec(body))) {
      const q = m[4] !== undefined ? '"' : "'"
      attrs.push({ space: m[1]!, name: m[2]!, eq: m[3]!, quote: q, value: m[4] ?? m[5] ?? '' })
      last = ATTR.lastIndex
    }
    flush(lt)
    out.push({ close: head[1] === '/', name: head[2]!, attrs, tail: body.slice(last) })
    i = j + 1
    text = i
  }
  flush(xml.length)
  return out
}

const prefixOf = (qname: string) => {
  const c = qname.indexOf(':')
  return c < 0 ? null : qname.slice(0, c)
}
const localOf = (qname: string) => qname.slice(qname.indexOf(':') + 1)

export function canonicalizeOoxmlPrefixes(xml: string): string {
  // fast path: nothing declared under a non-standard prefix
  let foreign = false
  for (const m of xml.matchAll(/\sxmlns:([^\s=]+)\s*=\s*["']([^"']*)["']/g)) {
    const want = STANDARD_PREFIX[m[2]!]
    if (want !== undefined && want !== m[1]) foreign = true
  }
  if (!foreign) return xml

  const parts = tokens(xml)
  const tags = parts.filter((p): p is Tag => typeof p !== 'string')

  // every binding in the part; a prefix bound to two namespaces makes renaming unsafe
  const uriOf = new Map<string, string>() // prefix ('' = default) -> uri
  for (const t of tags) {
    for (const a of t.attrs) {
      const prefix = a.name === 'xmlns' ? '' : a.name.startsWith('xmlns:') ? a.name.slice(6) : null
      if (prefix === null) continue
      if (uriOf.has(prefix) && uriOf.get(prefix) !== a.value) return xml
      uriOf.set(prefix, a.value)
    }
  }
  const unprefixedElements = tags.some((t) => prefixOf(t.name) === null)
  const prefixedAttrUse = new Set(
    tags.flatMap((t) => t.attrs.map((a) => prefixOf(a.name)).filter((p): p is string => !!p)),
  )

  const rename = new Map<string, string>() // foreign prefix -> standard ('' = default)
  for (const [prefix, uri] of uriOf) {
    const want = STANDARD_PREFIX[uri]
    if (prefix === '' || want === undefined || want === prefix) continue
    const taken = uriOf.get(want)
    if (taken !== undefined && taken !== uri) continue
    if (want === '') {
      // unprefixed attributes are in no namespace, and unprefixed elements without a
      // default declaration are too: moving to the default namespace must not touch them
      if (prefixedAttrUse.has(prefix)) continue
      if (unprefixedElements && taken === undefined) continue
    }
    rename.set(prefix, want)
  }
  if (rename.size === 0) return xml

  const qname = (name: string): string => {
    const p = prefixOf(name)
    if (p === null || !rename.has(p)) return name
    const to = rename.get(p)!
    return to ? `${to}:${localOf(name)}` : localOf(name)
  }
  const prefixList = (value: string, qualified: boolean) =>
    value
      .split(/(\s+)/)
      .map((tok) => {
        if (!tok.trim()) return tok
        if (qualified) return qname(tok)
        return rename.has(tok) ? rename.get(tok) || tok : tok
      })
      .join('')

  return parts
    .map((part) => {
      if (typeof part === 'string') return part
      const name = qname(part.name)
      const seen = new Set<string>()
      const attrs: string[] = []
      for (const a of part.attrs) {
        let n = a.name
        let v = a.value
        if (n.startsWith('xmlns:') && rename.has(n.slice(6))) {
          const to = rename.get(n.slice(6))!
          n = to ? `xmlns:${to}` : 'xmlns'
        } else if (!n.startsWith('xmlns')) {
          n = qname(n)
          const p = prefixOf(a.name)
          if (p !== null && uriOf.get(p) === MC && MC_PREFIX_LISTS.has(localOf(a.name))) {
            v = prefixList(
              v,
              localOf(a.name) !== 'Ignorable' && localOf(a.name) !== 'MustUnderstand',
            )
          } else if (
            n === 'Requires' &&
            prefixOf(part.name) !== null &&
            uriOf.get(prefixOf(part.name)!) === MC
          ) {
            v = prefixList(v, false)
          }
        }
        if (seen.has(n)) continue // the standard declaration was already on this element
        seen.add(n)
        attrs.push(`${a.space}${n}${a.eq}${a.quote}${v}${a.quote}`)
      }
      return `<${part.close ? '/' : ''}${name}${attrs.join('')}${part.tail}>`
    })
    .join('')
}
