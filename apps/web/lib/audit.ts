import { createHash } from 'node:crypto'
import { AUDIT_SNAPSHOT, AUDIT_VERDICTS } from './audit-data.mjs'

/**
 * The web app's data layer.
 *
 * It reads `audit-data.ts` — a build-time snapshot of the same git-backed corpus the CLI reads
 * — so the deployed board shows this repository's real claims, their real verdicts and their
 * real Merkle root. Nothing here is fixture data or a placeholder.
 *
 * **Why a snapshot rather than `readFileSync`.** A serverless function bundle is not the
 * repository. A route that reads `audit/index.json` at request time works on a laptop and
 * renders an error state in production, which is the worst possible failure for this product:
 * a board that silently looks empty. The snapshot removes the filesystem from the request path
 * entirely, and `tests/board.test.mjs` fails if it drifts from `audit/`.
 *
 * See ADR 0003 (the web app has no workspace dependencies) and ADR 0005 (git is the record).
 */

export type ClaimState = 'unverified' | 'evidenced' | 'challenged' | 'attested' | 'withdrawn'
export type Verdict = 'attestable' | 'partial' | 'unsubstantiated'

export const CLAIM_STATES: readonly ClaimState[] = [
  'unverified',
  'evidenced',
  'challenged',
  'attested',
  'withdrawn',
]

export const VERDICT_LABEL: Readonly<Record<Verdict, string>> = {
  attestable: 'every required dimension backed',
  partial: 'some dimensions backed',
  unsubstantiated: 'no required dimension backed',
}

export interface Citation {
  readonly docId: string
  readonly byteStart: number
  readonly byteEnd: number
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

export interface StoredIndex {
  readonly version: number
  readonly root: string
  readonly docs: Readonly<Record<string, { readonly blob: string; readonly bytes: number }>>
  readonly claims: Readonly<Record<string, ClaimVerdict & { readonly state: ClaimState }>>
  readonly commit?: string
  readonly generatedFrom?: readonly string[]
}

/** The git blob id for exact bytes. Mirrors the engine and the CLI. */
export function gitBlob(text: string): string {
  const bytes = Buffer.from(text, 'utf8')
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'ascii'))
    .update(bytes)
    .digest('hex')
}

export interface Corpus {
  readonly ok: boolean
  /** Why the corpus is unavailable, when it is. Named, so the page can say what to fix. */
  readonly problem?: string
  readonly root?: string
  readonly index?: StoredIndex
  readonly claims: readonly Claim[]
  readonly docs: readonly { docId: string; blob: string; bytes: number }[]
}

/**
 * The snapshot IS the corpus.
 *
 * `ok` is false only when the snapshot is structurally unusable -- a build that shipped
 * without a committed corpus. That is a deployment fault and it is reported as one.
 */
export function readCorpus(): Corpus {
  const snap = AUDIT_SNAPSHOT as unknown as {
    root: string
    version: number
    merkleRoot: string
    commit: string | null
    docs: readonly { docId: string; blob: string; bytes: number }[]
    claims: readonly Claim[]
  }

  if (typeof snap.merkleRoot !== 'string' || snap.merkleRoot === '') {
    return {
      ok: false,
      problem:
        'the committed web snapshot has no Merkle root -- regenerate it with "npm run generate:web-data"',
      claims: [],
      docs: [],
    }
  }

  if (!Array.isArray(snap.claims)) {
    return { ok: false, problem: 'the committed web snapshot has no claims array', claims: [], docs: [] }
  }

  const index: StoredIndex = {
    version: snap.version,
    root: snap.merkleRoot,
    docs: Object.fromEntries(snap.docs.map((d) => [d.docId, { blob: d.blob, bytes: d.bytes }])),
    claims: AUDIT_VERDICTS as unknown as StoredIndex['claims'],
    ...(snap.commit === null ? {} : { commit: snap.commit }),
  }

  return { ok: true, root: snap.root, index, claims: snap.claims, docs: [...snap.docs] }
}

/** A claim paired with the verdict the committed index recorded for it. */
export interface BoardEntry {
  readonly claim: Claim
  readonly verdict: ClaimVerdict | undefined
}

export function boardEntries(corpus: Corpus): readonly BoardEntry[] {
  return corpus.claims.map((claim) => ({
    claim,
    verdict: corpus.index?.claims?.[claim.id] as ClaimVerdict | undefined,
  }))
}

export function groupByState(
  entries: readonly BoardEntry[],
): Readonly<Record<ClaimState, readonly BoardEntry[]>> {
  const groups = {} as Record<ClaimState, BoardEntry[]>
  for (const state of CLAIM_STATES) groups[state] = []
  for (const entry of entries) {
    const bucket = groups[entry.claim.state]
    if (bucket !== undefined) bucket.push(entry)
  }
  for (const state of CLAIM_STATES)
    groups[state] = groups[state].sort((a, b) => a.claim.id.localeCompare(b.claim.id))
  return groups
}

export interface BoardStats {
  readonly claims: number
  readonly attestable: number
  readonly partial: number
  readonly unsubstantiated: number
  readonly openGaps: number
  readonly invalidCitations: number
}

export function stats(entries: readonly BoardEntry[]): BoardStats {
  const withVerdict = entries.filter((e) => e.verdict !== undefined)
  return {
    claims: entries.length,
    attestable: withVerdict.filter((e) => e.verdict?.verdict === 'attestable').length,
    partial: withVerdict.filter((e) => e.verdict?.verdict === 'partial').length,
    unsubstantiated: withVerdict.filter((e) => e.verdict?.verdict === 'unsubstantiated').length,
    openGaps: withVerdict.reduce((n, e) => n + (e.verdict?.gaps.length ?? 0), 0),
    invalidCitations: withVerdict.reduce((n, e) => n + (e.verdict?.citationsInvalid ?? 0), 0),
  }
}

/** One band per cited document, in the document's real byte proportions. */
export interface LineageBand {
  readonly docId: string
  readonly blob: string
  readonly docBytes: number
  readonly from: number
  readonly to: number
  readonly dimensions: readonly string[]
  readonly valid: boolean
}

export function lineage(
  verdict: ClaimVerdict | undefined,
  docBytes: Readonly<Record<string, number>>,
): readonly LineageBand[] {
  if (verdict === undefined) return []
  const byDoc = new Map<string, { from: number; to: number; dims: Set<string>; valid: boolean }>()
  for (const span of verdict.spans) {
    const size = docBytes[span.docId] ?? 0
    const entry = byDoc.get(span.docId) ?? { from: size, to: 0, dims: new Set<string>(), valid: true }
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
    .filter((band) => band.docBytes > 0)
}

/** Which transitions the lifecycle allows from this state, for the detail page. */
export const LEGAL: Readonly<Record<ClaimState, readonly ClaimState[]>> = {
  unverified: ['evidenced', 'withdrawn'],
  evidenced: ['challenged', 'attested', 'withdrawn'],
  challenged: ['evidenced', 'attested', 'withdrawn'],
  attested: ['challenged', 'withdrawn'],
  withdrawn: ['unverified'],
}
