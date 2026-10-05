import { describe, expect, it } from 'vitest'
import type { Claim, ClaimVerdict, EvaluatedClaim } from '@biasledgerharness/core'
import { CLAIM_STATES } from '@biasledgerharness/core'
import { boardCounts, emptyCursor, keyToAction, moveCursor, renderBoard, renderStrip } from './board.js'

const CORPUS = [
  { docId: 'model-card', bytes: 4000 },
  { docId: 'calibration-report', bytes: 1463 },
]

function verdict(overrides: Partial<ClaimVerdict> = {}): ClaimVerdict {
  return {
    claimId: 'c',
    verdict: 'attestable',
    dimensionsTotal: 2,
    dimensionsRequired: 2,
    dimensionsCovered: 2,
    coverage: 1,
    citationsChecked: 2,
    citationsValid: 2,
    citationsInvalid: 0,
    attestedOver: ['model-card'],
    root: 'a'.repeat(64),
    gaps: [],
    spans: [
      {
        dimension: 'calibration',
        docId: 'model-card',
        blob: 'bb'.repeat(20),
        byteStart: 200,
        byteEnd: 900,
        line: 4,
        valid: true,
        reason: 'ok',
        text: 'calibration error is 0.031',
      },
    ],
    ...overrides,
  }
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'claim-one',
    title: 'A fairness claim that is reasonably long so it needs truncating on a narrow board',
    system: 'sys',
    state: 'evidenced',
    note: '',
    dimensions: [],
    ...overrides,
  }
}

function entry(overrides: Partial<EvaluatedClaim> = {}): EvaluatedClaim {
  return { claim: claim(), verdict: verdict(), ...overrides }
}

describe('renderStrip', () => {
  it('draws a citation at its real proportional position', () => {
    const strip = renderStrip([{ from: 0, to: 50, valid: true }], 100, 10)
    expect(strip).toBe('#####.....')
  })

  it('draws nothing but gap for an uncited document', () => {
    expect(renderStrip([], 100, 8)).toBe('........')
  })

  it('marks a rotted citation distinctly from a good one', () => {
    const strip = renderStrip([{ from: 0, to: 100, valid: false }], 100, 4)
    expect(strip).toBe('xxxx')
  })

  it('merges overlapping citations into one contiguous run', () => {
    const strip = renderStrip(
      [
        { from: 0, to: 40, valid: true },
        { from: 30, to: 60, valid: true },
      ],
      100,
      10,
    )
    expect(strip).toBe('######....')
  })

  it('rounds a citation outward so it is never hidden', () => {
    // A 1% citation in 10 columns would floor to nothing if it rounded inward.
    const strip = renderStrip([{ from: 1, to: 2, valid: true }], 100, 10)
    expect(strip).toContain('#')
  })

  it('clamps a citation that runs past the end instead of throwing', () => {
    const strip = renderStrip([{ from: 90, to: 9999, valid: true }], 100, 10)
    expect(strip).toBe('.........#')
  })

  it('clamps a negative offset', () => {
    // 10 bytes of 100 in five columns rounds outward to a single column, never zero.
    expect(renderStrip([{ from: -50, to: 10, valid: true }], 100, 5)).toBe('#....')
  })

  it('always fills the requested width', () => {
    expect(renderStrip([{ from: 0, to: 1, valid: true }], 1000, 12)).toHaveLength(12)
  })

  it('renders an empty band for a document of unknown length', () => {
    expect(renderStrip([], 0, 6)).toBe('......')
  })
})

describe('renderBoard', () => {
  it('shows every lifecycle state, even the empty ones', () => {
    const out = renderBoard({ evaluated: [], corpus: CORPUS })
    for (const state of CLAIM_STATES) expect(out).toContain(state.toUpperCase())
  })

  it('says none rather than leaving a bare heading', () => {
    expect(renderBoard({ evaluated: [], corpus: CORPUS })).toContain('(none)')
  })

  it('draws a lineage strip for a claim that cites something', () => {
    const out = renderBoard({ evaluated: [entry()], corpus: CORPUS })
    expect(out).toContain('model-card')
    // The citation starts 5% into a 4000-byte document, so the band opens with a gap.
    expect(out).toMatch(/\[[.]+#+[.]*\]/)
  })

  it('reports how many corpus documents a claim does not cite', () => {
    const out = renderBoard({ evaluated: [entry()], corpus: CORPUS })
    expect(out).toContain('+1 corpus document(s) not cited')
  })

  it('lists each gap by dimension and reason', () => {
    const out = renderBoard({
      evaluated: [
        entry({
          verdict: verdict({
            verdict: 'unsubstantiated',
            gaps: [{ dimension: 'consent', reason: 'no-citation' }],
          }),
        }),
      ],
      corpus: CORPUS,
    })
    expect(out).toContain('gap: consent (no-citation)')
  })

  it('includes the commit when one is known and omits it when not', () => {
    const sha = 'f'.repeat(40)
    expect(renderBoard({ evaluated: [], corpus: CORPUS, commit: sha })).toContain('fffffff')
    expect(renderBoard({ evaluated: [], corpus: CORPUS })).not.toContain('@')
  })

  it('carries the evidence root into the header', () => {
    const out = renderBoard({ evaluated: [], corpus: CORPUS, root: 'deadbeef' })
    expect(out).toContain('deadbeef')
  })

  it('always prints the legend so the glyphs are readable', () => {
    const out = renderBoard({ evaluated: [entry()], corpus: CORPUS })
    expect(out).toContain('legend:')
    expect(out).toContain('citation resolved')
  })

  it('never exceeds the requested width, on any line', () => {
    const out = renderBoard({ evaluated: [entry()], corpus: CORPUS, width: 40 })
    for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(40)
  })
})

describe('keyToAction', () => {
  it('maps hjkl to movement', () => {
    expect(keyToAction('h')).toEqual({ kind: 'move', dx: -1, dy: 0 })
    expect(keyToAction('l')).toEqual({ kind: 'move', dx: 1, dy: 0 })
    expect(keyToAction('k')).toEqual({ kind: 'move', dx: 0, dy: -1 })
    expect(keyToAction('j')).toEqual({ kind: 'move', dx: 0, dy: 1 })
  })

  it('maps the arrow escape sequences to the same movement', () => {
    expect(keyToAction('\u001b[D')).toEqual({ kind: 'move', dx: -1, dy: 0 })
    expect(keyToAction('\u001b[B')).toEqual({ kind: 'move', dx: 0, dy: 1 })
  })

  it('maps enter and q', () => {
    expect(keyToAction('\r')).toEqual({ kind: 'select' })
    expect(keyToAction('q')).toEqual({ kind: 'quit' })
  })

  it('treats an unknown key as a no-op rather than guessing', () => {
    expect(keyToAction('z')).toEqual({ kind: 'none' })
    expect(keyToAction('')).toEqual({ kind: 'none' })
  })
})

describe('moveCursor', () => {
  const counts = [2, 1, 3]

  it('moves within a column', () => {
    expect(moveCursor({ column: 0, row: 0 }, { kind: 'move', dx: 0, dy: 1 }, counts)).toEqual({
      column: 0,
      row: 1,
    })
  })

  it('moves between columns and keeps the row in range', () => {
    // Column 1 holds one claim, so row 1 must clamp to row 0.
    expect(moveCursor({ column: 0, row: 1 }, { kind: 'move', dx: 1, dy: 0 }, counts)).toEqual({
      column: 1,
      row: 0,
    })
  })

  it('clamps at the left edge instead of wrapping', () => {
    expect(moveCursor({ column: 0, row: 0 }, { kind: 'move', dx: -1, dy: 0 }, counts).column).toBe(0)
  })

  it('clamps at the right edge instead of wrapping', () => {
    expect(moveCursor({ column: 2, row: 0 }, { kind: 'move', dx: 1, dy: 0 }, counts).column).toBe(2)
  })

  it('clamps above the first row', () => {
    expect(moveCursor({ column: 2, row: 2 }, { kind: 'move', dx: 0, dy: -1 }, counts).row).toBe(1)
  })

  it('clamps below the last row', () => {
    expect(moveCursor({ column: 0, row: 0 }, { kind: 'move', dx: 0, dy: 9 }, counts).row).toBe(1)
  })

  it('puts the cursor at row zero when it enters an empty column', () => {
    const withEmpty = [2, 0]
    expect(moveCursor({ column: 0, row: 1 }, { kind: 'move', dx: 1, dy: 0 }, withEmpty).row).toBe(0)
  })

  it('does not throw when there are no columns at all', () => {
    expect(moveCursor(emptyCursor(), { kind: 'move', dx: 1, dy: 0 }, []).column).toBe(0)
  })
})

describe('boardCounts', () => {
  it('has one count per lifecycle state', () => {
    expect(boardCounts([])).toHaveLength(CLAIM_STATES.length)
  })

  it('counts claims per column', () => {
    const entries = [
      entry({ claim: claim({ state: 'attested' }) }),
      entry({ claim: claim({ state: 'attested' }) }),
      entry({ claim: claim({ state: 'evidenced' }) }),
    ]
    const counts = boardCounts(entries)
    expect(counts[CLAIM_STATES.indexOf('attested')]).toBe(2)
    expect(counts[CLAIM_STATES.indexOf('evidenced')]).toBe(1)
    expect(counts[CLAIM_STATES.indexOf('withdrawn')]).toBe(0)
  })
})
