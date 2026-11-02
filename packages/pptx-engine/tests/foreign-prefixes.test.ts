import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import { openPptx, savePptx } from '../src/index'
import { canonicalizeOoxmlPrefixes } from '../src/ooxml-prefixes'

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships'

/**
 * Rewrites a part the way Python's xml.etree.ElementTree serializes it: every namespace
 * (the default one included) gets an ns0, ns1, … prefix declared on the root element, and
 * no other prefix survives. Decks re-saved by scripts (python-pptx-free "strip the notes"
 * tools) come out like this; PowerPoint opens them.
 */
function elementTreeStyle(xml: string): string {
  const uris: string[] = []
  const bound = new Map<string, string>() // original prefix ('' = default) -> uri
  for (const m of xml.matchAll(/\sxmlns(?::([\w.-]+))?="([^"]*)"/g)) {
    bound.set(m[1] ?? '', m[2]!)
    if (!uris.includes(m[2]!)) uris.push(m[2]!)
  }
  const nsOf = (prefix: string) => `ns${uris.indexOf(bound.get(prefix)!)}`
  let root = true
  return xml.replace(
    /<([/]?)(?:([\w.-]+):)?([\w.-]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g,
    (_m, close: string, prefix: string | undefined, local: string, attrs: string, self: string) => {
      const name = prefix === undefined && !bound.has('') ? local : `${nsOf(prefix ?? '')}:${local}`
      const kept = [...attrs.matchAll(/\s+([^\s=]+)\s*=\s*("[^"]*"|'[^']*')/g)]
        .filter((a) => !a[1]!.startsWith('xmlns'))
        .map((a) => {
          const [ap, al] = a[1]!.includes(':') ? a[1]!.split(':') : [undefined, a[1]!]
          const an = ap === undefined || ap === 'xml' ? a[1]! : `${nsOf(ap)}:${al}`
          return ` ${an}=${a[2]}`
        })
      let decls = ''
      if (root && !close) {
        decls = uris.map((u, i) => ` xmlns:ns${i}="${u}"`).join('')
        root = false
      }
      return `<${close}${name}${decls}${kept.join('')}${self ? ' /' : ''}>`
    },
  )
}

async function rewriteParts(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes)
  for (const name of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/.test(name)) continue
    zip.file(name, elementTreeStyle(await zip.file(name)!.async('string')))
  }
  return zip.generateAsync({ type: 'uint8array' })
}

const slideTexts = (deck: Awaited<ReturnType<typeof openPptx>>['deck']) =>
  deck.slides.map((s) =>
    s.elements
      .flatMap((e: any) => e.text?.paragraphs ?? [])
      .flatMap((p: any) => p.runs)
      .map((r: any) => r.text)
      .join(''),
  )

const wellFormed = (xml: string) => new XMLParser({ ignoreAttributes: false }).parse(xml)

describe('decks whose XML uses non-standard namespace prefixes', () => {
  const fixture = new Uint8Array(
    readFileSync(join(__dirname, 'fixtures/01_standard_business.pptx')),
  )

  it('the test rewrite really produces ns0-style parts', async () => {
    const zip = await JSZip.loadAsync(await rewriteParts(fixture))
    const pres = await zip.file('ppt/presentation.xml')!.async('string')
    expect(pres).toMatch(/<ns\d+:presentation /)
    expect(pres).not.toContain('<p:')
    const rels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')
    expect(rels).toMatch(
      /<ns0:Relationships xmlns:ns0="http:\/\/schemas.openxmlformats.org\/package\/2006\/relationships"/,
    )
  })

  it('opens with the same slides and text as the original', async () => {
    const original = await openPptx(fixture)
    const foreign = await openPptx(await rewriteParts(fixture))
    expect(foreign.deck.slides.length).toBe(original.deck.slides.length)
    expect(foreign.deck.size).toEqual(original.deck.size)
    expect(slideTexts(foreign.deck)).toEqual(slideTexts(original.deck))
    expect(slideTexts(foreign.deck).join('').length).toBeGreaterThan(0)
  })

  it('saves and reopens', async () => {
    const original = await openPptx(fixture)
    const foreign = await openPptx(await rewriteParts(fixture))
    const reopened = await openPptx(await savePptx(foreign))
    expect(slideTexts(reopened.deck)).toEqual(slideTexts(original.deck))
  })
})

describe('canonicalizeOoxmlPrefixes', () => {
  it('returns standard XML unchanged', () => {
    const xml = `<?xml version="1.0"?><p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`
    expect(canonicalizeOoxmlPrefixes(xml)).toBe(xml)
  })

  it('renames element and attribute prefixes to the standard ones', () => {
    const xml = `<?xml version='1.0' encoding='utf-8'?>\n<ns0:presentation xmlns:ns0="${P}" xmlns:ns1="${R}"><ns0:sldIdLst><ns0:sldId id="256" ns1:id="R0a" /></ns0:sldIdLst></ns0:presentation>`
    expect(canonicalizeOoxmlPrefixes(xml)).toBe(
      `<?xml version='1.0' encoding='utf-8'?>\n<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="R0a" /></p:sldIdLst></p:presentation>`,
    )
  })

  it('moves a prefixed package-relationships part back to the default namespace', () => {
    const xml = `<ns0:Relationships xmlns:ns0="${PKG_RELS}"><ns0:Relationship Id="R1" Type="t" Target="slides/slide1.xml" /></ns0:Relationships>`
    expect(canonicalizeOoxmlPrefixes(xml)).toBe(
      `<Relationships xmlns="${PKG_RELS}"><Relationship Id="R1" Type="t" Target="slides/slide1.xml" /></Relationships>`,
    )
  })

  it('leaves text, comments and attribute values alone', () => {
    const xml = `<ns0:sld xmlns:ns0="${P}"><!-- ns0:x --><ns0:t descr="a > ns0:b">ns0:text &lt;ns0:y&gt;</ns0:t></ns0:sld>`
    expect(canonicalizeOoxmlPrefixes(xml)).toBe(
      `<p:sld xmlns:p="${P}"><!-- ns0:x --><p:t descr="a > ns0:b">ns0:text &lt;ns0:y&gt;</p:t></p:sld>`,
    )
  })

  it('does not declare a prefix twice when the standard one is already there', () => {
    const xml = `<p:sld xmlns:p="${P}" xmlns:ns0="${P}"><ns0:cSld/><p:clrMapOvr/></p:sld>`
    const out = canonicalizeOoxmlPrefixes(xml)
    expect(out).toBe(`<p:sld xmlns:p="${P}"><p:cSld/><p:clrMapOvr/></p:sld>`)
    expect(() => wellFormed(out)).not.toThrow()
  })

  it('renames prefixes listed in markup-compatibility attributes', () => {
    const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
    const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main'
    const xml = `<ns0:sld xmlns:ns0="${P}" xmlns:ns1="${MC}" xmlns:ns2="${P14}" ns1:Ignorable="ns2 v"><ns1:AlternateContent><ns1:Choice Requires="ns2"><ns2:x/></ns1:Choice></ns1:AlternateContent></ns0:sld>`
    expect(canonicalizeOoxmlPrefixes(xml)).toBe(
      `<p:sld xmlns:p="${P}" xmlns:mc="${MC}" xmlns:p14="${P14}" mc:Ignorable="p14 v"><mc:AlternateContent><mc:Choice Requires="p14"><p14:x/></mc:Choice></mc:AlternateContent></p:sld>`,
    )
  })

  it('leaves a part alone when renaming could change its meaning', () => {
    // the same prefix bound to two namespaces
    const rebound = `<ns0:a xmlns:ns0="${P}"><ns0:b xmlns:ns0="${R}"/></ns0:a>`
    expect(canonicalizeOoxmlPrefixes(rebound)).toBe(rebound)
    // the standard prefix already means something else here
    const taken = `<ns0:a xmlns:ns0="${P}" xmlns:p="urn:other"><p:b/></ns0:a>`
    expect(canonicalizeOoxmlPrefixes(taken)).toBe(
      `<ns0:a xmlns:ns0="${P}" xmlns:p="urn:other"><p:b/></ns0:a>`,
    )
  })
})
