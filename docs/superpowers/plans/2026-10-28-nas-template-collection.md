# NAS Template Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In company builds, every document the user saves by hand is copied, with personal and
company identification numbers masked and formatting intact, to a per-user/per-day/per-kind
folder on the company NAS.

**Architecture:** A new package `@genoffice/doc-mask` detects numbers in text, masks them inside
docx/hwpx/pptx/xlsx packages and plain-text formats without touching formatting, and re-checks
the whole result (fail closed). The editors' existing "document saved" hooks gain a save origin;
a shell main module `nas-collect` takes user saves only, masks, keeps the result in a local
outbox and delivers it over SMB with a dedicated NAS account read from the build's
`org-defaults.json`. Settings shows a read-only statement.

**Tech Stack:** TypeScript, Electron main process, vitest, jszip (or docx-engine's `zip-splice`),
an SMB2 client library chosen in Task 9.

**Spec:** `docs/superpowers/specs/2026-10-28-nas-template-collection-design.md`

## Global Constraints

- Masked: resident/foreigner registration no., mobile and landline/fax/representative phone,
  e-mail, business registration no., corporate registration no., account no., card no.
- Placeholders, exactly: `[주민번호]` `[전화번호]` `[이메일]` `[사업자번호]` `[법인번호]` `[계좌번호]` `[카드번호]`.
- Names and addresses are never masked; no AI is used anywhere in this feature.
- Must stay unmasked: dates (`2026-10-28`, `2026.10.28`), amounts (`1,250,000`, `1250만 원`), times,
  percentages, page/section numbers, years, version numbers, legal article numbers.
- Ambiguous digit groups (account vs. something else) are masked.
- A copy with any detectable number never leaves the PC; parse failure → not sent.
- Collected: `.docx` → `Word`, `.hwpx` → `한글`, `.pptx` → `PowerPoint`, `.xlsx` `.csv` `.tsv` →
  `Excel`, `.md` `.markdown` `.txt` → `Markdown`, `.html` `.htm` → `HTML`. Not collected: `.hwp`,
  `.pdf`, `.xls`, `.xlsm`, `.json`, encrypted docx.
- Only saves the user starts (incl. the first save of a new document). Not autosave, recovery,
  the AI's silent saves, MCP/agent saves.
- Target: `\\<host>\<share>\<installId>\<YYYY-MM-DD local>\<kind folder>\<masked base> (<6 hex of sha1(source path)>)<ext>`.
- The user's save is never slowed or failed by collection; collection errors never reach the UI.
- NAS host/share/user/password come only from `org-defaults.json` (build env
  `OPEN_GENOFFICE_NAS_HOST`, `_SHARE`, `_USER`, `_PASSWORD`); never in a tracked file, a log line or
  a test fixture. Never map a drive, never use Windows Credential Manager, never disconnect
  anything.
- Settings statement, exactly: `저장한 문서는 회사 문서 양식 학습을 위해 전화번호·계좌번호 등 개인·회사 식별 번호를 가린 뒤 회사 NAS에 보관됩니다.` No switch.
- Without `nas` in org-defaults the feature registers nothing and Settings shows nothing.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push without the
  user's word (and then the release rule in CLAUDE.local.md applies).

## Review Focus

1. **Nested paragraphs**: an hwpx/docx table cell paragraph inside an outer paragraph (hwpx tables
   live inside `hp:p`). Expected: the cell's number is masked, the outer paragraph's text is not
   shifted or duplicated. Test in Task 2.
2. **False positives**: `2026-10-28`, `1,250,000원`, `제12조`, `v1.2.3`, `10:30`, `3.5%`, `p. 12`,
   `2026년`, a 4-digit document number `제2026-0123호`. Expected: untouched. Test in Task 1.
3. **Number split across runs and wrapped in a hyperlink/field** (`<w:hyperlink>` with
   `mailto:` target, `010-` in one run, `1234-5678` in the next). Expected: both visible text and
   the `mailto:` relationship target masked. Test in Task 4.
4. **NAS down / wrong password / share missing / app quits mid-send**. Expected: save unaffected,
   job stays in the outbox, no dialog, sent on a later attempt; a half-written file never remains
   under its final name. Test in Task 8 (fake client) and Task 9 (temp name + rename).
5. **First Ctrl+S of an untitled Word document** goes through `docs:save-new`. Expected:
   collected; the AI's `create_document` and the recovery tick's silent save through the same
   handler are not. Test in Task 7.

---

## File Structure

```
packages/doc-mask/                 new package @genoffice/doc-mask (pure, no Electron)
  package.json, tsconfig.json, vitest.config.ts   (copy packages/work-wiki's)
  src/rules.ts        RuleId, PLACEHOLDER, detectSensitive(), maskText()
  src/pieces.ts       maskPieces(): map matches on joined text back onto text pieces
  src/xml-text.ts     XML_FAMILIES, maskXmlParagraphs(), xmlParagraphTexts()
  src/zip.ts          readPackage()/writePackage() keeping entry order, hwpx mimetype stored first
  src/formats/xlsx.ts docx.ts pptx.ts hwpx.ts text.ts
  src/verify.ts       verifyMasked(): every non-media part re-scanned
  src/index.ts        maskDocument(), maskFileName(), types
  tests/*.test.ts
apps/{docs,slides,sheets,markdown,html,pdf}/src/main/*-main.ts   hook gains SaveOrigin
apps/docs/src/preload/index.ts, apps/docs/src/renderer/file-actions.ts   save-new origin
apps/hwp/src/main/hwp-main.ts                                    onSaved gains origin
apps/shell/src/main/nas-collect/
  kinds.ts      collectKind(path) → kind folder or null
  target.ts     targetSegments(...)
  outbox.ts     persistent queue in userData/nas-outbox
  collector.ts  createNasCollector(deps): debounce, mask, enqueue, deliver, retry
  smb-client.ts NasClient over the chosen SMB2 library
  index.ts      startNasCollection(), nasDocumentSaved()
apps/shell/src/main/org-defaults.ts      parseOrgNas(), readOrgNas()
apps/shell/electron-builder.cjs          write nas block from env
apps/shell/src/main/index.ts             wiring, Settings view flag
apps/shell/src/renderer/src/SettingsModal.tsx   statement
```

Ruling (planning): masking runs in the main process, async, yielding (`await setImmediate`)
between package parts; files over 100 MB are skipped. No worker thread: the shell has no worker
bundling today and typical documents are small. Cost if wrong: a large deck stalls the UI briefly
after save; then move `maskDocument` into a `worker_threads` worker (the package is pure, so only
the call site changes).

---

### Task 1: Package and detection rules

**Files:**
- Create: `packages/doc-mask/{package.json,tsconfig.json,vitest.config.ts}`, `src/rules.ts`, `src/index.ts`
- Modify: root `package.json` `test` script (add `npm run test -w @genoffice/doc-mask` after work-wiki)
- Test: `packages/doc-mask/tests/rules.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RuleId = 'rrn' | 'phone' | 'email' | 'bizno' | 'corpno' | 'account' | 'card'
  export const PLACEHOLDER: Record<RuleId, string>   // rrn→'[주민번호]', phone→'[전화번호]', email→'[이메일]',
                                                      // bizno→'[사업자번호]', corpno→'[법인번호]', account→'[계좌번호]', card→'[카드번호]'
  export interface SensitiveMatch { start: number; end: number; rule: RuleId }
  export function detectSensitive(text: string): SensitiveMatch[]   // sorted, non-overlapping
  export type Counts = Partial<Record<RuleId, number>>
  export function maskText(text: string): { text: string; counts: Counts }
  ```

- [ ] **Step 1: Write the failing tests** — `it.each` tables:

  | input | expected `maskText(...).text` |
  |---|---|
  | `주민번호 900101-1234567` | `주민번호 [주민번호]` |
  | `9001011234567` | `[주민번호]` |
  | `외국인 900101-5234567` | `외국인 [주민번호]` |
  | `010-1234-5678` / `01012345678` / `010 1234 5678` / `+82 10-1234-5678` | `[전화번호]` |
  | `02-123-4567` / `031-1234-5678` / `070-1234-5678` / `1588-1234` / `(02) 123-4567` | `[전화번호]` |
  | `팩스: 02-123-4568` | `팩스: [전화번호]` |
  | `hong@ubion.co.kr로` | `[이메일]로` |
  | a checksum-valid business no. `xxx-xx-xxxxx` (compute one in the test) | `[사업자번호]` |
  | a checksum-invalid `123-45-67891` alone | unchanged unless an account rule hits (assert not `[사업자번호]`) |
  | a 13-digit `xxxxxx-xxxxxxx` whose first six digits are not a valid date (e.g. `110171-…`) and whose corporate checksum is valid (compute in the test) | `[법인번호]` |
  | `계좌: 국민 123456-01-234567` / `예금주 홍길동 110-123-456789` | account part → `[계좌번호]`, names kept |
  | `123-456789-01-012` with no keyword | `[계좌번호]` |
  | `4111-1111-1111-1111` (Luhn valid) | `[카드번호]` |

  Negative table (unchanged): `2026-10-28`, `2026.10.28`, `1,250,000원`, `1250만 원`, `10:30`,
  `3.5%`, `p. 12`, `2026년`, `제12조 제3항`, `v1.2.3`, `제2026-0123호`, `서울시 강남구 테헤란로 123`,
  `홍길동`.
  Plus: `detectSensitive('a 010-1234-5678 b hong@x.kr')` returns two matches in order with
  rules `['phone','email']`; counts from `maskText` equal `{ phone: 1, email: 1 }`.

- [ ] **Step 2: Run** `npm run test -w @genoffice/doc-mask` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** in `src/rules.ts`. Rule precedence when spans overlap: email, rrn,
  corpno, card, bizno, phone, account; earlier wins. Digit groups must be bounded by non-digits
  (no match inside a longer number). RRN: valid `YYMMDD` and 7th digit 1–8; no checksum. Corp no:
  13 digits with the corporate checksum and not a valid RRN. Bizno: 10 digits with the bizno
  checksum. Card: 16 digits in 4 groups, Luhn. Account: (a) digits/hyphens 10–20 long within 15
  characters after `계좌|예금주|입금|은행|account` or a bank name (국민, 신한, 우리, 하나, 농협,
  기업, 카카오뱅크, 토스뱅크, 새마을, 우체국, 수협, 부산, 대구, 경남, 광주, 전북, 제주, SC제일, 씨티);
  (b) 3–4 hyphen-separated groups totalling 10–16 digits that no other rule matched and that are
  not a date.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(doc-mask): detect personal and company identification numbers`

### Task 2: Mapping masks onto XML text pieces

**Files:**
- Create: `packages/doc-mask/src/pieces.ts`, `src/xml-text.ts`
- Test: `packages/doc-mask/tests/xml-text.test.ts`

**Interfaces:**
- Consumes: `detectSensitive`, `PLACEHOLDER` (Task 1)
- Produces:
  ```ts
  export function maskPieces(pieces: string[]): { pieces: string[]; counts: Counts }
  export interface XmlFamily { paragraph: string; text: readonly string[] }   // qualified tag names
  export const XML_FAMILIES: { docx: XmlFamily; hwpx: XmlFamily; drawing: XmlFamily; sheet: XmlFamily }
  //  docx: { paragraph: 'w:p', text: ['w:t','w:delText','w:instrText'] }
  //  hwpx: { paragraph: 'hp:p', text: ['hp:t'] }
  //  drawing: { paragraph: 'a:p', text: ['a:t'] }     (pptx slides/notes, charts' rich text, smartart)
  //  sheet: { paragraph: 'si', text: ['t'] }          (sharedStrings si, inline is)
  export function maskXmlParagraphs(xml: string, family: XmlFamily): { xml: string; counts: Counts }
  export function xmlParagraphTexts(xml: string, family: XmlFamily): string[]   // decoded joined text per innermost paragraph
  ```

- [ ] **Step 1: Write the failing tests:**
  - `maskPieces(['연락처 010-', '1234-', '5678 끝'])` → `['연락처 [전화번호] 끝', '', '']`
    (first touched piece gets head + placeholder + tail of last touched piece, others emptied).
  - Two matches in one paragraph across pieces → both masked, untouched pieces byte-identical.
  - docx: `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>010-</w:t></w:r><w:r><w:t>1234-5678</w:t></w:r></w:p>`
    → `<w:rPr><w:b/></w:rPr>` still present, joined text `[전화번호]`, every changed `w:t` has
    `xml:space="preserve"`.
  - Entities: `<w:t>a&amp;b 010-1234-5678</w:t>` → `a&amp;b [전화번호]` (escaped back).
  - hwpx child elements inside `hp:t`: `<hp:t>010-1234<hp:tab/>-5678</hp:t>` — text segments around
    `<hp:tab/>` are separate pieces and the tab element survives. (A tab breaks the number, so
    assert the number is NOT detected here; and `<hp:t>tel 010-1234-5678<hp:lineBreak/>x</hp:t>`
    masks and keeps `<hp:lineBreak/>`.)
  - Nested paragraphs (Review Focus 1): an outer `hp:p` containing `<hp:tbl>…<hp:p><hp:run><hp:t>010-1234-5678</hp:t></hp:run></hp:p>…</hp:tbl>`
    plus outer text `제목` → inner masked, outer text still `제목`, `xmlParagraphTexts` returns
    `['제목', '[전화번호]']` in document order (outer pieces are only those not inside a nested paragraph).
  - No match → output string `===` input.
  - `w:delText` and `w:instrText` (`HYPERLINK "mailto:hong@x.kr"`) are masked.
- [ ] **Step 2: Run** `npm run test -w @genoffice/doc-mask` — Expected: FAIL.
- [ ] **Step 3: Implement.** Tokenise the XML once into tags and character data; track a stack of
  open paragraphs; a piece is a maximal character-data run directly inside one of the family's
  text elements and belongs to the innermost open paragraph. Mask per paragraph with
  `maskPieces`, then splice pieces back from the end. `text-patch.ts` in docx-engine is the
  reference for the splice; it is not imported (single-range, `w:` only).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(doc-mask): mask numbers across text runs without touching formatting`

### Task 3: Package I/O and the xlsx masker

**Files:**
- Create: `packages/doc-mask/src/zip.ts`, `src/formats/xlsx.ts`
- Test: `packages/doc-mask/tests/xlsx.test.ts`, `tests/zip.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PackageEntry { name: string; data: Uint8Array }
  export async function readPackage(bytes: Uint8Array): Promise<PackageEntry[]>          // order preserved
  export async function writePackage(entries: PackageEntry[]): Promise<Uint8Array>       // 'mimetype' first and STORED when present
  export async function maskXlsx(bytes: Uint8Array): Promise<{ bytes: Uint8Array; counts: Counts }>
  ```

- [ ] **Step 1: Write the failing tests** (build workbooks with jszip in the test):
  - `zip.test`: round trip keeps entry names and order; an entry list starting with `mimetype`
    comes out with `mimetype` first, compression method 0 (read the local header byte at offset 8).
  - `xlsx.test`: sharedStrings `<si><t>010-1234-5678</t></si>` and rich `<si><r><t>010-</t></r><r><rPr><b/></rPr><t>1234-5678</t></r></si>` masked, `<rPr>` kept.
  - Inline string cell `<c r="A2" t="inlineStr"><is><t>hong@x.kr</t></is></c>` masked.
  - Numeric cell `<c r="B2"><v>9001011234567</v></c>` (an RRN stored as a number) becomes `<c r="B2" t="inlineStr"><is><t>[주민번호]</t></is></c>`; a numeric `<v>1250000</v>` stays.
  - Comments (`xl/comments1.xml` `<t>`), header/footer (`<oddHeader>`), defined names, data
    validation `<formula1>"010-1234-5678"</formula1>`, formula string literal `<f>"tel 010-1234-5678"</f>`,
    pivot cache records `<s v="010-1234-5678"/>` and chart `c:v` strings → masked.
  - Entries not containing text are byte-identical in the output.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `zip.ts` (jszip, or `@genoffice/docx-engine/zip-splice` `readZipEntries`/`writeZip` if it keeps unchanged entries' compressed bytes — preferred when it does) and `xlsx.ts`: `XML_FAMILIES.sheet` on sharedStrings/inline/comments; `maskText` on attribute values and the element texts listed above.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(doc-mask): mask xlsx workbooks`

### Task 4: docx and pptx maskers

**Files:**
- Create: `packages/doc-mask/src/formats/docx.ts`, `src/formats/pptx.ts`
- Test: `packages/doc-mask/tests/docx.test.ts`, `tests/pptx.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3
- Produces:
  ```ts
  export async function maskDocx(bytes: Uint8Array): Promise<{ bytes: Uint8Array; counts: Counts } | { encrypted: true }>
  export async function maskPptx(bytes: Uint8Array): Promise<{ bytes: Uint8Array; counts: Counts }>
  ```

- [ ] **Step 1: Write the failing tests:**
  - docx parts masked: `word/document.xml`, `header1.xml`, `footer1.xml`, `footnotes.xml`,
    `endnotes.xml`, `comments.xml`, `glossary/document.xml`, `customXml/item1.xml` text nodes,
    `docProps/core.xml` / `app.xml` / `custom.xml` text.
  - Review Focus 3: `<w:hyperlink r:id="rId9">` around split runs `010-` / `1234-5678`, and
    `word/_rels/document.xml.rels` `Target="mailto:hong@x.kr"` → visible text `[전화번호]`, target
    `mailto:[이메일]`.
  - Chart part `word/charts/chart1.xml` `<c:v>010-1234-5678</c:v>` and an embedded workbook
    `word/embeddings/Microsoft_Excel_Worksheet.xlsx` containing a shared-string phone → both masked
    (the embedded one via `maskXlsx`).
  - `docProps/thumbnail.jpeg` removed, and its `<Relationship … Target="docProps/thumbnail.jpeg"/>`
    removed from `_rels/.rels`, and its `[Content_Types].xml` `Override` (if any) removed.
  - An OLE-encrypted docx (CFB magic `D0 CF 11 E0` at offset 0) → `{ encrypted: true }`.
  - pptx: `ppt/slides/slide1.xml`, `notesSlides`, `slideLayouts`, `slideMasters`, `notesMasters`,
    `comments`, `diagrams/data1.xml`, `charts/chart1.xml`, embedded workbook → masked;
    `docProps/thumbnail.jpeg` removed as above.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**: `XML_FAMILIES.docx` on Word parts, `XML_FAMILIES.drawing` on
  DrawingML parts (also inside docx text boxes that use `a:t`), `maskText` on `c:v`, rels targets
  and property texts; recurse into `*/embeddings/*.xlsx` with `maskXlsx`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(doc-mask): mask docx and pptx packages`

### Task 5: hwpx masker

**Files:**
- Create: `packages/doc-mask/src/formats/hwpx.ts`
- Test: `packages/doc-mask/tests/hwpx.test.ts`

**Interfaces:**
- Produces: `export async function maskHwpx(bytes: Uint8Array): Promise<{ bytes: Uint8Array; counts: Counts }>`

- [ ] **Step 1: Write the failing tests** using a real hwpx: generate one with the repo's hwpx
  writer if a test helper exists in `apps/hwp/tests`, else build a minimal package in the test
  (`mimetype` = `application/hwp+zip`, `Contents/content.hpf`, `Contents/section0.xml`,
  `Contents/section1.xml`, `Preview/PrvText.txt`, `Preview/PrvImage.png`, `META-INF/container.xml`):
  - section text, header/footer, footnote, text box and table cell paragraphs (all inside
    `section*.xml`) masked; nested-table case from Review Focus 1 on a real structure.
  - `Preview/PrvText.txt` masked as plain text; `Preview/PrvImage.png` removed and its manifest
    entry (`content.hpf` `<opf:item … href="Preview/PrvImage.png"/>`) removed.
  - `Contents/content.hpf` metadata text (title, creator fields) masked.
  - Output `mimetype` first and stored (reuse the Task 3 check).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** with `XML_FAMILIES.hwpx` and `maskText`.
- [ ] **Step 4: Run** — Expected: PASS. Then open one masked fixture in the dev app's Hangul editor
  (`npm run dev`) and confirm it opens; note the result in the ledger.
- [ ] **Step 5: Commit** `feat(doc-mask): mask hwpx documents`

### Task 6: Text formats, file names, verification gate, `maskDocument`

**Files:**
- Create: `packages/doc-mask/src/formats/text.ts`, `src/verify.ts`; complete `src/index.ts`
- Test: `packages/doc-mask/tests/document.test.ts`, `tests/verify.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type MaskFormat = 'docx' | 'hwpx' | 'pptx' | 'xlsx' | 'csv' | 'tsv' | 'md' | 'txt' | 'html'
  export function formatOf(fileName: string): MaskFormat | null       // case-insensitive ext; .markdown→'md', .htm→'html'
  export function maskFileName(fileName: string): string             // maskText on the base name, ext kept
  export type MaskOutcome =
    | { ok: true; bytes: Uint8Array; counts: Counts }
    | { ok: false; reason: 'unsupported' | 'encrypted' | 'parse' | 'residual'; part?: string; rule?: RuleId }
  export async function maskDocument(fileName: string, bytes: Uint8Array): Promise<MaskOutcome>
  export async function verifyMasked(format: MaskFormat, bytes: Uint8Array): Promise<{ ok: true } | { ok: false; part: string; rule: RuleId }>
  ```

- [ ] **Step 1: Write the failing tests:**
  - csv/tsv/md/txt: whole text masked; UTF-8 BOM preserved; html: text nodes and attribute
    values (`href="mailto:…"`, `href="tel:010…"`) masked, tags untouched.
  - `maskFileName('홍길동 010-1234-5678 이력서.docx')` → `홍길동 [전화번호] 이력서.docx`.
  - `verifyMasked`: a docx whose `word/unknownPart.xml` holds `010-1234-5678` → `{ ok: false, part: 'word/unknownPart.xml', rule: 'phone' }`;
    a UTF-16LE text in `foo.bin` → caught; a png containing the bytes is skipped.
  - `maskDocument` returns `residual` (never `ok`) for that docx; `encrypted` for the CFB docx;
    `parse` for random bytes named `.docx`; `unsupported` for `.hwp`, `.pdf`, `.xlsm`, `.xls`, `.json`.
  - Happy path per format returns `ok` and `verifyMasked(ok.bytes)` is `ok`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** `verifyMasked` per Spec §4: every entry except media extensions
  (`png jpg jpeg gif bmp tif tiff emf wmf ico webp mp3 mp4 wav avi mov ttf otf woff woff2 odttf fntdata`)
  is checked: XML parts of a known family by `xmlParagraphTexts` plus tag-stripped text, any other
  entry decoded as UTF-8 and as UTF-16LE. Plain formats: `detectSensitive` on the masked text.
  `maskDocument` = format dispatch → masker → `verifyMasked`; any throw → `parse`.
- [ ] **Step 4: Run** `npm run test -w @genoffice/doc-mask` and `npx tsc --noEmit -p packages/doc-mask` — Expected: PASS, no errors.
- [ ] **Step 5: Commit** `feat(doc-mask): verify every part before a masked copy may leave`

### Task 7: Save origin through the document-saved hooks

**Files:**
- Modify: `apps/docs/src/main/docs-main.ts:4092-4101` and every `notifyDocumentSaved` call;
  `docs:save-new` handler (~4774) gains an `origin` argument; `apps/docs/src/preload/index.ts:138`;
  `apps/docs/src/renderer/file-actions.ts:~1037` and the other `saveDocxNew` callers
  (`writeRecoveryCopy`, `applyAiDocContent` in `App.tsx`)
- Modify: same hook in `slides-main.ts:448`, `sheets-main.ts:1978`, `markdown-main.ts:461`,
  `html-main.ts:902`, `pdf-main.ts:695`; `hwp-main.ts:385` (`onSaved`)
- Modify: `apps/shell/src/main/index.ts:3593-3598, ~617` (still forward only `path` to the work wiki)
- Test: one test per app next to its existing main tests (e.g. `apps/docs/tests/save-origin.test.ts`),
  `apps/shell/tests/document-saved-hook.test.ts` (update the regex)

**Interfaces:**
- Produces (defined identically in each app's main, no shared import needed):
  ```ts
  export type SaveOrigin = 'user' | 'auto' | 'agent'
  set<App>DocumentSavedHook(fn: ((filePath: string, origin: SaveOrigin) => void) | null): void
  // hwp: onSaved?: (webContentsId: number, path: string, origin: SaveOrigin) => void
  ```
  Mapping: `docs:save` auto→'auto' else 'user'; `docs:save-as`→'user'; `docs:save-new` origin
  argument, default `'auto'` when absent; `docs:save-to`→'agent'; slides `slides:save` auto→'auto'
  else 'user', save-as→'user', `saveSessionDeckTo`→'agent'; sheets `request.quiet`→'auto', MCP
  paths→'agent', else 'user'; markdown/html/pdf `auto`→'auto' else 'user'; hwp `hwp:save`→'user'
  (no autosave; any AI/MCP write path that calls `onSaved` → 'agent').

- [ ] **Step 1: Write the failing tests**: for each app, call the handler logic (or the exported
  notify path as existing tests do) and assert the hook receives `'auto'` for an autosave and
  `'user'` for a plain save. Docs (Review Focus 5): the renderer's user Save of an untitled
  document calls `saveDocxNew(name, data, 'user')`; `writeRecoveryCopy` and `applyAiDocContent`
  call it with `'auto'` / `'agent'` (assert by source inspection like `document-saved-hook.test.ts`
  if the renderer is not unit-testable).
- [ ] **Step 2: Run** each app's tests (`npm run test -w @genoffice/docs` etc.) — Expected: FAIL.
- [ ] **Step 3: Implement.** Before changing, list every caller of each save IPC in each renderer
  and classify it; record the list in the ledger. Any caller you cannot classify → `'agent'`
  (not collected).
- [ ] **Step 4: Run** all touched apps' tests and `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: document-saved hooks report whether the user saved`

### Task 8: Collector, target paths and outbox (fake delivery)

**Files:**
- Create: `apps/shell/src/main/nas-collect/{kinds.ts,target.ts,outbox.ts,collector.ts}`
- Modify: `apps/shell/package.json` dependency `@genoffice/doc-mask`
- Test: `apps/shell/tests/nas-collect.test.ts`

**Interfaces:**
- Consumes: `maskDocument`, `maskFileName`, `formatOf` (Task 6); `SaveOrigin` (Task 7)
- Produces:
  ```ts
  export type KindFolder = 'Word' | '한글' | 'PowerPoint' | 'Excel' | 'Markdown' | 'HTML'
  export function collectKind(filePath: string): KindFolder | null
  export function targetSegments(o: { installId: string; savedAt: Date; kind: KindFolder; sourcePath: string; fileName: string }): string[]
  //  → [installId, 'YYYY-MM-DD' (local), kind, `${maskedBase} (${sha1(sourcePath).slice(0,6)})${ext}`]
  export interface NasClient { writeFile(segments: string[], data: Uint8Array): Promise<void> }   // creates folders, temp name then rename
  export interface Outbox { add(job: OutboxJob, data: Uint8Array): Promise<void>; list(): Promise<OutboxJob[]>; read(id: string): Promise<Uint8Array>; remove(id: string): Promise<void> }
  export interface OutboxJob { id: string; segments: string[]; createdAt: number; size: number }
  export function createOutbox(dir: string, limits?: { maxJobs: number; maxBytes: number }): Outbox  // defaults 200 jobs, 1 GiB, oldest dropped
  export function createNasCollector(deps: {
    installId: string; outbox: Outbox; client: () => NasClient; now?: () => Date
    readFile?: (p: string) => Promise<Uint8Array>; log?: (line: string) => void
    debounceMs?: number /*5000*/; retryMs?: number /*600000*/; maxFileBytes?: number /*100 MiB*/
  }): { documentSaved(path: string, origin: SaveOrigin): void; flush(): Promise<void>; stop(): void }
  ```

- [ ] **Step 1: Write the failing tests** (fake timers, temp dir, fake `NasClient`):
  - `collectKind`: each extension in Global Constraints maps to its folder; `.hwp`, `.pdf`,
    `.xls`, `.xlsm`, `.json` → `null`.
  - `targetSegments`: date is local (`new Date(2026, 9, 28, 23, 59)` → `2026-10-28`), name keeps
    the extension, phone in the name masked, two different source paths with the same name give
    different suffixes, same path gives the same name.
  - `documentSaved(p, 'auto')` and `'agent'` → nothing written; `'user'` twice within 5 s → one
    mask and one delivery.
  - Delivery failure (client throws) → job stays in outbox, no throw escapes; next retry tick
    delivers and removes it (Review Focus 4).
  - `maskDocument` → `residual`/`parse` → nothing enqueued, log line contains path, kind, part,
    rule and NOT the number (assert the log never contains `010-1234-5678`).
  - File over `maxFileBytes` → skipped.
  - A collector created over a non-empty outbox attempts delivery at once (retry on app start).
  - Outbox persists across a new `createOutbox` on the same dir; over `maxJobs` the oldest is
    dropped; outbox files only ever hold masked bytes.
- [ ] **Step 2: Run** `npm run test -w @genoffice/shell -- nas-collect` — Expected: FAIL.
- [ ] **Step 3: Implement.** Outbox layout: `<dir>/<id>.bin` + `<dir>/queue.json` (atomic write
  via `apps/shell/src/main/app-settings.ts`'s pattern or electron-utils `atomicWriteFile`).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(shell): collect masked user saves into an outbox`

### Task 9: SMB client (spike first, needs the NAS set up)

**STOP before Step 1 and ask the user**: creating the `genoffice` folder and the upload account on
the NAS is a change to company infrastructure. With the user's yes, in the NAS management UI
(admin account the user gave in chat, never written to a file): Folder management → new folder
`genoffice` on HDD1, Windows sharing on; User management → new user (e.g. `genoffice-upload`,
no admin right, home folder off) with read-write on `genoffice` only. Touch nothing else. The
upload password goes to the user, not into the repo.

**Files:**
- Create: `apps/shell/src/main/nas-collect/smb-client.ts`
- Modify: `apps/shell/package.json` (the chosen library)
- Test: `apps/shell/tests/nas-smb-client.test.ts` (unit, with the library mocked); live check script
  kept untracked in `scripts/drivers/`

**Interfaces:**
- Consumes: `NasClient` (Task 8)
- Produces: `export function createSmbNasClient(cfg: { host: string; share: string; user: string; password: string }): NasClient`

- [ ] **Step 1: Spike.** Candidate: `@marsaud/smb2` (SMB2, NTLMv2, no Windows redirector).
  Untracked script: connect with the upload account, `mkdir` nested folders, write
  `_spike/<random>.txt` under a temp name, rename, read back, delete. Run it **while this PC has
  an open connection to the same NAS under another account** (`net view \\<host>` or an open
  `Home.*` share in Explorer) and confirm that connection is unaffected (`net use` before/after
  identical). If the candidate fails (auth, SMB dialect), try the next library; if none works,
  stop and report to the user. Record the result in the ledger. Remove `_spike/`.
- [ ] **Step 2: Write the failing unit tests**: `writeFile(['id','2026-10-28','Word','a (abc123).docx'], data)`
  creates missing folders in order, writes `…/.a (abc123).docx.tmp-<rand>`, renames over the final
  name (existing final name replaced), deletes the temp file on failure, closes the connection;
  credentials never appear in thrown error messages.
- [ ] **Step 3: Run** — Expected: FAIL.
- [ ] **Step 4: Implement** `smb-client.ts` with the spiked library.
- [ ] **Step 5: Run** unit tests — Expected: PASS.
- [ ] **Step 6: Commit** `feat(shell): deliver collected documents to the NAS over SMB`

### Task 10: Build config, Settings statement, wiring

**Files:**
- Modify: `apps/shell/src/main/org-defaults.ts` — add
  ```ts
  export interface OrgNas { host: string; share: string; user: string; password: string }
  export function parseOrgNas(raw: unknown): OrgNas | null   // raw.nas; all four non-empty strings ≤ 300 chars; host without scheme/slashes
  export function readOrgNas(path: string): OrgNas | null
  ```
- Modify: `apps/shell/electron-builder.cjs:87-100` — write `build/org-defaults.json` when the
  LiteLLM pair **or** all four `OPEN_GENOFFICE_NAS_*` are set, merging `{ ai?, nas? }`;
  `shipOrgDefaults` true in either case.
- Modify: `apps/shell/src/main/index.ts` — at startup, when `readOrgNas(orgDefaultsPath)` is
  non-null: `startNasCollection({ installId: ensureAnalyticsClientState(settingsPath).clientId, outboxDir: join(userData,'nas-outbox'), nas })`;
  hooks become `(path, origin) => { workWikiDocumentSaved(path); nasDocumentSaved(path, origin) }`
  (hwp `onSaved` likewise); stop on quit. The Settings view payload (~6524) gains
  `nasCollection: boolean`.
- Create: `apps/shell/src/main/nas-collect/index.ts` (`startNasCollection`, `nasDocumentSaved`,
  `stopNasCollection`)
- Modify: `apps/shell/src/renderer/src/SettingsModal.tsx` (+ strings) — the statement from Global
  Constraints, read-only, only when `nasCollection` is true.
- Test: `apps/shell/tests/org-defaults.test.ts` (extend), `tests/document-saved-hook.test.ts`
  (hooks feed both), a renderer test for the statement following existing Settings tests.

- [ ] **Step 1: Write the failing tests:** `parseOrgNas` accepts a full block, rejects missing
  fields, a `\\host` or `smb://` host, over-long values; `orgDefaultsView` output contains no NAS
  field (the password never reaches the renderer — assert `JSON.stringify(view)` lacks it);
  Settings shows the exact statement when `nasCollection` is true and nothing when false; every
  hook registration forwards to both `workWikiDocumentSaved` and `nasDocumentSaved`.
- [ ] **Step 2: Run** `npm run test -w @genoffice/shell` — Expected: the new tests FAIL (pre-existing
  failures headless-export, default-app, folder-tree are unrelated; note them, do not fix).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** shell tests, `npm run typecheck`, `npm run lint` — Expected: new tests PASS, 0 type/lint errors.
- [ ] **Step 5: Commit** `feat(shell): collect masked user saves on the company NAS`
- [ ] **Step 6:** Add an entry to `MODIFICATIONS.md` (what, why, where the config comes from) and
  commit `docs: NAS template collection in MODIFICATIONS`.

### Task 11: End-to-end check against the NAS

- [ ] **Step 1:** Run the dev app with a temp profile and `OPEN_GENOFFICE_ORG_DEFAULTS` pointing at
  an untracked org-defaults.json in the scratchpad holding the upload account. Back up and restore
  LLM Wiki `app-state.json` around the run.
- [ ] **Step 2:** In Word, Hangul (hwpx), PowerPoint, Excel, Markdown and HTML: create a document
  containing one of each number type plus a date, an amount, a name and an address; Ctrl+S.
  Also leave one Word document to autosave only.
- [ ] **Step 3:** Within a minute, list `\\<host>\genoffice\<installId>\<today>\` with the upload
  account: one file per kind, named with the suffix; open each masked file in its editor: numbers
  replaced by placeholders, date/amount/name/address present, formatting as in the original. The
  autosave-only document is absent.
- [ ] **Step 4:** Disconnect the network (or point host at an unreachable address), save, confirm
  the save is instant and the job sits in `nas-outbox`; reconnect, confirm delivery.
- [ ] **Step 5:** Delete the test install's folder on the NAS (only `genoffice/<that installId>`),
  remove the temp profile and the scratch org-defaults file.
