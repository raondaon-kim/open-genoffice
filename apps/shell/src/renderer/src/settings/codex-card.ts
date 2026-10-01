import type { CodexLoginStartView, CodexStatusView } from '../../../shared/codex-api'

export type CodexCardAction =
  'login' | 'login-device' | 'login-api-key' | 'cancel' | 'logout' | 'retry'

export interface CodexCardView {
  badge: 'checking' | 'connected' | 'signed-out' | 'signing-in' | 'error'
  title: string
  detail: string | null
  actions: CodexCardAction[]
  binaryLine: string | null
  deviceCode: { code: string; url: string } | null
}

const SOURCE_LABELS = {
  bundled: 'bundled with Open GenOffice',
  managed: 'Codex app',
  vscode: 'VS Code extension',
  path: 'on PATH',
} as const

function binaryLine(status: CodexStatusView | null): string | null {
  const binary = status?.binary
  if (!binary) return null
  const version = binary.version ? `Codex ${binary.version}` : 'Codex'
  return binary.source === 'custom'
    ? `${version} · custom path ${binary.path}`
    : `${version} · ${SOURCE_LABELS[binary.source]}`
}

/** pure view model for the Codex card (rendering lives in CodexCard.tsx) */
export function codexCardView(
  status: CodexStatusView | null,
  pending: CodexLoginStartView | null,
): CodexCardView {
  const line = binaryLine(status)
  if (pending) {
    return {
      badge: 'signing-in',
      title:
        pending.method === 'chatgpt'
          ? 'Finish signing in in your browser'
          : 'Enter this code on the OpenAI sign-in page',
      detail: null,
      actions: ['cancel'],
      binaryLine: line,
      deviceCode:
        pending.method === 'chatgptDeviceCode'
          ? { code: pending.userCode, url: pending.verificationUrl }
          : null,
    }
  }
  if (!status) {
    return {
      badge: 'checking',
      title: 'Checking Codex…',
      detail: null,
      actions: [],
      binaryLine: null,
      deviceCode: null,
    }
  }
  if (status.state === 'error') {
    return {
      badge: 'error',
      title: 'Codex is unavailable',
      detail: status.message ?? null,
      actions: ['retry'],
      binaryLine: line,
      deviceCode: null,
    }
  }
  if (status.state === 'signed-out') {
    return {
      badge: 'signed-out',
      title: 'Not signed in',
      detail: 'Sign in with your ChatGPT account to use your plan in every Open GenOffice module.',
      actions: ['login', 'login-device', 'login-api-key'],
      binaryLine: line,
      deviceCode: null,
    }
  }
  const apiKey = status.accountType === 'apiKey'
  return {
    badge: 'connected',
    title: apiKey
      ? 'Connected with an OpenAI API key'
      : `Connected as ${status.email ?? 'your ChatGPT account'}`,
    detail: !apiKey && status.planType ? `ChatGPT plan: ${status.planType}` : null,
    actions: ['logout'],
    binaryLine: line,
    deviceCode: null,
  }
}
