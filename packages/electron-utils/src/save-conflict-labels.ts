import { createI18n, defineStrings, normalizeLang } from '@genoffice/i18n'

/**
 * Wording for the same-document save conflict prompt raised by
 * save-conflict.ts. The sentences say the same as the Word editor's
 * external-modification prompt (apps/docs `extModifiedMsg`,
 * `extModifiedDetail`, `btnOverwrite`, `btnCancel`), translated here for the
 * editors that share this guard. Going through createI18n keeps the repo
 * conventions: the product name is swapped into the template at output time.
 *
 * `zh` defines the key set; every other language must cover exactly the same
 * keys (compile-time checked).
 */
const zh = {
  message: '文件已被其他程序修改。',
  detail: '仍要保存并覆盖磁盘上的更改吗?',
  overwrite: '覆盖',
  cancel: '取消',
}

type Keys = Record<keyof typeof zh, string>

export const SAVE_CONFLICT_STRINGS = defineStrings({
  zh,
  en: {
    message: 'The file has been modified by another program.',
    detail: 'Save anyway and overwrite the changes on disk?',
    overwrite: 'Overwrite',
    cancel: 'Cancel',
  } satisfies Keys,
  ja: {
    message: 'このファイルは別のプログラムによって変更されています。',
    detail: 'このまま保存してディスク上の変更を上書きしますか?',
    overwrite: '上書き',
    cancel: 'キャンセル',
  } satisfies Keys,
  ko: {
    message: '이 파일이 다른 프로그램에서 수정되었습니다.',
    detail: '그래도 저장하여 디스크의 변경 사항을 덮어쓸까요?',
    overwrite: '덮어쓰기',
    cancel: '취소',
  } satisfies Keys,
  fr: {
    message: 'Le fichier a été modifié par un autre programme.',
    detail: 'Enregistrer quand même et écraser les modifications sur le disque ?',
    overwrite: 'Écraser',
    cancel: 'Annuler',
  } satisfies Keys,
  de: {
    message: 'Die Datei wurde von einem anderen Programm geändert.',
    detail: 'Trotzdem speichern und die Änderungen auf dem Datenträger überschreiben?',
    overwrite: 'Überschreiben',
    cancel: 'Abbrechen',
  } satisfies Keys,
  es: {
    message: 'El archivo ha sido modificado por otro programa.',
    detail: '¿Guardar de todos modos y sobrescribir los cambios en el disco?',
    overwrite: 'Sobrescribir',
    cancel: 'Cancelar',
  } satisfies Keys,
  th: {
    message: 'ไฟล์ถูกแก้ไขโดยโปรแกรมอื่น',
    detail: 'บันทึกต่อไปและเขียนทับการเปลี่ยนแปลงบนดิสก์หรือไม่?',
    overwrite: 'เขียนทับ',
    cancel: 'ยกเลิก',
  } satisfies Keys,
  id: {
    message: 'File telah diubah oleh program lain.',
    detail: 'Tetap simpan dan timpa perubahan di disk?',
    overwrite: 'Timpa',
    cancel: 'Batal',
  } satisfies Keys,
  ru: {
    message: 'Файл был изменён другой программой.',
    detail: 'Всё равно сохранить и перезаписать изменения на диске?',
    overwrite: 'Перезаписать',
    cancel: 'Отмена',
  } satisfies Keys,
  ar: {
    message: 'تم تعديل الملف بواسطة برنامج آخر.',
    detail: 'هل تريد الحفظ على أي حال والكتابة فوق التغييرات على القرص؟',
    overwrite: 'استبدال',
    cancel: 'إلغاء',
  } satisfies Keys,
  pt: {
    message: 'O arquivo foi modificado por outro programa.',
    detail: 'Salvar mesmo assim e sobrescrever as alterações no disco?',
    overwrite: 'Sobrescrever',
    cancel: 'Cancelar',
  } satisfies Keys,
  it: {
    message: 'Il file è stato modificato da un altro programma.',
    detail: 'Salvare comunque e sovrascrivere le modifiche sul disco?',
    overwrite: 'Sovrascrivi',
    cancel: 'Annulla',
  } satisfies Keys,
  pl: {
    message: 'Plik został zmodyfikowany przez inny program.',
    detail: 'Zapisać mimo to i nadpisać zmiany na dysku?',
    overwrite: 'Nadpisz',
    cancel: 'Anuluj',
  } satisfies Keys,
  cs: {
    message: 'Soubor byl změněn jiným programem.',
    detail: 'Přesto uložit a přepsat změny na disku?',
    overwrite: 'Přepsat',
    cancel: 'Zrušit',
  } satisfies Keys,
  nl: {
    message: 'Het bestand is door een ander programma gewijzigd.',
    detail: 'Toch opslaan en de wijzigingen op schijf overschrijven?',
    overwrite: 'Overschrijven',
    cancel: 'Annuleren',
  } satisfies Keys,
  ms: {
    message: 'Fail telah diubah oleh program lain.',
    detail: 'Simpan juga dan tulis ganti perubahan pada cakera?',
    overwrite: 'Tulis Ganti',
    cancel: 'Batal',
  } satisfies Keys,
  he: {
    message: 'הקובץ שונה על ידי תוכנית אחרת.',
    detail: 'לשמור בכל זאת ולדרוס את השינויים בדיסק?',
    overwrite: 'דרוס',
    cancel: 'ביטול',
  } satisfies Keys,
  hi: {
    message: 'फ़ाइल को किसी अन्य प्रोग्राम ने बदल दिया है।',
    detail: 'फिर भी सहेजें और डिस्क पर मौजूद बदलावों को अधिलेखित करें?',
    overwrite: 'अधिलेखित करें',
    cancel: 'रद्द करें',
  } satisfies Keys,
  'zh-TW': {
    message: '檔案已被其他程式修改。',
    detail: '仍要儲存並覆寫磁碟上的變更嗎?',
    overwrite: '覆寫',
    cancel: '取消',
  } satisfies Keys,
  vi: {
    message: 'Tệp đã được sửa đổi bởi một chương trình khác.',
    detail: 'Vẫn lưu và ghi đè các thay đổi trên ổ đĩa?',
    overwrite: 'Ghi đè',
    cancel: 'Hủy',
  } satisfies Keys,
})

const t = createI18n(SAVE_CONFLICT_STRINGS)

export interface SaveConflictLabels {
  message: string
  detail: string
  overwrite: string
  cancel: string
}

/** The four prompt strings in the given UI language (raw locale tags accepted). */
export function saveConflictLabels(lang: string): SaveConflictLabels {
  const loc = normalizeLang(lang)
  return {
    message: t(loc, 'message'),
    detail: t(loc, 'detail'),
    overwrite: t(loc, 'overwrite'),
    cancel: t(loc, 'cancel'),
  }
}
