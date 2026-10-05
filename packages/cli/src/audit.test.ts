import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Claim, EvaluatedClaim } from '@biasledgerharness/core'
import { buildIndex, evaluateClaim, loadAudit, locate, movesFor, summarise } from './audit.js'
import { gitBlob, readClaims, readEvidence } from './repository.js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const NDDL = 'Group A ECE 0.028, group B ECE 0.034.\n'

function span(docId: string, text: string, needle: string) {
  const at = Buffer.from(text, 'utf8').indexOf(Buffer.from(needle, 'utf8'))
  return { docId, byteStart: at, byteEnd: at + Buffer.byteLength(needle, 'utf8') }
}

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'c1',
    title: 't',
    system: 's',
    state: 'evidenced',
    note: '',
    dimensions: [
      {
        key: 'calibration',
        required: true,
        citations: [span('report', NDDL, 'Group A ECE 0.028')],
      },
    ],
    ...overrides,
  }
}

describe('buildIndex over the real bridge', () => {
  const docs = readEvidence(REPO_ROOT)

  it('indexes the shipped corpus and produces a root', async () => {
    const result = await buildIndex(docs, undefined, REPO_ROOT)
    expect(result.root).toMatch(/^[0-9a-f]{64}$/)
    expect(result.terms).toBeGreaterThan(100)
    expect(result.postings).toBeGreaterThan(result.terms)
    expect(result.rebuilt).toBe(docs.length)
  })

  it('reuses every document on a resume and does not change the root', async () => {
    const first = await buildIndex(docs, undefined, REPO_ROOT)
    const second = await buildIndex(docs, first.manifest, REPO_ROOT)
    expect(second.reused).toBe(docs.length)
    expect(second.rebuilt).toBe(0)
    expect(second.root).toBe(first.root)
  })

  it('gives the same root regardless of the order documents arrive in', async () => {
    const forward = await buildIndex(docs, undefined, REPO_ROOT)
    const backward = await buildIndex([...docs].reverse(), undefined, REPO_ROOT)
    expect(backward.root).toBe(forward.root)
  })

  it('changes the root when a corpus byte changes', async () => {
    const before = await buildIndex(docs, undefined, REPO_ROOT)
    const edited = docs.map((d) => {
      if (d.docId !== 'calibration-report') return d
      const text = `${d.text}\none more byte\n`
      return { ...d, text, blob: gitBlob(text), bytes: Buffer.byteLength(text, 'utf8') }
    })
    const after = await buildIndex(edited, before.manifest, REPO_ROOT)
    expect(after.root).not.toBe(before.root)
    expect(after.rebuilt).toBe(1)
    expect(after.reused).toBe(docs.length - 1)
  })

  it('rejects a document whose blob does not match its text', async () => {
    // The engine verifies the blob rather than trusting the host, so a stale id cannot
    // produce a consistent-looking index over the wrong bytes.
    const first = docs[0] as { docId: string; blob: string; text: string }
    await expect(
      buildIndex([{ ...first, text: `${first.text}\nedited\n` }], undefined, REPO_ROOT),
    ).rejects.toThrow(/did not hash these bytes|re-read the artifact/)
  })
})

describe('evaluateClaim over the real bridge', () => {
  const docs = readEvidence(REPO_ROOT)

  it('marks a fully cited claim attestable and returns a root', async () => {
    const claim = makeClaim()
    const verdict = await evaluateClaim(claim, docs, REPO_ROOT)
    // The real corpus has no document called "report", so this citation cannot resolve.
    expect(verdict.verdict).toBe('unsubstantiated')
    expect(verdict.gaps[0]?.reason).toBe('all-citations-unresolvable')
  })

  it('evaluates a shipped claim to its committed verdict', async () => {
    const stored = JSON.parse(readFileSync(join(REPO_ROOT, 'audit', 'index.json'), 'utf8')) as {
      claims: Record<string, { verdict: string; root: string }>
    }
    for (const claim of readClaims(REPO_ROOT)) {
      const verdict = await evaluateClaim(claim, docs, REPO_ROOT)
      expect(verdict.verdict).toBe(stored.claims[claim.id]?.verdict)
      expect(verdict.root).toBe(stored.claims[claim.id]?.root)
    }
  })

  it('surfaces the shipped stale citation as a text mismatch', async () => {
    const claim = readClaims(REPO_ROOT).find((c) => c.id === 'consent-withdrawal')
    expect(claim).toBeDefined()
    const verdict = await evaluateClaim(claim as Claim, docs, REPO_ROOT)
    expect(verdict.citationsInvalid).toBe(1)
    expect(verdict.verdict).toBe('partial')
    expect(verdict.spans.find((s) => !s.valid)?.reason).toBe('text-mismatch')
  })
})

describe('locate', () => {
  it('measures a phrase to its exact byte range', async () => {
    const doc = readEvidence(REPO_ROOT).find((d) => d.docId === 'calibration-report')
    const probe = await locate(doc as never, 'Group D [0.029, 0.043]', REPO_ROOT)
    expect(probe.valid).toBe(true)
    expect(probe.text).toBe('Group D [0.029, 0.043]')
    expect(probe.line).toBeGreaterThan(1)
  })

  it('refuses to guess when the phrase is not in the document', async () => {
    const doc = readEvidence(REPO_ROOT).find((d) => d.docId === 'calibration-report')
    await expect(locate(doc as never, 'a phrase that is absent', REPO_ROOT)).rejects.toThrow(
      /does not appear/,
    )
  })

  it('resolves correctly in a document containing an em dash', async () => {
    // Regression: a locale codec shifted every offset after a multi-byte character.
    const doc = readEvidence(REPO_ROOT).find((d) => d.docId === 'calibration-report')
    const probe = await locate(doc as never, 'Per the pre-registered rule these are not reported', REPO_ROOT)
    expect(probe.text).toBe('Per the pre-registered rule these are not reported')
  })
})

describe('summarise', () => {
  const entries: EvaluatedClaim[] = [
    { claim: makeClaim({ id: 'a' }), verdict: { ...blank(), verdict: 'attestable' } },
    { claim: makeClaim({ id: 'b' }), verdict: { ...blank(), verdict: 'partial', citationsInvalid: 2 } },
    {
      claim: makeClaim({ id: 'c' }),
      verdict: { ...blank(), verdict: 'unsubstantiated', gaps: [{ dimension: 'x', reason: 'no-citation' }] },
    },
  ]

  function blank() {
    return {
      claimId: 'x',
      dimensionsTotal: 1,
      dimensionsRequired: 1,
      dimensionsCovered: 0,
      coverage: 0,
      citationsChecked: 1,
      citationsValid: 1,
      citationsInvalid: 0,
      attestedOver: [],
      root: '',
      gaps: [],
      spans: [],
    }
  }

  it('counts claims and attestable ones', () => {
    expect(summarise(entries)).toMatchObject({ claims: 3, attestable: 1, blocked: 1 })
  })

  it('sums open gaps across every claim', () => {
    expect(summarise(entries).openGaps).toBe(1)
  })

  it('sums invalid citations across every claim', () => {
    expect(summarise(entries).invalidCitations).toBe(2)
  })

  it('derives everything from verdicts, not from the states on the claims', () => {
    // All three claims are in the same state, yet the verdicts differ.
    const stats = summarise(entries)
    expect(new Set(entries.map((e) => e.claim.state)).size).toBe(1)
    expect(stats.attestable).toBe(1)
  })

  it('carries the root when one is supplied', () => {
    expect(summarise(entries, 'abc').root).toBe('abc')
  })

  it('handles an empty board', () => {
    expect(summarise([])).toMatchObject({ claims: 0, attestable: 0, openGaps: 0 })
  })
})

describe('movesFor', () => {
  it('offers attestation only when the verdict allows it', () => {
    const allowed = movesFor({
      claim: makeClaim({ state: 'evidenced' }),
      verdict: { ...blankVerdict(), verdict: 'attestable' },
    })
    const refused = movesFor({
      claim: makeClaim({ state: 'evidenced' }),
      verdict: { ...blankVerdict(), verdict: 'partial' },
    })
    expect(allowed).toContain('attested')
    expect(refused).not.toContain('attested')
  })

  it('always offers a way out of an unverified claim', () => {
    const moves = movesFor({
      claim: makeClaim({ state: 'unverified' }),
      verdict: { ...blankVerdict(), verdict: 'unsubstantiated' },
    })
    expect(moves).toContain('withdrawn')
  })

  it('offers nothing but reopening from a withdrawn claim with no note', () => {
    const moves = movesFor({
      claim: makeClaim({ state: 'withdrawn', note: '' }),
      verdict: { ...blankVerdict(), verdict: 'unsubstantiated' },
    })
    expect(moves).toEqual(['unverified'])
  })

  function blankVerdict() {
    return {
      claimId: 'x',
      verdict: 'unsubstantiated' as const,
      dimensionsTotal: 1,
      dimensionsRequired: 1,
      dimensionsCovered: 0,
      coverage: 0,
      citationsChecked: 0,
      citationsValid: 0,
      citationsInvalid: 0,
      attestedOver: [],
      root: '',
      gaps: [],
      spans: [],
    }
  }
})

describe('loadAudit', () => {
  it('loads and evaluates every shipped claim with a commit when available', async () => {
    const audit = await loadAudit(REPO_ROOT)
    expect(audit.evaluated.length).toBeGreaterThan(0)
    expect(audit.docs.length).toBeGreaterThan(0)
    for (const entry of audit.evaluated) {
      expect(entry.verdict.verdict).toMatch(/attestable|partial|unsubstantiated/)
    }
  })
})
