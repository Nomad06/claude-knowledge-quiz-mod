import { describe, expect, test } from 'claude-code/testing'

import { QUESTIONS } from '../hooks/questions'
import {
  ALL_IDS,
  drawFromDeck,
  eligibleIds,
  grade,
  isExactSet,
  present,
  questionById,
  seededRng,
  setNumber,
  shuffleOrder,
} from '../hooks/quiz'

describe('option shuffle', () => {
  test('remaps correct so the same option text stays correct', () => {
    const rng = seededRng(7)
    let moved = 0
    for (let round = 0; round < 20; round++) {
      for (const q of QUESTIONS) {
        const order = shuffleOrder(q, rng)
        // A permutation of every option index.
        expect([...order].sort((a, b) => a - b)).toEqual(q.options.map((_, i) => i))
        const shown = present(q, order)
        expect(shown.options).toHaveLength(q.options.length)
        expect(shown.correct).toHaveLength(q.correct.length)
        const wanted = q.correct.map(c => q.options[c]).sort()
        const got = shown.correct.map(c => shown.options[c]).sort()
        expect(got).toEqual(wanted)
        // Picking the remapped answer grades right.
        expect(grade(q, order, shown.correct)).toBe(true)
        if (shown.correct.some((c, k) => c !== [...q.correct].sort((a, b) => a - b)[k])) moved++
      }
    }
    // The shuffle really moves answers around (not the identity).
    expect(moved).toBeGreaterThan(QUESTIONS.length * 10)
  })

  test('the correct answer lands on every letter over many shuffles', () => {
    const q = questionById(1)
    expect(q).toBeDefined()
    if (!q) return
    const rng = seededRng(42)
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) seen.add(present(q, shuffleOrder(q, rng)).correct[0] ?? -1)
    expect([...seen].sort()).toEqual([0, 1, 2, 3])
  })
})

describe('pick-2 grading', () => {
  test('is exact-set only', () => {
    expect(isExactSet([0, 1], [0, 1])).toBe(true)
    expect(isExactSet([1, 0], [0, 1])).toBe(true)
    expect(isExactSet([0], [0, 1])).toBe(false) // one of two
    expect(isExactSet([0, 2], [0, 1])).toBe(false) // one right, one wrong
    expect(isExactSet([0, 1, 2], [0, 1])).toBe(false) // a superset
    expect(isExactSet([0, 0], [0, 1])).toBe(false) // a repeat
    expect(isExactSet([2, 3], [0, 1])).toBe(false)
    expect(isExactSet([], [0, 1])).toBe(false)
  })

  test('grades a real pick-2 question through its shuffle', () => {
    const q = QUESTIONS.find(one => one.pick === 2)
    expect(q).toBeDefined()
    if (!q) return
    const order = shuffleOrder(q, seededRng(3))
    const { correct } = present(q, order)
    const wrong = [0, 1, 2, 3].filter(i => !correct.includes(i))
    expect(grade(q, order, correct)).toBe(true)
    expect(grade(q, order, [correct[0] as number, wrong[0] as number])).toBe(false)
    expect(grade(q, order, [correct[0] as number])).toBe(false)
    expect(grade(q, order, wrong)).toBe(false)
  })
})

describe('deck', () => {
  test('never repeats a question before every one has been shown', () => {
    const rng = seededRng(11)
    let deck: number[] = []
    for (let cycle = 0; cycle < 3; cycle++) {
      const seen = new Set<number>()
      for (let i = 0; i < ALL_IDS.length; i++) {
        const drawn = drawFromDeck(deck, ALL_IDS, rng)
        expect(drawn).toBeDefined()
        if (!drawn) return
        expect(seen.has(drawn.id)).toBe(false)
        seen.add(drawn.id)
        deck = drawn.deck
      }
      expect(seen.size).toBe(176)
      expect(deck).toHaveLength(0)
    }
  })

  test('a set filter draws only that set, without repeats, and keeps other sets unseen', () => {
    const rng = seededRng(5)
    const set3 = eligibleIds(3)
    expect(set3.length).toBe(30)
    let deck: number[] = []
    const seen = new Set<number>()
    for (let i = 0; i < set3.length; i++) {
      const drawn = drawFromDeck(deck, set3, rng)
      if (!drawn) throw new Error('no draw')
      const q = questionById(drawn.id)
      expect(q && setNumber(q.set)).toBe(3)
      expect(seen.has(drawn.id)).toBe(false)
      seen.add(drawn.id)
      deck = drawn.deck
    }
    // The rest of the cycle is still waiting in the deck.
    expect(deck).toHaveLength(176 - 30)
    // Drawing from set 3 again starts a fresh round of set 3.
    const again = drawFromDeck(deck, set3, rng)
    expect(again && setNumber(questionById(again.id)?.set ?? '')).toBe(3)
  })

  test('drops unknown ids from a stored deck', () => {
    const drawn = drawFromDeck([9999, 5], ALL_IDS, seededRng(1))
    expect(drawn?.id).toBe(5)
    expect(drawn?.deck).toEqual([])
  })
})
