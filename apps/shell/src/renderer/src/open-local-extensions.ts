/* Formats the open-local card advertises. Too long for the card at any window
   width, so it ellipsizes and a hover ScreenTip carries the full list. Keep in
   sync with the main-process open-dialog filter (OPEN_DIALOG_EXTENSIONS);
   tests/file-associations.test.ts checks that every app is named. */
export const OPEN_LOCAL_EXTENSIONS =
  '.docx / .xlsx / .xlsm / .xls / .csv / .tsv / .pptx / .pdf / .md / .html / .hwp / .hwpx'
