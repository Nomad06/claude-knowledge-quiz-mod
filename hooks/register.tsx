import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, PromptOrigin, Register, RenderElement } from 'claude-code'

import type { QuizPanel, QuizQuestionPanel, QuizStatsPanel } from '../types'
import {
  LETTERS,
  drawFromDeck,
  eligibleIds,
  everyN,
  grade,
  isQuizCommand,
  parseSetArg,
  percent,
  present,
  questionById,
  readDeck,
  readStats,
  recordAnswer,
  setLabel,
  shuffleOrder,
  summaryLine,
  toggle,
  weakestDomains,
} from './quiz'
import type { SetFilter, Stats } from './quiz'

const PANE = 'task-quiz'

const panel = atom({ plugin: 'task-quiz', key: 'panel' } as const, null)
const summary = atom({ plugin: 'task-quiz', key: 'summary' } as const, 'Quiz 0/0 · streak 0')

// $.store keys (kept across sessions).
const K = {
  deck: 'deck',
  stats: 'stats',
  paused: 'paused',
  set: 'set',
  tasks: 'taskCount',
} as const

/** Prompt origins that are the person starting a task (not a notification, peer or plugin). */
const HUMAN: ReadonlySet<PromptOrigin['kind']> = new Set(['composer', 'bridge', 'sdk', 'slack-ping'])

type $ = EngineInterface
type Table = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button'>

// ── Store access ─────────────────────────────────────────────────────────

async function getPaused($: $): Promise<boolean> {
  return (await $.store.get(K.paused)) === true
}

async function getSet($: $): Promise<SetFilter> {
  const v = await $.store.get(K.set)
  return typeof v === 'number' && v >= 0 && v <= 6 ? v : 0
}

async function getStats($: $): Promise<Stats> {
  return readStats(await $.store.get(K.stats))
}

/** Recomputes the status line from the store and shows it. */
async function refreshSummary($: $): Promise<void> {
  const [stats, isPaused, filter] = await Promise.all([getStats($), getPaused($), getSet($)])
  const line = summaryLine(stats, isPaused, filter)
  await update($, summary, () => line)
  $.ui.status(line)
}

function toast($: $, text: string): void {
  try {
    $.ui.toast(text)
  } catch {
    // A toast is a nicety; never let it break a command.
  }
}

// ── Showing a question ───────────────────────────────────────────────────

/** Surfaces with no band above the prompt get the quiz in a pane instead. */
async function openPaneIfNeeded($: $): Promise<void> {
  try {
    const surfaces = await $.session.surfaces()
    if (surfaces.some(s => s === 'mobile' || s === 'vscode')) {
      await $.ui.open({ id: PANE, title: 'Quiz' })
    }
  } catch {
    // No pane is fine: the band still draws on terminal and desktop.
  }
}

async function closePane($: $): Promise<void> {
  try {
    if ((await $.ui.panes()).some(p => p.id === PANE)) await $.ui.close({ id: PANE })
  } catch {
    // Already gone.
  }
}

/** Draws the next question from the deck (replacing whatever is on screen). */
async function showNext($: $): Promise<boolean> {
  const filter = await getSet($)
  const drawn = drawFromDeck(readDeck(await $.store.get(K.deck)), eligibleIds(filter), Math.random)
  const q = drawn && questionById(drawn.id)
  if (!drawn || !q) return false
  await $.store.set(K.deck, drawn.deck)
  const next: QuizQuestionPanel = {
    kind: 'question',
    qid: q.id,
    order: shuffleOrder(q, Math.random),
    selected: [],
    isGraded: false,
    isCorrect: false,
  }
  await update($, panel, () => next)
  await openPaneIfNeeded($)
  return true
}

/** A task started: count it, and show a question on every Nth one unless paused. */
async function onTask($: $, every: number): Promise<void> {
  if (await getPaused($)) return
  const tasks = Number((await $.store.get(K.tasks)) ?? 0) + 1
  await $.store.set(K.tasks, tasks)
  if (tasks % every !== 0) return
  await showNext($)
}

// ── Answering ────────────────────────────────────────────────────────────

async function choose($: $, pos: number): Promise<void> {
  let graded: { domain: string; isCorrect: boolean } | undefined
  await update($, panel, p => {
    graded = undefined
    if (p === null || p.kind !== 'question' || p.isGraded) return p
    const q = questionById(p.qid)
    if (!q) return p
    if (q.pick === 1) {
      const isCorrect = grade(q, p.order, [pos])
      graded = { domain: q.domain, isCorrect }
      return { ...p, selected: [pos], isGraded: true, isCorrect }
    }
    return { ...p, selected: toggle(p.selected, pos, q.pick) }
  })
  if (graded) await saveAnswer($, graded.domain, graded.isCorrect)
}

async function submit($: $): Promise<void> {
  let graded: { domain: string; isCorrect: boolean } | undefined
  await update($, panel, p => {
    graded = undefined
    if (p === null || p.kind !== 'question' || p.isGraded) return p
    const q = questionById(p.qid)
    if (!q || p.selected.length !== q.pick) return p
    const isCorrect = grade(q, p.order, p.selected)
    graded = { domain: q.domain, isCorrect }
    return { ...p, isGraded: true, isCorrect }
  })
  if (graded) await saveAnswer($, graded.domain, graded.isCorrect)
}

async function saveAnswer($: $, domain: string, isCorrect: boolean): Promise<void> {
  await $.store.set(K.stats, recordAnswer(await getStats($), domain, isCorrect))
  await refreshSummary($)
}

async function dismiss($: $): Promise<void> {
  await update($, panel, () => null)
  await closePane($)
}

// ── Drawing ──────────────────────────────────────────────────────────────

function drawQuestion($: $, ui: Table, p: QuizQuestionPanel, line: string): RenderElement | undefined {
  const { Box, Text, Button } = ui
  const q = questionById(p.qid)
  if (!q) return undefined
  const { options, correct } = present(q, p.order)

  const rows = options.map((text, pos) => {
    const letter = LETTERS[pos] ?? String(pos + 1)
    const isChosen = p.selected.includes(pos)
    const isRight = correct.includes(pos)
    if (p.isGraded) {
      const mark = isChosen ? (isRight ? '✓' : '✗') : isRight ? '→' : ' '
      const color = isRight ? 'success' : isChosen ? 'error' : undefined
      return (
        <Box key={`opt-${pos}`}>
          <Text color={color} bold={isRight} dimColor={!isRight && !isChosen}>
            {mark} {letter}. {text}
          </Text>
        </Box>
      )
    }
    const box = q.pick === 2 ? (isChosen ? '[x] ' : '[ ] ') : ''
    return (
      <Button key={`opt-${pos}`} plain onPress={() => choose($, pos)}>
        {box}
        <Text bold>{letter}.</Text> {text}
      </Button>
    )
  })

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Box key="domain">
          <Text bold color="claude">
            {q.domain}
          </Text>
        </Box>
        <Text dimColor>· {q.set}</Text>
        {q.pick === 2 ? (
          <Box key="pick2">
            <Text bold color="warning">
              · Pick 2
            </Text>
          </Box>
        ) : null}
        <Box key="summary">
          <Text dimColor>· {line}</Text>
        </Box>
      </Box>
      <Box key="question">
        <Text>{q.question}</Text>
      </Box>
      <Box flexDirection="column">{rows}</Box>
      {!p.isGraded && q.pick === 2 && p.selected.length === q.pick ? (
        <Box flexDirection="row">
          <Button key="submit" label="Submit" variant="primary" onPress={() => submit($)} />
        </Box>
      ) : null}
      {p.isGraded ? (
        <Box flexDirection="column">
          <Box key="verdict">
            <Text bold color={p.isCorrect ? 'success' : 'error'}>
              {p.isCorrect ? 'Correct.' : 'Not quite.'}
            </Text>
          </Box>
          <Box key="explanation">
            <Text dimColor>{q.explanation}</Text>
          </Box>
          <Box flexDirection="row" columnGap={1}>
            <Button key="next" label="Next question" variant="primary" onPress={() => showNext($)} />
            <Button key="dismiss" label="Dismiss" onPress={() => dismiss($)} />
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}

function drawStats($: $, ui: Table, s: QuizStatsPanel): RenderElement {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column">
      <Box key="title">
        <Text bold color="claude">
          Quiz stats
        </Text>
      </Box>
      <Box key="overall">
        <Text>
          {s.answered === 0
            ? 'No questions answered yet.'
            : `Overall ${percent(s.correct, s.answered)} (${s.correct}/${s.answered}) · streak ${s.streak}`}
        </Text>
      </Box>
      <Box key="filter">
        <Text dimColor>
          Questions from {s.setLabel}
          {s.isPaused ? ' · per-task quiz paused' : ''}
        </Text>
      </Box>
      {s.weakest.length > 0 ? <Text bold>Weakest domains</Text> : null}
      {s.weakest.map((d, i) => (
        <Box key={`weak-${i}`}>
          <Text>
            {i + 1}. {d.domain}: {percent(d.correct, d.answered)} ({d.correct}/{d.answered})
          </Text>
        </Box>
      ))}
      <Box flexDirection="row">
        <Button key="dismiss" label="Dismiss" onPress={() => dismiss($)} />
      </Box>
    </Box>
  )
}

function drawPanel($: $, ui: Table, p: QuizPanel, line: string): RenderElement | undefined {
  if (p === null) return undefined
  return p.kind === 'question' ? drawQuestion($, ui, p, line) : drawStats($, ui, p)
}

// ── Hooks ────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  const every = everyN(options.every)

  on('session.start', async ($, e, next) => {
    // Commands run at once, even mid-turn, so the quiz never waits on a task.
    await Promise.all([
      $.command.register({ name: 'quiz', description: 'Show a practice question now', immediate: true }),
      $.command.register({
        name: 'quiz-off',
        description: 'Pause the per-task practice question',
        immediate: true,
      }),
      $.command.register({
        name: 'quiz-on',
        description: 'Resume the per-task practice question',
        immediate: true,
      }),
      $.command.register({
        name: 'quiz-stats',
        description: 'Show quiz accuracy and your 3 weakest domains',
        immediate: true,
      }),
      $.command.register({
        name: 'quiz-set',
        description: 'Limit quiz questions to one practice set',
        argumentHint: '<1-6|all>',
        immediate: true,
      }),
      $.command.register({
        name: 'quiz-reset',
        description: 'Clear quiz stats and the question deck',
        immediate: true,
      }),
    ])
    await refreshSummary($)
    return next(e)
  })

  // The quiz is for the person only: the prompt goes on untouched (no text or
  // context change), and the question is drawn only after the turn has started.
  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)
    if (!HUMAN.has(e.origin.kind) || isQuizCommand(e.text) || 'drop' in entered) return entered
    try {
      await onTask($, every)
    } catch {
      // A quiz failure must never touch the task.
    }
    return entered
  }).catch(($, e, next) => next(e))

  // Commands answer with no text, so nothing about the quiz reaches the model.
  on('command.run', { command: 'quiz' }, async $ => {
    if (!(await showNext($))) toast($, 'No questions match the current set.')
    return {}
  })

  on('command.run', { command: 'quiz-off' }, async $ => {
    await $.store.set(K.paused, true)
    await refreshSummary($)
    toast($, 'Quiz paused. /quiz-on resumes it; /quiz still shows one.')
    return {}
  })

  on('command.run', { command: 'quiz-on' }, async $ => {
    await $.store.set(K.paused, false)
    await refreshSummary($)
    toast($, 'Quiz resumed.')
    return {}
  })

  on('command.run', { command: 'quiz-stats' }, async $ => {
    const [stats, isPaused, filter] = await Promise.all([getStats($), getPaused($), getSet($)])
    const view: QuizStatsPanel = {
      kind: 'stats',
      answered: stats.answered,
      correct: stats.correct,
      streak: stats.streak,
      weakest: weakestDomains(stats, 3),
      setLabel: setLabel(filter),
      isPaused,
    }
    await update($, panel, () => view)
    await openPaneIfNeeded($)
    return {}
  })

  on('command.run', { command: 'quiz-set' }, async ($, e) => {
    const filter = parseSetArg(e.args)
    if (filter === undefined) {
      toast($, 'Usage: /quiz-set <1-6|all>')
      return {}
    }
    await $.store.set(K.set, filter)
    await refreshSummary($)
    toast($, `Quiz questions now come from ${setLabel(filter)}.`)
    return {}
  })

  on('command.run', { command: 'quiz-reset' }, async $ => {
    await Promise.all([$.store.delete(K.stats), $.store.delete(K.deck), $.store.delete(K.tasks)])
    await refreshSummary($)
    toast($, 'Quiz stats and deck cleared.')
    return {}
  })

  // Terminal and desktop: the band above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const p = await read($, panel)
    if (p === null) return next(e)
    const tree = drawPanel($, $.ui.resolve(e), p, await read($, summary))
    return tree ?? next(e)
  })

  // Mobile and VS Code have no band, so the quiz opens in a pane there.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const p = await read($, panel)
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      return <ui.Text dimColor>The quiz is in the band above the prompt.</ui.Text>
    }
    return (
      drawPanel($, ui, p, await read($, summary)) ?? (
        <ui.Text dimColor>No question right now. /quiz shows one.</ui.Text>
      )
    )
  })

  // A phone that attaches while a question is up gets the pane too.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    try {
      if ((await read($, panel)) !== null) await openPaneIfNeeded($)
    } catch {
      // Never hold up an attach.
    }
    return result
  })
}
