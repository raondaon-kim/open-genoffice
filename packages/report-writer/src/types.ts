/** One piece of a written chapter, before an editor maps it onto its style's roles. */
export type ReportBlock =
  | {
      type: 'chapter' | 'section' | 'subsection' | 'paragraph' | 'bullet' | 'numbered'
      text: string
    }
  /** rows[0] is the header row */
  | { type: 'table'; rows: string[][] }

export interface Attachment {
  name: string
  text: string
}

/** a piece of an attachment the plan can assign to a chapter */
export interface AttachmentPart {
  /** `A{attachment}-{n}`, both 1-based */
  id: string
  attachment: string
  /** the heading, a page range (`p.3–5`) or `part n` */
  label: string
  text: string
}

export interface Brief {
  purpose: string
  reader: string
  messages: string[]
  terms: Record<string, string>
}

export interface PlannedChapter {
  no: number
  title: string
  /** the chapter's conclusion, one sentence */
  point: string
  /** topics only this chapter explains */
  owns: string[]
  stances: string[]
  sections: string[]
  attachmentParts: string[]
  wikiPages: string[]
}

export interface ReportPlan {
  brief: Brief
  title: string
  /** the attachment (e.g. an RFP) fixes the table of contents */
  tocFromAttachment: boolean
  chapters: PlannedChapter[]
}

export type LlmStatus = 'complete' | 'max_tokens' | 'empty' | 'error' | 'stopped'

export interface LlmReply {
  status: LlmStatus
  text: string
  error?: string
}

export type LlmPort = (req: {
  system: string
  user: string
  maxTokens: number
  signal?: AbortSignal
}) => Promise<LlmReply>

export interface WikiPort {
  catalog(query: string): Promise<string>
  index(category?: string): Promise<string>
  /** the page text, or null when there is no such page */
  read(id: string): Promise<string | null>
}

export interface Skeleton {
  title: string
  withSummary: boolean
  chapters: Array<{ no: number; title: string; sections: string[] }>
}

export interface Lander {
  skeleton(s: Skeleton): Promise<void>
  chapter(no: number, blocks: ReportBlock[]): Promise<void>
  chapterFailed(no: number, title: string): Promise<void>
  summary(blocks: ReportBlock[]): Promise<void>
  gaps(blocks: ReportBlock[]): Promise<void>
  /** remove the placeholders still open (cancel / fatal error) */
  abandon(): Promise<void>
  finish(): Promise<void>
}

export type ReportProgress =
  | { kind: 'reading' }
  | { kind: 'planning' }
  | { kind: 'chapter'; no: number; of: number; title: string }
  | { kind: 'chapter-failed'; no: number; title: string; error: string }
  | { kind: 'summary' }
  | { kind: 'done'; written: number; failed: number[] }
  | { kind: 'cancelled'; written: number }
  | { kind: 'error'; error: string }

export interface ReportRequest {
  request: string
  kind: 'report' | 'proposal'
  /** the style page's own rules and description */
  styleRules: string
  lengthHint?: string
  attachments: Attachment[]
}

export interface ReportPorts {
  llm: LlmPort
  wiki: WikiPort | null
  lander: Lander
  progress(e: ReportProgress): void
}

export type ReportOutcome =
  | { ok: true; written: number; failed: number[]; gaps: number }
  | { ok: false; error: string; written: number }
