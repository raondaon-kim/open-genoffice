import type { TeamErrorCode } from '../../shared/team-library-api'

const en = {
  title: 'Team templates',
  subtitle: 'Create a new working document from a shared template while preserving the original.',
  documentsTitle: 'Team document storage',
  documentsSubtitle: 'Browse saved project documents by project, author and file type.',
  allProjects: 'All projects',
  allAuthors: 'All authors',
  storageLocation: 'Storage location',
  templates: 'Templates',
  documents: 'Team documents',
  settings: 'NAS settings',
  close: 'Close settings',
  templatesFolder: 'Templates folder',
  documentsFolder: 'Team documents folder',
  memberName: 'Your name',
  browse: 'Choose folder',
  save: 'Save connection',
  saving: 'Connecting…',
  connectionHint:
    'Connect to the NAS in Windows Explorer or Finder first. Select two separate, existing folders.',
  autoSync: 'Automatically send documents to the NAS after saving',
  structure:
    'Documents: project (the home folder a document is in) / author / document type. Templates: document type. Copies sent to the NAS have phone, account, resident and business registration numbers and e-mail addresses masked; .hwp and .pdf files are not sent.',
  configured: 'Connection saved.',
  refresh: 'Refresh',
  register: 'Register template',
  send: 'Send a saved document',
  diskHint: 'Save your document before registering a template or sending a file.',
  sourceHint:
    'Shared originals stay unchanged. Selecting a file opens a working copy on your computer.',
  search: 'Search names or folders',
  all: 'All types',
  empty: 'No matching documents.',
  notConfigured: 'Choose your team templates and documents folders to get started.',
  choose: 'Use template',
  open: 'Open working copy',
  folder: 'Open NAS folder',
  working: 'Working…',
  loading: 'Loading…',
  partial: 'Some files could not be listed. Narrow the folder or check access permissions.',
  published: 'Added to the NAS: ',
  opened: 'Working copy created.',
  project: 'Working copies go to: ',
  syncTitle: 'Automatic uploads',
  retry: 'Retry uploads',
  noUploads: 'Saved documents will appear here after the NAS connection is configured.',
  syncProject: 'Send the documents in this folder',
  queued: 'Documents queued: ',
  pending: 'Waiting',
  uploading: 'Uploading',
  synced: 'On NAS',
  error: 'Retry needed',
  failed: 'The request could not be completed. Try again.',
}

const ko: typeof en = {
  title: '팀 템플릿',
  subtitle: '공용 양식의 원본을 보존하면서 새 작업 문서를 만드세요.',
  documentsTitle: '팀 문서 저장소',
  documentsSubtitle: '저장한 프로젝트 문서를 프로젝트·작성자·문서 종류별로 찾아 보고하세요.',
  allProjects: '모든 프로젝트',
  allAuthors: '모든 작성자',
  storageLocation: '저장 위치',
  templates: '팀 템플릿',
  documents: '팀 문서',
  settings: 'NAS 연결 설정',
  close: '설정 닫기',
  templatesFolder: '팀 템플릿 폴더',
  documentsFolder: '팀 문서 폴더',
  memberName: '작성자 이름',
  browse: '폴더 선택',
  save: '연결 저장',
  saving: '연결 확인 중…',
  connectionHint:
    '먼저 Windows 탐색기 또는 Finder에서 NAS에 로그인한 뒤, 서로 분리된 기존 폴더를 지정하세요.',
  autoSync: '문서를 저장할 때 NAS에 자동으로 보내기',
  structure:
    '팀 문서: 프로젝트(문서가 들어 있는 내 폴더) / 작성자 / 문서 종류 · 팀 템플릿: 문서 종류. NAS로 보내는 사본은 전화번호·계좌번호·주민번호·사업자번호·이메일을 가려서 보내며, .hwp와 .pdf는 보내지 않습니다.',
  configured: 'NAS 연결을 저장했습니다.',
  refresh: '새로고침',
  register: '팀 템플릿 등록',
  send: '저장된 문서 보내기',
  diskHint: '템플릿을 등록하거나 파일을 보낼 때는 편집 중인 문서를 먼저 저장하세요.',
  sourceHint: '선택한 양식과 문서는 PC의 작업 사본으로 열립니다. NAS 원본은 보존됩니다.',
  search: '문서 이름 또는 폴더 검색',
  all: '모든 형식',
  empty: '표시할 문서가 없습니다.',
  notConfigured: '팀 템플릿 폴더와 팀 문서 폴더를 연결하면 시작할 수 있습니다.',
  choose: '이 양식으로 작성',
  open: '작업 사본 열기',
  folder: 'NAS 폴더 열기',
  working: '처리 중…',
  loading: '불러오는 중…',
  partial: '일부 파일을 표시하지 못했습니다. 폴더 범위와 접근 권한을 확인하세요.',
  published: 'NAS에 추가했습니다: ',
  opened: 'PC에 작업 사본을 만들었습니다.',
  project: '작업 사본을 만들 폴더: ',
  syncTitle: '자동 전송 현황',
  retry: '전송 재시도',
  noUploads: 'NAS 연결 후 문서를 저장하면 전송 현황이 표시됩니다.',
  syncProject: '이 폴더의 문서 보내기',
  queued: '문서를 전송 대기열에 추가했습니다: ',
  pending: '전송 대기',
  uploading: '전송 중',
  synced: 'NAS 저장 완료',
  error: '재시도 필요',
  failed: '작업을 완료하지 못했습니다. 다시 시도해 주세요.',
}

export function teamStrings(lang: string): typeof en {
  return lang === 'ko' ? ko : en
}

export function teamError(lang: string, code: TeamErrorCode): string {
  const errors: Record<TeamErrorCode, [string, string]> = {
    'not-configured': [
      'Configure the NAS folders and enable automatic uploads first.',
      'NAS 폴더를 연결하고 자동 전송 설정을 확인하세요.',
    ],
    unavailable: [
      'The NAS or file is unavailable. Check your connection and try again.',
      'NAS 또는 파일에 연결할 수 없습니다. 네트워크 연결과 파일 위치를 확인하세요.',
    ],
    permission: [
      'Access was denied. Check your NAS account and folder permissions.',
      '접근 권한이 없습니다. NAS 로그인과 폴더 읽기·쓰기 권한을 확인하세요.',
    ],
    'invalid-path': [
      'Enter your name and select separate, existing templates and documents folders.',
      '작성자 이름을 입력하고, 서로 포함되지 않는 별도의 템플릿·팀 문서 폴더를 지정하세요.',
    ],
    unsupported: [
      'This file type is not supported here.',
      '이곳에서 지원하지 않는 문서 형식입니다.',
    ],
    'copy-failed': [
      'The document could not be copied. Check available storage.',
      '문서를 복사하지 못했습니다. 저장 공간과 파일 이름을 확인하세요.',
    ],
    'open-failed': ['The working copy could not be opened.', '작업 사본을 열지 못했습니다.'],
    'not-maskable': [
      'Not sent: numbers in .hwp and .pdf files cannot be masked. Save it as .hwpx (Hangul) to send it.',
      '보내지 않음: .hwp와 .pdf는 번호를 가릴 수 없습니다. 한글 문서는 .hwpx로 저장하면 보낼 수 있습니다.',
    ],
    'masking-failed': [
      'Not sent: the document has an embedded object or a number that could not be masked.',
      '보내지 않음: 문서 안에 가릴 수 없는 첨부 개체나 번호가 있습니다.',
    ],
  }
  return errors[code][lang === 'ko' ? 1 : 0]
}
