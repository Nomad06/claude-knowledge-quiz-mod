// Pure quiz logic: no `$`, so the tests can drive it with a seeded random source.

import { QUESTIONS } from './questions'
import type { Question } from './questions'

/** A source of numbers in [0, 1), like Math.random. */
export type Rng = () => number

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const

export const ALL_IDS: readonly number[] = QUESTIONS.map(q => q.id)

const BY_ID = new Map<number, Question>(QUESTIONS.map(q => [q.id, q]))

export function questionById(id: number): Question | undefined {
  return BY_ID.get(id)
}

/** A small seeded generator (mulberry32), for tests and reproducible shuffles. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates shuffle into a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = out[i] as T
    out[i] = out[j] as T
    out[j] = a
  }
  return out
}

/** A random permutation of a question's option indexes: `order[pos]` = original index. */
export function shuffleOrder(q: Question, rng: Rng): number[] {
  return shuffle(
    q.options.map((_, i) => i),
    rng,
  )
}

/** The options as drawn in `order`, with `correct` remapped to on-screen positions. */
export function present(q: Question, order: readonly number[]): { options: string[]; correct: number[] } {
  const options = order.map(i => q.options[i] ?? '')
  const correct = q.correct.map(c => order.indexOf(c)).sort((a, b) => a - b)
  return { options, correct }
}

/** Right only when `chosen` is exactly the correct set: same members, no extras, no repeats. */
export function isExactSet(chosen: readonly number[], correct: readonly number[]): boolean {
  const picked = new Set(chosen)
  if (picked.size !== chosen.length || picked.size !== correct.length) return false
  return correct.every(c => picked.has(c))
}

/** Grades on-screen choices against a question shown in `order`. */
export function grade(q: Question, order: readonly number[], selected: readonly number[]): boolean {
  return isExactSet(selected, present(q, order).correct)
}

/** Toggles a position for a pick-N question, never holding more than `pick`. */
export function toggle(selected: readonly number[], pos: number, pick: number): number[] {
  if (selected.includes(pos)) return selected.filter(s => s !== pos)
  if (selected.length >= pick) return [...selected]
  return [...selected, pos]
}

// ── Set filter ───────────────────────────────────────────────────────────

/** `0` means every set; 1-6 one practice set. */
export type SetFilter = number

export function setNumber(setName: string): number {
  const roman = setName.trim().split(/\s+/).pop() ?? ''
  return ROMAN.indexOf(roman as (typeof ROMAN)[number]) + 1
}

export function parseSetArg(arg: string): SetFilter | undefined {
  const text = arg.trim().toUpperCase()
  if (text === 'ALL' || text === '0') return 0
  const n = /^\d+$/.test(text) ? Number(text) : ROMAN.indexOf(text as (typeof ROMAN)[number]) + 1
  return n >= 1 && n <= 6 ? n : undefined
}

export function setLabel(filter: SetFilter): string {
  return filter === 0 ? 'all sets' : `Practice Set ${ROMAN[filter - 1] ?? filter}`
}

export function eligibleIds(filter: SetFilter): number[] {
  return QUESTIONS.filter(q => filter === 0 || setNumber(q.set) === filter).map(q => q.id)
}

// ── Deck ─────────────────────────────────────────────────────────────────

/**
 * Draws the next question id. The deck is a shuffled list of every id not yet
 * shown this cycle; an empty deck is refilled with a fresh shuffle of every
 * id, so no question repeats until all have been shown. With a set filter the
 * first eligible id is taken; once the cycle holds none, that set's ids are
 * shuffled back in.
 */
export function drawFromDeck(
  deck: readonly number[],
  eligible: readonly number[],
  rng: Rng,
): { id: number; deck: number[] } | undefined {
  if (eligible.length === 0) return undefined
  const known = new Set(ALL_IDS)
  let next = deck.filter(id => known.has(id))
  if (next.length === 0) next = shuffle(ALL_IDS, rng)
  const wanted = new Set(eligible)
  let at = next.findIndex(id => wanted.has(id))
  if (at === -1) {
    next = [...next, ...shuffle(eligible, rng)]
    at = next.findIndex(id => wanted.has(id))
  }
  const id = next[at] as number
  next.splice(at, 1)
  return { id, deck: next }
}

export function readDeck(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : []
}

// ── Stats ────────────────────────────────────────────────────────────────

export type Stats = {
  answered: number
  correct: number
  streak: number
  domains: Record<string, { correct: number; answered: number }>
}

export const EMPTY_STATS: Stats = { answered: 0, correct: 0, streak: 0, domains: {} }

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

export function readStats(value: unknown): Stats {
  if (typeof value !== 'object' || value === null) return { ...EMPTY_STATS, domains: {} }
  const v = value as Record<string, unknown>
  const domains: Stats['domains'] = {}
  if (typeof v.domains === 'object' && v.domains !== null) {
    for (const [name, row] of Object.entries(v.domains as Record<string, unknown>)) {
      const r = (row ?? {}) as Record<string, unknown>
      domains[name] = { correct: count(r.correct), answered: count(r.answered) }
    }
  }
  return { answered: count(v.answered), correct: count(v.correct), streak: count(v.streak), domains }
}

export function recordAnswer(stats: Stats, domain: string, isCorrect: boolean): Stats {
  const row = stats.domains[domain] ?? { correct: 0, answered: 0 }
  return {
    answered: stats.answered + 1,
    correct: stats.correct + (isCorrect ? 1 : 0),
    streak: isCorrect ? stats.streak + 1 : 0,
    domains: {
      ...stats.domains,
      [domain]: { correct: row.correct + (isCorrect ? 1 : 0), answered: row.answered + 1 },
    },
  }
}

/** The weakest domains by accuracy, lowest first; more answers break ties. */
export function weakestDomains(stats: Stats, n = 3): { domain: string; correct: number; answered: number }[] {
  return Object.entries(stats.domains)
    .filter(([, r]) => r.answered > 0)
    .map(([domain, r]) => ({ domain, ...r }))
    .sort(
      (a, b) =>
        a.correct / a.answered - b.correct / b.answered ||
        b.answered - a.answered ||
        a.domain.localeCompare(b.domain),
    )
    .slice(0, n)
}

export function percent(correct: number, answered: number): string {
  return answered === 0 ? '–' : `${Math.round((correct / answered) * 100)}%`
}

export function summaryLine(stats: Stats, isPaused: boolean, filter: SetFilter): string {
  const parts = [`Quiz ${stats.correct}/${stats.answered}`, `streak ${stats.streak}`]
  if (filter !== 0) parts.push(`set ${ROMAN[filter - 1] ?? filter}`)
  if (isPaused) parts.push('paused')
  return parts.join(' · ')
}

/** `every` from userConfig: a whole number of at least 1. */
export function everyN(value: unknown): number {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** Whether a prompt should count as a task: the person's own, and not one of our commands. */
export function isQuizCommand(text: string): boolean {
  return /^\s*\/quiz(?:-[a-z]+)?(?:\s|$)/.test(text)
}
