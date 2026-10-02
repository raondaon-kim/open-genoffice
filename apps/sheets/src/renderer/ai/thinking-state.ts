/**
 * The sheets panel keeps ONE assistant entry for a whole multi-step run, while the agent loop reports
 * the thinking of the current turn only. This keeps the finished turns so the box shows them all.
 */
export interface ThinkingState {
  /** finished turns, joined by a blank line */
  readonly done: string
  /** the current turn's cumulative thinking */
  readonly turn: string
}

export const emptyThinkingState: ThinkingState = { done: '', turn: '' }

const join = (done: string, turn: string): string =>
  done && turn ? `${done}\n\n${turn}` : done || turn

/** the loop reported the current turn's cumulative thinking: the text to show for the whole run so far */
export function thinkingUpdate(
  state: ThinkingState,
  turnText: string,
): { state: ThinkingState; text: string } {
  const next = { done: state.done, turn: turnText }
  return { state: next, text: join(next.done, next.turn) }
}

/** a turn requested tools and the loop is going back to the model: freeze the current turn */
export function thinkingTurnEnd(state: ThinkingState): ThinkingState {
  return { done: join(state.done, state.turn), turn: '' }
}

/** the run is over: the loop's joined run thinking wins, else what was shown */
export function thinkingFinish(
  runThinking: string | undefined,
  shown: string | undefined,
): string | undefined {
  return runThinking || shown
}
