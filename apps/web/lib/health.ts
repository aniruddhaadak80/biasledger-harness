import { boardEntries, readCorpus, stats } from '@/lib/audit'
import { PRODUCT, resolveVersion } from '@/lib/product'

/**
 * The health probe, in one place, used by both `/api/health` and the `/health` page.
 *
 * The page used to fetch the route over HTTP, which meant a deployment could render a healthy
 * looking page while its own endpoint was unreachable. Importing the probe directly removes
 * that failure mode entirely: there is one implementation and one answer.
 *
 * Everything reported here is *observed*. The corpus checks read `audit/index.json` from the
 * repository rather than from configuration, so "stale" and "missing" are distinguishable.
 */

export type Status = 'ok' | 'warn' | 'fail'

export interface Check {
  readonly name: string
  readonly status: Status
  readonly detail: string
  readonly fix?: string
}

export interface HealthReport {
  readonly ok: boolean
  readonly name: string
  readonly version: string
  readonly runtime: string
  readonly region: string
  readonly commit: string
  readonly uptimeSeconds: number
  readonly evidenceRoot: string | null
  readonly merkleRoot: string | null
  readonly documents: number
  readonly claims: number
  readonly attestable: number
  readonly brokenCitations: number
  readonly checks: readonly Check[]
}

const startedAt = Date.now()

export function runHealthChecks(): HealthReport {
  const checks: Check[] = []

  const nodeMajor = Number(process.versions.node.split('.')[0] ?? '0')
  checks.push(
    nodeMajor >= 22
      ? { name: 'runtime', status: 'ok', detail: `node ${process.versions.node}` }
      : {
          name: 'runtime',
          status: 'fail',
          detail: `node ${process.versions.node} is below the required v22.12.0`,
          fix: 'target Node 22 in the deployment runtime',
        },
  )

  checks.push({ name: 'package', status: 'ok', detail: `${PRODUCT.slug}@${resolveVersion()}` })

  const region = process.env.VERCEL_REGION ?? 'local'
  checks.push({ name: 'region', status: 'ok', detail: region })

  const corpus = readCorpus()
  let merkleRoot: string | null = null
  let documents = 0
  let claims = 0
  let attestable = 0
  let brokenCitations = 0

  if (!corpus.ok) {
    checks.push({
      name: 'corpus',
      status: 'fail',
      detail: corpus.problem ?? 'the audit corpus could not be read',
      fix: 'deploy the repository with audit/ intact, then run: biasledger index --write',
    })
  } else {
    documents = corpus.docs.length
    claims = corpus.claims.length
    const entries = boardEntries(corpus)
    const numbers = stats(entries)
    attestable = numbers.attestable
    brokenCitations = numbers.invalidCitations
    merkleRoot = corpus.index?.root ?? null

    checks.push({
      name: 'corpus',
      status: 'ok',
      detail: `${documents} document(s), ${claims} claim record(s) at ${corpus.root}`,
    })

    checks.push(
      merkleRoot === null
        ? {
            name: 'attestation',
            status: 'fail',
            detail: 'audit/index.json carries no Merkle root',
            fix: 'run: biasledger index --write',
          }
        : {
            name: 'attestation',
            status: 'ok',
            detail: `root ${merkleRoot.slice(0, 16)}… committed at ${corpus.index?.commit?.slice(0, 7) ?? 'unknown commit'}`,
          },
    )

    checks.push(
      brokenCitations === 0
        ? { name: 'citations', status: 'ok', detail: 'every citation resolves' }
        : {
            name: 'citations',
            status: 'warn',
            detail: `${brokenCitations} citation(s) no longer say what they said`,
            fix: 'run: biasledger show <claimId> — a text-mismatch means the document was edited',
          },
    )

    checks.push(
      numbers.unsubstantiated === 0
        ? { name: 'claims', status: 'ok', detail: `${claims} claim(s), all with a backed dimension` }
        : {
            name: 'claims',
            status: 'warn',
            detail: `${numbers.unsubstantiated} claim(s) have no backed required dimension`,
            fix: 'expected on a young audit — these are the open gaps on the board',
          },
    )
  }

  const ok = checks.every((check) => check.status !== 'fail')

  return {
    ok,
    name: PRODUCT.slug,
    version: resolveVersion(),
    runtime: process.versions.node,
    region,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? corpus.index?.commit ?? 'local',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    evidenceRoot: corpus.root ?? null,
    merkleRoot,
    documents,
    claims,
    attestable,
    brokenCitations,
    checks,
  }
}
