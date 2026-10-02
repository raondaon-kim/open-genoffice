export interface RunEnd {
  /** the model's text for the final turn */
  text: string
  cancelled: boolean
  turnLimit: boolean
  /** tools of this run that changed the document */
  mutations: number
}

/** what the panel shows when a run ends (never persisted when the model said nothing) */
export function runEndText(end: RunEnd, lang: 'ko' | 'en'): string {
  const ko = lang === 'ko'
  if (end.cancelled) return end.text || (ko ? '중지했습니다.' : 'Stopped.')
  if (end.turnLimit) {
    const note = ko
      ? `작업이 길어져 여기서 멈췄습니다. 지금까지 적용한 편집 ${end.mutations}건. '계속'이라고 입력하면 이어서 진행합니다.`
      : `This took too many steps, so it stopped here after ${end.mutations} edit(s). Type "continue" to go on.`
    return [end.text, note].filter(Boolean).join('\n\n')
  }
  if (end.text) return end.text
  if (end.mutations > 0) {
    return ko
      ? `모델이 설명 없이 끝냈습니다. 적용한 편집 ${end.mutations}건은 'AI 편집 되돌리기' 버튼으로 되돌릴 수 있습니다.`
      : `The model finished without a summary. Its ${end.mutations} edit(s) can be undone with the "Undo AI edit" button.`
  }
  return ko
    ? '모델이 답 없이 끝냈습니다. 다시 요청하거나 다른 모델을 골라 보세요.'
    : 'The model ended without an answer. Ask again or pick another model.'
}
