/**
 * The claim domain, mirrored from the Python engine's contract.
 *
 * This file holds the *shapes* and the *pure derivations* that more than one surface needs:
 * the board renderer, the doctor probe, the MCP tools and the web API. It deliberately holds
 * no I/O and makes no decisions the engine makes — the engine remains the only thing that may
 * decide whether evidence supports a claim. What lives here is the presentation-independent
 * arithmetic: which columns a claim can occupy, how a coverage ratio is drawn, and how a
 * span is positioned inside a document.
 */

export const CLAIM_STATES = ['unverified', 'evidenced', 'challenged', 'attested', 'withdrawn'] as const

export type ClaimState = (typeof CLAIM_STATES)[number]

export const VERDICTS = ['attestable', 'partial', 'unsubstantiated'] as const

export type Verdict = (typeof VERDICTS)[number]

/** The only legal moves. Anything not listed here is refused. Mirrors the engine exactly. */
export const TRANSITIONS: Readonly<Record<ClaimState, readonly ClaimState[]>> = {
  unverified: ['evidenced', 'withdrawn'],
  evidenced: ['challenged', 'attested', 'withdrawn'],
  challenged: ['evidenced', 'attested', 'withdrawn'],
  attested: ['challenged', 'withdrawn'],
  withdrawn: ['unverified'],
}

/** Reaching these states is conditional, not merely legal. */
export const GATED: Readonly<Partial<Record<ClaimState, string>>> = {
  attested: "the verdict must be 'attestable'",
  withdrawn: 'a non-empty note is required',
}

export interface Citation {
  readonly docId: string
  readonly byteStart: number
  readonly byteEnd: number
  /** What the citation claimed to say. Optional, and the thing that catches drift. */
  readonly expects?: string
}

export interface Dimension {
  readonly key: string
  readonly required: boolean
  readonly citations: readonly Citation[]
}

export interface Claim {
  readonly id: string
  readonly title: string
  readonly system: string
  readonly state: ClaimState
  readonly note: string
  readonly dimensions: readonly Dimension[]
}

export interface Gap {
  readonly dimension: string
  readonly reason: string
}

export interface Span {
  readonly dimension: string
  readonly docId: string
  readonly blob: string
  readonly byteStart: number
  readonly byteEnd: number
  readonly line: number
  readonly valid: boolean
  readonly reason: string
  readonly text: string
}

/** The engine's answer. `root` is an attestation over `attestedOver` and nothing else. */
export interface ClaimVerdict {
  readonly claimId: string
  readonly verdict: Verdict
  readonly dimensionsTotal: number
  readonly dimensionsRequired: number
  readonly dimensionsCovered: number
  readonly coverage: number
  readonly citationsChecked: number
  readonly citationsValid: number
  readonly citationsInvalid: number
  readonly attestedOver: readonly string[]
  readonly root: string
  readonly gaps: readonly Gap[]
  readonly spans: readonly Span[]
}

export function legalTargets(state: ClaimState): readonly ClaimState[] {
  return TRANSITIONS[state]
}

export function isClaimState(value: string): value is ClaimState {
  return (CLAIM_STATES as readonly string[]).includes(value)
}

/**
 * May this claim move to `to`, given the verdict?
 *
 * This is a *presentation* of the engine's rule, used to grey out an illegal move in the
 * board before anyone presses it. The engine still decides: a client-side check is a
 * courtesy, never the authority.
 */
export function canTransition(
  state: ClaimState,
  to: ClaimState,
  verdict: Verdict | undefined,
  note?: string,
): { readonly ok: boolean; readonly reason: string } {
  if (to === state) return { ok: false, reason: 'already in this state' }
  if (!legalTargets(state).includes(to)) {
    return { ok: false, reason: `${state} -> ${to} is not a legal transition` }
  }
  if (to === 'attested' && verdict !== 'attestable') {
    return { ok: false, reason: `verdict is '${verdict ?? 'not evaluated'}', not 'attestable'` }
  }
  if (to === 'withdrawn' && (note === undefined || note.trim() === '')) {
    return { ok: false, reason: 'withdrawn requires a non-empty note' }
  }
  return { ok: true, reason: 'ok' }
}

/** Every required dimension with no resolvable citation, in declaration order. */
export function gapsOf(verdict: ClaimVerdict): readonly Gap[] {
  return verdict.gaps
}

/**
 * One segment of the span-lineage strip: a document, the fraction of it that is cited, and
 * which required dimensions fall inside that fraction. The board draws these as ticks on a
 * band; the web draws the same data as positioned marks. One derivation, two renderers.
 */
export interface LineageSegment {
  readonly docId: string
  readonly blob: string
  readonly docBytes: number
  readonly from: number
  readonly to: number
  readonly dimensions: readonly string[]
  readonly valid: boolean
}

export function lineage(
  verdict: ClaimVerdict,
  docBytes: Readonly<Record<string, number>>,
): readonly LineageSegment[] {
  const byDoc = new Map<string, { from: number; to: number; dims: Set<string>; valid: boolean }>()

  for (const span of verdict.spans) {
    const size = docBytes[span.docId] ?? 0
    const entry = byDoc.get(span.docId) ?? {
      from: size,
      to: 0,
      dims: new Set<string>(),
      valid: true,
    }
    entry.from = Math.min(entry.from, Math.max(span.byteStart, 0))
    entry.to = Math.max(entry.to, Math.min(span.byteEnd, size))
    entry.dims.add(span.dimension)
    if (!span.valid) entry.valid = false
    byDoc.set(span.docId, entry)
  }

  return [...byDoc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([docId, entry]) => ({
      docId,
      blob: verdict.spans.find((s) => s.docId === docId)?.blob ?? '',
      docBytes: docBytes[docId] ?? 0,
      from: entry.from,
      to: entry.to,
      dimensions: [...entry.dims].sort(),
      valid: entry.valid,
    }))
    .filter((segment) => segment.docBytes > 0)
}

/** A claim plus its verdict is what every surface actually renders. */
export interface EvaluatedClaim {
  readonly claim: Claim
  readonly verdict: ClaimVerdict
}

export function groupByState(
  claims: readonly EvaluatedClaim[],
): Readonly<Record<ClaimState, readonly EvaluatedClaim[]>> {
  const groups = {} as Record<ClaimState, EvaluatedClaim[]>
  for (const state of CLAIM_STATES) groups[state] = []
  for (const entry of claims) groups[entry.claim.state].push(entry)
  for (const state of CLAIM_STATES) {
    groups[state] = groups[state].sort((a, b) => a.claim.id.localeCompare(b.claim.id))
  }
  return groups
}
