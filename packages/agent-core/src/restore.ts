import type { AgentMessage } from './types'

/** a transcript message as the panels persist it */
export interface StoredChatMessage {
  role: 'user' | 'assistant'
  text: string
  /** raw model reasoning of an assistant message */
  reasoning?: string | undefined
}

/** model-context messages for AgentLoop.restore(): the text plus the reasoning providers want sent back */
export function toRestorableMessages(messages: readonly StoredChatMessage[]): AgentMessage[] {
  return messages.map((message) =>
    message.role === 'assistant' && message.reasoning
      ? { role: 'assistant', text: message.text, reasoning: message.reasoning }
      : { role: message.role, text: message.text },
  )
}
