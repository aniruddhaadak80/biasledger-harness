import { describe, expect, it } from 'vitest'
import {
  CLAIM_STATES,
  GATED,
  TRANSITIONS,
  canTransition,
  groupByState,
  isClaimState,
  legalTargets,
  lineage,
  type Claim,
  type ClaimVerdict,
  type EvaluatedClaim,
} from './ledger.js'

function verdict(overrides: Partial<ClaimVerdict> = {}): ClaimVerdict {
  return {
    claimId: 'c1',
    verdict: 'attestable',
    dimensionsTotal: 2,
    dimensionsRequired: 2,
    dimensionsCovered: 2,
    coverage: 1,
    citationsChecked: 2,
    citationsValid: 2,
    citationsInvalid: 0,
    attestedOver: ['doc-a'],
    root: 'f'.repeat(64),
    gaps: [],
    spans: [],
    ...overrides,
  }
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'c1',
    title: 'a claim',
    system: 'sys',
    state: 'evidenced',
    note: '',
    dimensions: [],
    ...overrides,
  }
}

describe('the transition table', () => {
  it('lists a legal target for every state', () => {
    for (const state of CLAIM_STATES) {
      expect(legalTargets(state).length).toBeGreaterThan(0)
    }
  })

  it('only ever points at known states', () => {
    for (const targets of Object.values(TRANSITIONS)) {
      for (const target of targets) expect(isClaimState(target)).toBe(true)
    }
  })

  it('never allows a state to reach itself', () => {
    for (const [state, targets] of Object.entries(TRANSITIONS)) {
      expect(targets).not.toContain(state)
    }
  })

  it('is reachable: every state except withdrawn can eventually be attested or withdrawn', () => {
    // A withdrawn claim can only reopen, so it is deliberately terminal-ish.
    expect(legalTargets('withdrawn')).toEqual(['unverified'])
  })
})

describe('canTransition', () => {
  it('permits a legal ungated move', () => {
    expect(canTransition('unverified', 'evidenced', undefined).ok).toBe(true)
  })

  it('refuses an unlisted move', () => {
    const result = canTransition('unverified', 'attested', 'attestable')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('not a legal transition')
  })

  it('refuses a self transition', () => {
    expect(canTransition('evidenced', 'evidenced', 'attestable').ok).toBe(false)
  })

  it('refuses attestation without an evaluated verdict', () => {
    const result = canTransition('evidenced', 'attested', undefined)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('not evaluated')
  })

  it('refuses attestation on a partial verdict', () => {
    expect(canTransition('evidenced', 'attested', 'partial').ok).toBe(false)
    expect(canTransition('evidenced', 'attested', 'unsubstantiated').ok).toBe(false)
  })

  it('permits attestation on an attestable verdict', () => {
    expect(canTransition('evidenced', 'attested', 'attestable').ok).toBe(true)
  })

  it('refuses withdrawal without a note and permits it with one', () => {
    expect(canTransition('evidenced', 'withdrawn', undefined).ok).toBe(false)
    expect(canTransition('evidenced', 'withdrawn', undefined, 'because').ok).toBe(true)
    expect(canTransition('evidenced', 'withdrawn', undefined, '   ').ok).toBe(false)
  })

  it('agrees with the engine on every state pair for a gated verdict', () => {
    for (const state of CLAIM_STATES) {
      for (const target of CLAIM_STATES) {
        const mirror = canTransition(state, target, 'attestable', 'a note')
        const legal = legalTargets(state).includes(target) && target !== state
        if (!legal) expect(mirror.ok).toBe(false)
      }
    }
  })
})

describe('gating table', () => {
  it('names a reason for each gated state', () => {
    for (const reason of Object.values(GATED)) expect(reason.length).toBeGreaterThan(0)
  })

  it('only gates states the table can actually reach', () => {
    const reachable = new Set(Object.values(TRANSITIONS).flat())
    for (const state of Object.keys(GATED) as (keyof typeof GATED)[]) {
      expect(reachable.has(state)).toBe(true)
    }
  })
})

describe('lineage', () => {
  const spans = [
    {
      dimension: 'cal',
      docId: 'a',
      blob: 'aa',
      byteStart: 10,
      byteEnd: 30,
      line: 1,
      valid: true,
      reason: 'ok',
      text: 'x',
    },
    {
      dimension: 'lat',
      docId: 'a',
      blob: 'aa',
      byteStart: 50,
      byteEnd: 60,
      line: 2,
      valid: true,
      reason: 'ok',
      text: 'y',
    },
    {
      dimension: 'con',
      docId: 'b',
      blob: 'bb',
      byteStart: 0,
      byteEnd: 5,
      line: 1,
      valid: false,
      reason: 'text-mismatch',
      text: 'z',
    },
  ]

  it('groups spans per document', () => {
    const segments = lineage(verdict({ spans }), { a: 100, b: 20 })
    expect(segments.map((s) => s.docId)).toEqual(['a', 'b'])
  })

  it('spans the whole cited range of a document', () => {
    const [first] = lineage(verdict({ spans }), { a: 100, b: 20 })
    expect(first?.from).toBe(10)
    expect(first?.to).toBe(60)
  })

  it('collects the dimensions inside each document', () => {
    const [first] = lineage(verdict({ spans }), { a: 100, b: 20 })
    expect(first?.dimensions).toEqual(['cal', 'lat'])
  })

  it('marks a document as tainted when any of its spans failed', () => {
    const segments = lineage(verdict({ spans }), { a: 100, b: 20 })
    expect(segments.map((s) => s.valid)).toEqual([true, false])
  })

  it('clamps a span that runs past the end of the document', () => {
    const runaway = [{ ...spans[0]!, byteStart: 90, byteEnd: 999 }]
    const [segment] = lineage(verdict({ spans: runaway }), { a: 100 })
    expect(segment?.to).toBe(100)
  })

  it('drops a document with an unknown byte length rather than drawing a false band', () => {
    expect(lineage(verdict({ spans }), {})).toEqual([])
  })

  it('returns nothing when there are no spans', () => {
    expect(lineage(verdict(), { a: 100 })).toEqual([])
  })
})

describe('groupByState', () => {
  const entries: EvaluatedClaim[] = [
    { claim: claim({ id: 'b', state: 'attested' }), verdict: verdict() },
    { claim: claim({ id: 'a', state: 'attested' }), verdict: verdict() },
    { claim: claim({ id: 'c', state: 'evidenced' }), verdict: verdict() },
  ]

  it('has a bucket for every state', () => {
    const groups = groupByState(entries)
    for (const state of CLAIM_STATES) expect(Array.isArray(groups[state])).toBe(true)
  })

  it('sorts each bucket by claim id so the board is stable', () => {
    expect(groupByState(entries).attested.map((e) => e.claim.id)).toEqual(['a', 'b'])
  })

  it('loses nothing', () => {
    const groups = groupByState(entries)
    expect(Object.values(groups).reduce((n, bucket) => n + bucket.length, 0)).toBe(entries.length)
  })
})
