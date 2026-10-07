import { createIpcTransport, type AgentTransport } from '@genoffice/agent-core'
import type { AiSettings } from '@genoffice/ai-provider'

/** The shared IPC transport wired to the Hangul preload bridge (window.hwpApi). */
export function createElectronTransport(
  getSettings: () => AiSettings,
  lang: () => 'en' | 'ko',
): AgentTransport {
  const text = (en: string, ko: string) => () => (lang() === 'ko' ? ko : en)
  return createIpcTransport<AiSettings>({
    onStream: (listener) => window.hwpApi.onAiStream(listener),
    start: (request) => window.hwpApi.aiStream(request),
    cancel: (requestId) => void window.hwpApi.aiStreamCancel(requestId),
    getSettings,
    unknownErrorText: text('Unknown AI error', '알 수 없는 AI 오류가 발생했습니다.'),
    timeoutErrorText: text(
      'The AI did not respond in time. Try again.',
      'AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.',
    ),
    creditsErrorText: text(
      'The AI account has run out of credits.',
      'AI 계정의 사용 한도가 소진되었습니다.',
    ),
    networkErrorText: text(
      'Could not reach the AI service. Check the network.',
      'AI 서비스에 연결할 수 없습니다. 네트워크를 확인해 주세요.',
    ),
    overloadedErrorText: text(
      'The AI service is busy. Try again shortly.',
      'AI 서비스가 혼잡합니다. 잠시 후 다시 시도해 주세요.',
    ),
  })
}
