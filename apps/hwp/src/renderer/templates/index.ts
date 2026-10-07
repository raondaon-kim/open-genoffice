import gajungtongsinmunMd from './gajungtongsinmun.md?raw'
import lessonPlanMd from './lesson-plan.md?raw'
import performanceAssessmentMd from './performance-assessment.md?raw'
import parentCounselLogMd from './parent-counsel-log.md?raw'
import meetingMinutesMd from './meeting-minutes.md?raw'
import businessTripReportMd from './business-trip-report.md?raw'
import weeklyLearningGuideMd from './weekly-learning-guide.md?raw'
import afterschoolPlanMd from './afterschool-plan.md?raw'

export interface HwpTemplate {
  id: string
  name: string
  category: string
  description: string
  keywords: string[]
  fileName: string
  /** Markdown source used by the HwpForge generator (tables become real Hangul tables) */
  source: string
}

/**
 * Built-in Hangul document templates for Korean K-12 school work.
 *
 * Sources are plain Markdown with {자리표시자} tokens the teacher replaces after
 * creation (school name, dates, ...). Expanding the pack = adding one .md here
 * plus a manifest row.
 */
export const HWP_TEMPLATES: HwpTemplate[] = [
  {
    id: 'gajungtongsinmun-fieldtrip',
    name: '가정통신문 (현장체험학습, 학교 문서 형식)',
    category: '학급·담임 운영',
    description:
      '문서번호·발신/수신·로고 자리·결재를 갖춘 학교 문서 형식의 현장체험학습 안내 가정통신문',
    keywords: [
      '가정통신문',
      '체험학습',
      '현장체험학습',
      '안내장',
      '학부모',
      '참가신청',
      '공문',
      '결재',
    ],
    fileName: '가정통신문_현장체험학습',
    source: gajungtongsinmunMd,
  },
  {
    id: 'lesson-plan',
    name: '교수·학습과정안 (수업지도안)',
    category: '수업',
    description: '차시별 학습목표·성취기준·수업흐름·평가를 담은 수업지도안',
    keywords: ['수업지도안', '교수학습과정안', '지도안', '차시', '성취기준', '수업'],
    fileName: '교수학습과정안',
    source: lessonPlanMd,
  },
  {
    id: 'performance-assessment',
    name: '수행평가 계획서 (+루브릭)',
    category: '수업',
    description: '수행평가 영역·비중·방법과 채점기준표(상중하 루브릭)',
    keywords: ['수행평가', '루브릭', '채점기준표', '평가 계획', '평가'],
    fileName: '수행평가_계획서',
    source: performanceAssessmentMd,
  },
  {
    id: 'parent-counsel-log',
    name: '학부모 상담일지',
    category: '상담·생활지도',
    description: '학부모 상담 내용·조치 사항을 기록하는 상담일지',
    keywords: ['상담일지', '학부모 상담', '상담', '생활지도'],
    fileName: '학부모_상담일지',
    source: parentCounselLogMd,
  },
  {
    id: 'meeting-minutes',
    name: '회의록',
    category: '행정',
    description: '교직원회의·학급회의 보고·협의·결정 사항 기록',
    keywords: ['회의록', '회의', '협의', '안건', '결재'],
    fileName: '회의록',
    source: meetingMinutesMd,
  },
  {
    id: 'business-trip-report',
    name: '출장복명서',
    category: '행정',
    description: '출장 내용·성과·후속 조치를 보고하는 복명서',
    keywords: ['출장복명서', '복명', '출장', '보고'],
    fileName: '출장복명서',
    source: businessTripReportMd,
  },
  {
    id: 'weekly-learning-guide',
    name: '주간 학습 안내장',
    category: '학급·담임 운영',
    description: '다음 주 일정·준비물·과제를 안내하는 주간 안내장',
    keywords: ['주간학습', '안내장', '학습 안내', '일정', '학부모'],
    fileName: '주간학습안내장',
    source: weeklyLearningGuideMd,
  },
  {
    id: 'afterschool-plan',
    name: '방과후학교 운영계획서',
    category: '방과후·돌봄',
    description: '방과후 프로그램 주차별 내용·안전·평가 운영계획',
    keywords: ['방과후', '방과후학교', '운영계획', '프로그램', '돌봄'],
    fileName: '방과후학교_운영계획서',
    source: afterschoolPlanMd,
  },
]
