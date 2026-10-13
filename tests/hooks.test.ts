import { expect, mock, test } from 'claude-code/testing'
import type { On, PromptSubmitInput } from 'claude-code'

import type { QuizPanel } from '../types'
import { present, questionById } from '../hooks/quiz'

const BAND = {
  plugin: 'task-quiz',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 30,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 29 },
    view: {},
  },
} as const

type World = {
  /** Every prompt that reached the bottom (the model's side). */
  arrived: PromptSubmitInput[]
  /** Every value the plugin wrote to its `panel` state, oldest first. */
  panels: QuizPanel[]
  /** The panel as it stands now. */
  panel: () => QuizPanel
}

/** The engine beneath the plugin: a store, a quiet UI, and a prompt bottom that records what arrived. */
function world(on: On, entries: Record<string, unknown> = {}): World {
  const arrived: PromptSubmitInput[] = []
  const panels: QuizPanel[] = []
  mock.store(on, entries)
  on('prompt.submit', ($, e) => {
    arrived.push(e)
    return e.context === undefined ? { text: e.text } : { text: e.text, context: e.context }
  })
  on('state.set', { plugin: 'task-quiz', key: 'panel' }, async ($, e, next) => {
    const result = await next(e)
    if (result.value?.isSet) panels.push(e.value as QuizPanel)
    return result
  })
  on('session.surfaces', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  return { arrived, panels, panel: () => panels[panels.length - 1] ?? null }
}

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const

function command(name: string, args = '') {
  return {
    command: name,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  } as const
}

test('the submitted prompt reaches the model unchanged', async ($, on) => {
  const w = world(on)
  const text = 'Refactor the auth module.\n\nKeep the public API the same.'
  const entered = await $.prompt.submit(typed(text))

  expect(w.arrived).toHaveLength(1)
  expect(w.arrived[0]?.text).toBe(text)
  expect(w.arrived[0]?.context).toBeUndefined() // nothing added for the model
  expect(w.arrived[0]?.origin).toEqual({ kind: 'composer' })
  expect(entered).toEqual({ text })
  // ...and the person got a question for it.
  expect(w.panel()?.kind).toBe('question')
})

test('context another hook attached passes through untouched', async ($, on) => {
  const w = world(on)
  await $.prompt.submit({ ...typed('Do the thing'), context: ['from another hook'] })
  expect(w.arrived[0]?.text).toBe('Do the thing')
  expect(w.arrived[0]?.context).toEqual(['from another hook'])
})

test('prompts that are not the person starting a task get no question', async ($, on) => {
  const w = world(on)
  await $.prompt.submit({
    text: 'A background task finished',
    wait: false,
    origin: { kind: 'task-notification' },
  })
  await $.prompt.submit(typed('/quiz-stats'))
  expect(w.arrived).toHaveLength(2)
  expect(w.panels).toHaveLength(0)
})

test('every=1 (the default) shows a question on every task', async ($, on) => {
  const w = world(on)
  for (let i = 0; i < 4; i++) await $.prompt.submit(typed(`task ${i}`))
  expect(w.panels.filter(p => p?.kind === 'question')).toHaveLength(4)
  expect(w.arrived).toHaveLength(4)
})

test('every=3 shows a question on every third task only', { options: { every: 3 } }, async ($, on) => {
  const w = world(on)
  const shownOn: number[] = []
  for (let task = 1; task <= 7; task++) {
    const before = w.panels.length
    await $.prompt.submit(typed(`task ${task}`))
    if (w.panels.length > before) shownOn.push(task)
  }
  expect(shownOn).toEqual([3, 6])
  expect(w.arrived).toHaveLength(7) // every task still ran
})

test('a paused quiz shows nothing on tasks, and /quiz still shows one', async ($, on) => {
  const w = world(on, { paused: true })
  await $.prompt.submit(typed('task'))
  expect(w.panels).toHaveLength(0)
  await $.command.run(command('quiz'))
  expect(w.panel()?.kind).toBe('question')
  await $.command.run(command('quiz-on'))
  await $.prompt.submit(typed('task'))
  expect(w.panels).toHaveLength(2)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`pick-1 grades on click and shows the explanation (${surface})`, async ($, on) => {
    const w = world(on, { deck: [1] }) // question 1 is pick-1
    await $.prompt.submit(typed('task'))
    const shown = w.panel()
    if (shown?.kind !== 'question') throw new Error('no question')
    const q = questionById(shown.qid)
    if (!q) throw new Error('unknown question')
    const right = present(q, shown.order).correct[0] as number

    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ key: 'domain' }))?.text).toContain(q.domain)
    expect((await ui.find({ key: 'question' }))?.text).toBe(q.question)
    expect(await ui.find({ key: 'pick2' })).toBeUndefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)

    await ui.press({ key: `opt-${right}` })
    expect((await ui.find({ key: 'verdict' }))?.text).toBe('Correct.')
    expect((await ui.find({ key: `opt-${right}` }))?.text).toMatch(/^✓/)
    expect((await ui.find({ key: 'explanation' }))?.text).toBe(q.explanation)
    expect((await ui.find({ key: 'summary' }))?.text).toContain('Quiz 1/1 · streak 1')
    expect(await ui.find({ key: 'next' })).toBeDefined()

    await ui.press({ key: 'dismiss' })
    expect(w.panel()).toBeNull()
    await ui.unmount()
  })

  test(`pick-2 needs both, then Submit; a half-right answer is wrong (${surface})`, async ($, on) => {
    const w = world(on, { deck: [2] }) // question 2 is pick-2
    await $.prompt.submit(typed('task'))
    const shown = w.panel()
    if (shown?.kind !== 'question') throw new Error('no question')
    const q = questionById(shown.qid)
    if (!q) throw new Error('unknown question')
    const { correct } = present(q, shown.order)
    const wrong = [0, 1, 2, 3].find(i => !correct.includes(i)) as number

    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ key: 'pick2' }))?.text).toContain('Pick 2')
    expect(await ui.find({ key: 'submit' })).toBeUndefined()

    await ui.press({ key: `opt-${correct[0]}` })
    expect(await ui.find({ key: 'submit' })).toBeUndefined() // one is not enough
    await ui.press({ key: `opt-${wrong}` })
    await ui.press({ key: 'submit' })

    expect((await ui.find({ key: 'verdict' }))?.text).toBe('Not quite.')
    expect((await ui.find({ key: `opt-${wrong}` }))?.text).toMatch(/^✗/)
    expect((await ui.find({ key: `opt-${correct[0]}` }))?.text).toMatch(/^✓/)
    expect((await ui.find({ key: `opt-${correct[1]}` }))?.text).toMatch(/^→/) // highlighted, not chosen
    expect((await ui.find({ key: 'summary' }))?.text).toContain('Quiz 0/1 · streak 0')

    // Next question replaces it with a fresh, unanswered one.
    await ui.press({ key: 'next' })
    const after = w.panel()
    expect(after?.kind === 'question' && !after.isGraded && after.qid !== q.id).toBe(true)
    await ui.unmount()
  })

  test(`pick-2 with exactly the right two is correct (${surface})`, async ($, on) => {
    const w = world(on, { deck: [2] })
    await $.command.run(command('quiz'))
    const shown = w.panel()
    if (shown?.kind !== 'question') throw new Error('no question')
    const q = questionById(shown.qid)
    if (!q) throw new Error('unknown question')
    const { correct } = present(q, shown.order)
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: `opt-${correct[1]}` })
    await ui.press({ key: `opt-${correct[0]}` })
    await ui.press({ key: 'submit' })
    expect((await ui.find({ key: 'verdict' }))?.text).toBe('Correct.')
    await ui.unmount()
  })
}

test('the pane draws the quiz on mobile', async ($, on) => {
  const w = world(on, { deck: [1] })
  await $.command.run(command('quiz'))
  expect(w.panel()?.kind).toBe('question')
  const ui = await $.ui.mount({
    plugin: 'task-quiz',
    surface: 'mobile',
    component: 'Pane',
    requestId: 'task-quiz',
    props: {
      title: 'Quiz',
      isFocused: false,
      bodyColumns: 40,
      placement: 'inline',
      scroll: { offset: 0, bodyRows: 20 },
      view: {},
    },
  })
  expect((await ui.find({ key: 'question' }))?.text).toBe(questionById(1)?.question)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
  await ui.unmount()
})

test('an unanswered question is replaced when the next task starts', async ($, on) => {
  const w = world(on)
  await $.prompt.submit(typed('first task'))
  const first = w.panel()
  await $.prompt.submit(typed('second task'))
  const second = w.panel()
  if (first?.kind !== 'question' || second?.kind !== 'question') throw new Error('no question')
  expect(second.qid).not.toBe(first.qid)
  expect(second.isGraded).toBe(false)
})

test('/quiz-stats shows overall accuracy and the 3 weakest domains', async ($, on) => {
  const w = world(on, {
    stats: {
      answered: 8,
      correct: 4,
      streak: 0,
      domains: {
        'API Mechanics': { correct: 0, answered: 2 },
        'Tools & MCPs': { correct: 1, answered: 2 },
        'Prompt Engineering': { correct: 1, answered: 2 },
        'Model Selection': { correct: 2, answered: 2 },
      },
    },
  })
  const answer = await $.command.run(command('quiz-stats'))
  expect(answer.text).toBeUndefined() // nothing for the model to read
  const view = w.panel()
  if (view?.kind !== 'stats') throw new Error('no stats view')
  expect(view.weakest.map(d => d.domain)).toEqual(['API Mechanics', 'Prompt Engineering', 'Tools & MCPs'])
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'overall' }))?.text).toContain('50%')
  expect((await ui.find({ key: 'weak-0' }))?.text).toContain('API Mechanics: 0%')
  await ui.unmount()
})

test('/quiz-set limits questions to one practice set', async ($, on) => {
  const w = world(on)
  await $.command.run(command('quiz-set', '4'))
  for (let i = 0; i < 5; i++) {
    await $.command.run(command('quiz'))
    const shown = w.panel()
    if (shown?.kind !== 'question') throw new Error('no question')
    expect(questionById(shown.qid)?.set).toBe('Practice Set IV')
  }
})
