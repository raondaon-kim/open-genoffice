import type { ReactElement } from 'react'
import { AttachmentWikiButton } from '@genoffice/ui'
import type { HwpAttachment } from '../../shared/ipc'
import filePdfIcon from '../assets/file-pdf.png'
import fileWordIcon from '../assets/file-word.png'
import fileExcelIcon from '../assets/file-excel.png'
import filePptIcon from '../assets/file-ppt.png'
import fileDocumentIcon from '../assets/file-document.png'
import fileGeneralIcon from '../assets/file-general.png'

/** file-type icons, the same set as the other editors' attachment cards */
const CARD_ICONS: Record<string, string> = {
  pdf: filePdfIcon,
  doc: fileWordIcon,
  docx: fileWordIcon,
  xls: fileExcelIcon,
  xlsx: fileExcelIcon,
  csv: fileExcelIcon,
  ppt: filePptIcon,
  pptx: filePptIcon,
  hwp: fileDocumentIcon,
  hwpx: fileDocumentIcon,
  txt: fileDocumentIcon,
  md: fileDocumentIcon,
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(2)} KB`
}

/**
 * One attachment above the composer, as the other editors draw it: type icon tile, name (ellipsized
 * by CSS) and size, the "add to work material" button, and the round remove badge.
 */
export function AttachmentCard({
  attachment,
  lang,
  removeLabel,
  disabled,
  onRemove,
  onFailure,
}: {
  attachment: HwpAttachment
  lang: 'en' | 'ko'
  removeLabel: string
  disabled: boolean
  onRemove: (path: string) => void
  onFailure: (message: string) => void
}): ReactElement {
  return (
    <span className="ai-attachment-card" data-tip={attachment.path}>
      <span className="ai-attachment-card-icon">
        <img src={CARD_ICONS[attachment.ext] ?? fileGeneralIcon} alt="" aria-hidden />
      </span>
      <span className="ai-attachment-card-meta">
        <span className="ai-attachment-card-name">{attachment.name}</span>
        <span className="ai-attachment-card-size">{formatSize(attachment.sizeBytes)}</span>
      </span>
      <AttachmentWikiButton
        path={attachment.path}
        name={attachment.name}
        lang={lang}
        api={window.workWiki}
        onResult={(_r, failure) => {
          if (failure) onFailure(failure)
        }}
      />
      <button
        type="button"
        className="ai-attachment-thumb-remove"
        disabled={disabled}
        onClick={() => onRemove(attachment.path)}
        data-tip={removeLabel}
        aria-label={removeLabel}
      >
        <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
          <path
            d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="0.25"
          />
        </svg>
      </button>
    </span>
  )
}
