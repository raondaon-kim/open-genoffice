// From IeumOffice (pblsketch/openoffice) apps/pdf/src/renderer/i18n/notes/it.ts, 6c33de7a.
import type { zh } from './zh'

export const it = {
  ntOpen: 'Apri nota',
  ntOpenTip: 'Apri la nota Markdown collegata a questo PDF',
  ntInsert: 'Aggiungi alla nota',
  ntInsertTip: 'Aggiunge questo in fondo alla nota. Salvala nella sua scheda',
  ntSaveFirst: 'Salva prima il PDF',
  ntUnavailable: 'Le note si aprono solo nell’app GenOffice',
  ntFailed: 'Impossibile aprire la nota. {reason}',
  ntInserted: 'Aggiunto alla nota',
} satisfies Record<keyof typeof zh, string>
