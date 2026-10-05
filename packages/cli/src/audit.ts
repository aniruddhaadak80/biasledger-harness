import {
  ValidationError,
  canTransition,
  type Claim,
  type ClaimState,
  type ClaimVerdict,
  type EvaluatedClaim,
} from '@biasledgerharness/core'
import { EngineBridge } from '@biasledgerharness/engine-client'
import { join } from 'node:path'
import { readEvidence, readClaims, headCommit, type EvidenceDoc } from './repository.js'

/**
 * The audit pipeline: the one place the deterministic engine is invoked.
 *
 * Every capability that needs the engine goes through here, so the CLI, the MCP tools and the
 * web API share one call path. The engine is a pure function over stdin/stdout, so each call
 * is a fresh subprocess and two calls can never interleave state.
 */

export const ENGINE_MODULE = 'biasledger_harness'

export function engineCwd(cwd: string): string {
  return join(cwd, 'services', 'engine', 'src')
}

export function bridge(cwd = process.cwd(), timeoutMs = 30_000): EngineBridge {
  return new EngineBridge({ module: ENGINE_MODULE, cwd: engineCwd(cwd), timeoutMs })
}

/** One engine call, with the shape of the payload asserted rather than trusted. */
export async function callEngine<T>(op: string, input: unknown, cwd = process.cwd()): Promise<T> {
  return await bridge(cwd).call<T>({ op, input })
}

export interface IndexResult {
  readonly root: string
  readonly terms: number
  readonly postings: number
  readonly reused: number
  readonly rebuilt: number
  readonly dropped: readonly string[]
  readonly manifest: unknown
}

export async function buildIndex(
  docs: readonly EvidenceDoc[],
  previousManifest?: unknown,
  cwd = process.cwd(),
): Promise<IndexResult> {
  const payload = {
    docs: docs.map((doc) => ({ docId: doc.docId, blob: doc.blob, text: doc.text })),
    ...(previousManifest === undefined ? {} : { manifest: previousManifest }),
  }
  const result = await callEngine<{
    root: string
    index: { terms: Record<string, unknown[]> }
    manifest: unknown
    reused: number
    rebuilt: number
    dropped: string[]
  }>('build_index', payload, cwd)

  return {
    root: result.root,
    terms: Object.keys(result.index.terms).length,
    postings: Object.values(result.index.terms).reduce((n, rows) => n + rows.length, 0),
    reused: result.reused,
    rebuilt: result.rebuilt,
    dropped: result.dropped,
    manifest: result.manifest,
  }
}

/** The Merkle root of an already-built index, without rebuilding it. */
export async function reduceRoot(index: unknown, cwd = process.cwd()): Promise<string> {
  return await callEngine<string>('reduce_root', index, cwd)
}

export interface SpanProbe {
  readonly docId: string
  readonly blob: string
  readonly byteStart: number
  readonly byteEnd: number
  readonly line: number
  readonly valid: boolean
  readonly reason: string
  readonly text: string
  readonly spanSha256: string
}

/** Find the byte range of a literal phrase. This is how a citation is authored, not guessed. */
export async function locate(doc: EvidenceDoc, phrase: string, cwd = process.cwd()): Promise<SpanProbe> {
  const bytes = Buffer.from(phrase, 'utf8')
  const at = Buffer.from(doc.text, 'utf8').indexOf(bytes)
  if (at < 0) {
    throw new ValidationError(`"${phrase}" does not appear in ${doc.docId}`, {
      docId: doc.docId,
      phrase,
    })
  }
  const result = await callEngine<SpanProbe>(
    'verify_span',
    { doc: { docId: doc.docId, blob: doc.blob, text: doc.text }, byteStart: at, byteEnd: at + bytes.length },
    cwd,
  )
  return { ...result, byteStart: at, byteEnd: at + bytes.length }
}

export async function evaluateClaim(
  claim: Claim,
  docs: readonly EvidenceDoc[],
  cwd = process.cwd(),
): Promise<ClaimVerdict> {
  return await callEngine<ClaimVerdict>(
    'evaluate_claim',
    {
      claim,
      docs: docs.map((doc) => ({ docId: doc.docId, blob: doc.blob, text: doc.text })),
    },
    cwd,
  )
}

export interface TransitionDecision {
  readonly ok: boolean
  readonly fromState: string
  readonly toState: string
  readonly legal: readonly string[]
  readonly gated: readonly string[]
  readonly reason: string
}

/**
 * Ask the engine whether a transition is legal, then — only if it is — apply it.
 *
 * The mirror in packages/core exists to grey out a button in the board. This is the
 * authority, and a refused transition leaves the claim exactly as it was.
 */
export async function moveClaim(
  claim: Claim,
  to: ClaimState,
  options: { readonly note?: string; readonly cwd?: string } = {},
): Promise<{ readonly applied: boolean; readonly claim: Claim; readonly decision: TransitionDecision }> {
  const cwd = options.cwd ?? process.cwd()
  const docs = readEvidence(cwd)
  const verdict = await evaluateClaim(claim, docs, cwd)

  const decision = await callEngine<TransitionDecision>(
    'transition',
    { claim, to, ...(options.note === undefined ? {} : { note: options.note }), verdict },
    cwd,
  )

  if (!decision.ok) {
    return { applied: false, claim, decision }
  }
  const moved: Claim = { ...claim, state: to, note: options.note ?? claim.note }
  return { applied: true, claim: moved, decision }
}

export async function loadAudit(cwd = process.cwd()): Promise<{
  readonly docs: readonly EvidenceDoc[]
  readonly evaluated: readonly EvaluatedClaim[]
  readonly commit: string | undefined
}> {
  const docs = readEvidence(cwd)
  const claims = readClaims(cwd)
  const evaluated: EvaluatedClaim[] = []
  for (const claim of claims) {
    evaluated.push({ claim, verdict: await evaluateClaim(claim, docs, cwd) })
  }
  return { docs, evaluated, commit: headCommit(cwd) }
}

export interface BoardStats {
  readonly claims: number
  readonly attestable: number
  readonly blocked: number
  readonly openGaps: number
  readonly invalidCitations: number
  readonly root: string | undefined
}

/**
 * The numbers a reviewer actually wants, all derived from verdicts rather than from claim
 * states — a claim marked `attested` whose citations have since rotted is not counted here.
 */
export function summarise(evaluated: readonly EvaluatedClaim[], root?: string): BoardStats {
  return {
    claims: evaluated.length,
    attestable: evaluated.filter((e) => e.verdict.verdict === 'attestable').length,
    blocked: evaluated.filter((e) => e.verdict.verdict === 'unsubstantiated').length,
    openGaps: evaluated.reduce((n, e) => n + e.verdict.gaps.length, 0),
    invalidCitations: evaluated.reduce((n, e) => n + e.verdict.citationsInvalid, 0),
    root,
  }
}

/** Which moves each claim could legally make right now, for the board's hints. */
export function movesFor(entry: EvaluatedClaim): readonly ClaimState[] {
  const targets: ClaimState[] = ['unverified', 'evidenced', 'challenged', 'attested', 'withdrawn']
  return targets.filter(
    (to) => canTransition(entry.claim.state, to, entry.verdict.verdict, entry.claim.note || 'n/a').ok,
  )
}
