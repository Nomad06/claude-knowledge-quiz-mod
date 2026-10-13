/** A question on screen: `order[i]` is the original option index drawn at position i. */
export type QuizQuestionPanel = {
  kind: 'question'
  qid: number
  order: number[]
  /** Chosen positions on screen (indexes into the shuffled order). */
  selected: number[]
  isGraded: boolean
  isCorrect: boolean
}

export type QuizDomainRow = { domain: string; correct: number; answered: number }

/** The /quiz-stats view, a snapshot taken when the command ran. */
export type QuizStatsPanel = {
  kind: 'stats'
  answered: number
  correct: number
  streak: number
  weakest: QuizDomainRow[]
  setLabel: string
  isPaused: boolean
}

export type QuizPanel = QuizQuestionPanel | QuizStatsPanel | null

declare module 'claude-code' {
  interface PluginState {
    'task-quiz': {
      /** What the band above the prompt shows; null shows nothing. */
      panel: QuizPanel
      /** The status line text, e.g. `Quiz 12/15 · streak 4`. */
      summary: string
    }
  }
}
