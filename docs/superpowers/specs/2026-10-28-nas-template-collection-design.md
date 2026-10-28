# Collecting saved documents on the company NAS, masked, as a template library

> **Status (2026-10-28):** only the masking package (`packages/doc-mask`, plan Tasks 1–6) and the save-origin hooks (Task 7) were built. Collection and delivery to the NAS (Tasks 8–11: collector, outbox, SMB client, build config, Settings statement, wiring) are on hold and nothing sends documents anywhere. Before resuming: the company's privacy/security owner should confirm how employees are told about the collection (a statement in Settings only was judged too weak; names and addresses are not masked).

## Intent

The company wants a library of its own documents to learn its document formats from later:
heading levels, fonts and sizes, paragraph spacing, table shapes, page margins, headers and
footers, numbering schemes ("1. → 가. → 1)"). The library builds itself from what people already
write: when a user saves a document in a company build of GenOffice, a copy goes to a folder on
the company NAS, with phone numbers, resident registration numbers, e-mail addresses, business
registration numbers and account numbers replaced by placeholders like `[전화번호]`.

What is learned is the form, not the content. So the copy keeps the original file format and
every bit of formatting; only the characters of a detected number change. A placeholder in place
of a number is itself useful to a template: it says "a phone number goes here".

## Goals

- Every document a user saves by hand in a company build reaches the NAS, masked, within minutes
  when the NAS is reachable, and later when it is not.
- The masked copy opens in its own editor and looks like the original except for the masked
  numbers.
- The NAS folder is organised per user, per day, per document kind.

## Non-goals

- Names and addresses stay (user's decision, 2026-10-28: "이름과 주소는 일단 남겨두자"). No AI
  detection; every rule is deterministic.
- Text inside images (a scanned business registration certificate, a screenshot) is not masked.
- Legacy binary `.hwp`, PDF, and password-protected documents are not sent in this version (my
  call: `.hwp` cannot be rewritten in place by an XML walk, PDF is a poor template source, and a
  password says the user locked the document on purpose).
- Learning from the library is a later project.
- Upstream (non-company) builds: the feature does not exist there; without the build setting
  nothing is registered and no setting is shown.

## Anti-goals (a failure even if it technically works)

- **A copy with a detectable number reaches the NAS.** When masking cannot be completed or
  verified, the copy is not sent. Never "send unmasked rather than nothing".
- **Saving gets slower or can fail because of the NAS.** The user's save finishes exactly as
  today; collection runs afterwards in the background, and its errors never reach the editor.
- **Existing NAS folders or the user's own NAS connections are touched.** Employees have their
  own `Home.<id>` shares on the same NAS and may be connected to them with their own account
  (see "SMB connection" below).
- **The admin account ships in the app.** A dedicated account with access to the new folder only
  is used.
- **Autosave floods the NAS.** Autosaves every 30 s are not sent.

## Decisions taken with the user (2026-10-28)

| Topic | Decision |
|---|---|
| Purpose | Template library for learning company document formats |
| Where | A new folder `genoffice` on the NAS; existing folders untouched |
| Layout | `genoffice/<user folder>/<YYYY-MM-DD>/<kind>/<file>` |
| User folder | A random id now (the existing install id); an e-mail or similar later |
| What is masked | Personal: resident registration no., mobile phone, e-mail. Company: phone/fax, business registration no., account no. |
| What stays | Names, addresses |
| Telling users | A short statement in Settings only. No first-run notice, no off switch in company builds |
| Which saves | Only saves the user starts (incl. the first save of a new document); not autosave, not the AI's or an agent's own saves |

The user was advised that a statement only in Settings is weak notice and that the company's
security rules or consent form should also cover the collection; that is the company's to do.

## The NAS (surveyed 2026-10-28, read-only)

- ipTIME NAS1dual (management UI 1.4.74). Windows file sharing (SMB) is on, SMB1 and SMB2 both
  allowed, network recycle bin on. WebDAV is off, FTP is closed. The management UI is on port 80.
- Folders on HDD1: `Data`, `Media`, `LogFiles`, `새폴더`, one `Home.<id>` per employee (admin +
  that employee have access), copies on USB1/USB2. No `genoffice` folder yet.
- ipTIME folder permissions are read-write or read-only per user/group; there is no write-only.
  The dedicated account can therefore read and delete other users' masked copies inside
  `genoffice`; it has no access to any other folder.
- **Setup on the NAS** (done once, by hand or by us with the user's yes, through the management
  UI): create folder `genoffice` on HDD1 with Windows sharing on; create user account (e.g.
  `genoffice-upload`, no admin right, no home folder) with read-write on `genoffice` only.

The NAS address, share name, account and password are never written to a tracked file. Like the
LiteLLM address they come from the build environment (`OPEN_GENOFFICE_NAS_HOST`, `_SHARE`,
`_USER`, `_PASSWORD`), go into the gitignored `build/org-defaults.json` (written by
`apps/shell/electron-builder.cjs`, read by `apps/shell/src/main/org-defaults.ts`) and ship next to
the resources. The release installer is public, so anyone can extract the account; the NAS is
reachable only from the office network, and the account reaches only `genoffice`.

## How it fits the existing code

Facts from the code survey (paths in `D:\genoffice-next`):

- **One post-save point already exists.** Every editor's main module calls a "document saved"
  hook after a successful write: `setDocsDocumentSavedHook`, `setSlides…`, `setSheets…`,
  `setPdf…`, `setMarkdown…`, `setHtml…` wired at `apps/shell/src/main/index.ts:~3593-3598`, and
  the Hangul runtime's `onSaved` at `~617-624`. Today they all feed the work wiki
  (`workWikiDocumentSaved`, `apps/shell/src/main/work-wiki.ts:434`), which mirrors saved files with
  debounce, content hash and atomic writes (`packages/work-wiki/src/node/mirror.ts`): the closest
  precedent.
- **The hooks do not say whether a save was an autosave.** The flag exists in main: `auto` for
  docs (`docs:save`), slides, markdown, html and pdf; `request.quiet` for sheets; Hangul has no
  autosave. The AI's silent first save of an untitled Word document (`docs:save-new`) has no flag
  and counts as automatic. The hooks must carry `{ auto: boolean }`; the work wiki ignores it.
- **Word password protection**: the bytes on disk are encrypted. Collection reads the file, and an
  encrypted docx is skipped (non-goal above).
- **Install id**: `analyticsClientId` (random UUID in `app-settings.json`,
  `apps/shell/src/main/analytics.ts:80-102`) is the user folder name for now. Collection must not
  depend on analytics being enabled: if the id is absent it is created the same way.
- **Formatting-preserving replacement exists for Word**: `packages/docx-engine/src/text-patch.ts`
  maps a change in a paragraph's joined text back onto the `w:t` pieces that hold it (first piece
  takes the new text, the rest become empty, run properties untouched). It is not exported from
  the package today. Hangul hwpx (`hp:p`/`hp:run`/`hp:t`) and PowerPoint (`a:p`/`a:r`/`a:t`) need
  the same algorithm on their element names; Excel needs shared strings and inline strings.
- **Existing masking rules** (`packages/work-wiki/src/node/mask.ts`) cover only resident and card
  numbers and accounts after the word 계좌. The new detector supersedes them; the work wiki may
  adopt it later (not in scope).
- No SMB library is in the repo; zip handling is jszip and docx-engine's `zip-splice`.

## The design

### 1. Trigger

On a user save (not autosave) of a file whose kind is collected:

| Kind (`TabKind`) | Extensions collected | Kind folder |
|---|---|---|
| docs | `.docx` | `Word` |
| hwp | `.hwpx` | `한글` |
| slides | `.pptx` | `PowerPoint` |
| sheets | `.xlsx`, `.csv`, `.tsv` | `Excel` |
| markdown | `.md`, `.markdown`, `.txt` | `Markdown` |
| html | `.html`, `.htm` | `HTML` |

Not collected: `.hwp`, `.pdf`, `.xls`, `.xlsm`, `.json`, encrypted docx.

"A user save" means a save the user started (Ctrl+S, the Save button, Save As), including the
first save of an untitled document. In Word that first save goes through `docs:save-new`, which
also serves the recovery tick's silent save (`writeRecoveryCopy`) and the AI's `create_document`
(`applyAiDocContent`); the save's origin must therefore be passed from the renderer through
`docs:save-new` (and the other silent paths) down to the hook, not inferred from the handler.
MCP saves (`docs:save-to`, `saveSessionDeckTo`, …) are agent saves.

Only user saves are collected (user's decision, 2026-10-28: "사용자가 저장한 문서만 모으자").
Autosaves, recovery saves, the AI's silent saves and MCP/agent saves are not. A document the AI
wrote is collected once the user saves it themselves. Saves inside the app's own data
folders (temp files of untitled sheets, recovery copies) never reach the hook today and must not.

The hook only records the job (path, kind, save time); the work runs after the save returned,
debounced per path (several saves within a few seconds → one job).

### 2. Mask

For each kind, open the saved file, replace detected numbers in the text, write a new file of the
same format to a local outbox. Formatting, images, styles and every non-text part are copied
byte for byte.

Text that must be covered, per format:

- **docx**: `word/document.xml`, `header*.xml`, `footer*.xml`, `footnotes.xml`, `endnotes.xml`,
  `comments.xml`; inside them `w:t`, `w:delText` (tracked deletions), `w:instrText` (e.g. a
  `mailto:` field), text boxes. Hyperlink targets in `*.rels` (`mailto:`, `tel:`).
- **hwpx**: every `Contents/section*.xml`, `hp:t` inside `hp:run`, including headers, footers,
  footnotes, text boxes and table cells (all of which live in the section XML); `Preview/PrvText.txt`
  (a plain-text preview of the document) is masked too.
- **pptx**: `ppt/slides/*.xml`, `ppt/notesSlides/*.xml`, `ppt/slideLayouts`/`slideMasters` text,
  chart and SmartArt text (`ppt/charts`, `ppt/diagrams`), `a:t`.
- **xlsx/xlsm**: `xl/sharedStrings.xml` (plain and rich `si`), inline strings in
  `xl/worksheets/*.xml`, comments (`xl/comments*.xml`, threaded comments), header/footer text.
  Numbers stored as numeric cells (e.g. a phone number typed without hyphens and kept as a
  number) are cell values, not strings: a numeric cell whose value matches a rule as a digit
  string is masked by turning it into a string cell holding the placeholder.
- **csv/tsv, md, txt, html**: the whole text (html: text nodes and attribute values such as
  `href="mailto:…"`, `tel:`).
- **All formats**: document properties (`docProps/core.xml`, `app.xml`, custom properties; hwpx
  `Contents/content.hpf`) are scanned like body text. The file name is masked with the same rules.

Matching runs on a paragraph's joined text (a number is often split across runs:
`010-` `1234-5678`), and the replacement is mapped back onto the pieces as `text-patch.ts` does.

**Other parts that carry copies of the text** (my call, from the builder check):

- Masked like the parts above: chart caches (`c:strCache`, `c:v` string points) in all formats;
  embedded workbooks (`*/embeddings/*.xlsx`) by running the xlsx masker on them recursively;
  Excel pivot cache records and definitions (string items), defined names, data-validation lists,
  string literals in formulas; Word `customXml/item*.xml` text nodes (data-bound content controls
  refill from there) and the glossary part; PowerPoint comments and notes masters.
- Removed: preview thumbnails (`docProps/thumbnail.*`, hwpx `Preview/PrvImage.png`) — pictures of
  the document's own first page. The relationship/manifest entry goes with the file so the
  package stays valid.
- `.xlsm` is dropped from the collected list: its macro part (`vbaProject.bin`) can hold text
  that cannot be masked without breaking it.
- Anything else is handled by the verification gate (§4): it does not rely on this list.

### 3. Detection rules

Deterministic, in one module with its own tests. Placeholders:

| Rule | Examples | Placeholder |
|---|---|---|
| Resident registration no. | `900101-1234567`, `9001011234567` | `[주민번호]` |
| Foreigner registration no. | same shape, 7th digit 5–8 | `[주민번호]` |
| Mobile phone | `010-1234-5678`, `01012345678`, `010 1234 5678`, `+82 10-1234-5678` | `[전화번호]` |
| Landline / fax / rep. number | `02-123-4567`, `031-1234-5678`, `070-…`, `1588-1234`, `(02) 123-4567` | `[전화번호]` |
| E-mail | `name@company.co.kr` | `[이메일]` |
| Business registration no. | `123-45-67890` (checksum valid) | `[사업자번호]` |
| Corporate registration no. | `110111-1234567` | `[법인번호]` |
| Account no. | after a bank name or 계좌/예금주/입금 within the same line or table row, and long hyphenated digit groups (10–16 digits in 3–4 groups) that match no other rule | `[계좌번호]` |
| Card no. | 16 digits in 4 groups (Luhn valid) | `[카드번호]` |

Guidance for the rules:

- Resident numbers issued since October 2020 have no valid check digit; use the shape and a
  valid birth date, not the checksum. Business registration numbers do have one: use it.
- **Must stay unmasked**: dates (`2026-10-28`, `2026.10.28`), amounts (`1,250,000`, `1250만 원`),
  times, percentages, page/section numbers, years, version numbers, legal article numbers. Each
  gets negative tests.
- When a digit group is ambiguous between "account" and "something else", mask it: an
  over-masked document number costs the template little; a leaked account costs a lot.

### 4. Verify, then send

After masking, check the masked file again, independently of the masker's part list:

- Every part of the package except known image/media types (png, jpg, gif, bmp, emf, wmf, svg is
  text and is checked, fonts, audio/video) is read as text — XML with tags stripped and per
  paragraph joined where the format is known, any other part decoded as UTF-8 and as UTF-16LE —
  and the detectors run on it.
- Any hit, in any part → the job fails, nothing is sent, the failure is logged locally (path,
  kind, part name, rule name; never the matched text). The same happens when a file cannot be
  parsed. An unknown part that holds a number therefore blocks the document rather than leaking.

This gate is what enforces the first anti-goal; the masker only decides how many documents get
through.

### 5. Deliver

- Target: `\\<host>\<share>\<user folder>\<YYYY-MM-DD>\<kind folder>\<masked file name>`. The date
  is the local date of the save.
- Same source path saved again the same day → overwrite. Two different sources with the same
  file name never collide: every target name carries a short suffix derived from the source path
  (`보고서 (a1b2c3).docx`), so the name is stable per source without any record of what was sent
  (changed during planning from "only the second gets a suffix", which needed such a record).
- Write to a temporary name in the target folder, then rename (the NAS keeps a recycle bin).
- **SMB connection.** Employees may already be connected to this NAS with their own account;
  Windows allows one set of credentials per server name per logon session, so connecting with the
  upload account through the Windows redirector (`net use`, a UNC path with credentials) can fail
  with "multiple connections … not allowed" or, worse, disturb the user's own connection. The
  builder must pick a connection method that cannot collide (for example an SMB2 client in the
  main process that does not go through the Windows redirector) and prove it in a spike on this
  NAS before building on it. Never map a drive letter, never store the credentials in Windows
  Credential Manager, never disconnect anything.

### 6. Outbox and retries

- Masked copies wait in `userData/nas-outbox/` with a small JSON queue. Only masked copies are
  stored there.
- Retry on app start, on a timer while the app runs (e.g. every 10 minutes), and after the next
  successful send. A job that fails delivery keeps its file; a job that fails masking or
  verification is dropped (it would fail again).
- The outbox is bounded (count and total size); when full, the oldest jobs are dropped.
- Files over a size limit (e.g. 100 MB) are skipped.

### 7. Settings statement

In company builds where the NAS is configured, Settings shows a short, read-only statement, e.g.:

> 저장한 문서는 회사 문서 양식 학습을 위해 전화번호·계좌번호 등 개인·회사 식별 번호를 가린 뒤
> 회사 NAS에 보관됩니다.

No switch. The exact wording and the Settings section it sits in are the builder's call
(`apps/shell/src/renderer/src/SettingsModal.tsx`; the work wiki section is a neighbour).

## Left to the builder

- The SMB client and how credentials reach it (spike first, see §5).
- Module layout (e.g. a `packages/doc-mask` package for detection and per-format masking, and a
  shell main module for the queue and delivery).
- Debounce interval, retry interval, outbox limits, size limit.
- Whether the hook carries `{ auto }` as a second argument or an options object.
- Exact placeholder for ambiguous cases, as long as it is one of the table's.

## Testing expectations

- Detection: positive and negative cases for every rule, including the "must stay unmasked" list.
- Per format: a real file with numbers split across runs, in headers, footnotes, tables, notes,
  comments, tracked deletions, document properties; the masked file opens in its editor and its
  XML differs from the source only in the masked text.
- Verification gate: a planted number the masker misses blocks the send.
- Trigger: autosave and quiet saves do not enqueue; a user save does; untitled temp saves do not.
- Delivery against a fake target folder; a live check against the NAS with the dedicated account.
