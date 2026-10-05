import { NextResponse } from 'next/server'
import { CLAIM_STATES, boardEntries, groupByState, readCorpus, stats } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The board as JSON, from the same committed corpus the HTML page renders.
 *
 * This exists so the web app is not a private rendering: the same data is available to a
 * script, a CI job, or an MCP client without scraping the page.
 */
export function GET() {
  const corpus = readCorpus()

  if (!corpus.ok) {
    return NextResponse.json(
      { ok: false, problem: corpus.problem ?? 'unreadable', evidenceRoot: corpus.root ?? null },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }

  const entries = boardEntries(corpus)
  const groups = groupByState(entries)

  return NextResponse.json(
    {
      ok: true,
      root: corpus.index?.root ?? null,
      commit: corpus.index?.commit ?? null,
      stats: stats(entries),
      documents: corpus.docs,
      states: CLAIM_STATES.map((state) => ({
        state,
        claims: groups[state].map((entry) => ({
          id: entry.claim.id,
          title: entry.claim.title,
          system: entry.claim.system,
          verdict: entry.verdict?.verdict ?? null,
          coverage: entry.verdict?.coverage ?? null,
          gaps: (entry.verdict?.gaps ?? []).map((gap) => gap.dimension),
          citationsValid: entry.verdict?.citationsValid ?? 0,
          citationsInvalid: entry.verdict?.citationsInvalid ?? 0,
          attestedOver: entry.verdict?.attestedOver ?? [],
          root: entry.verdict?.root ?? null,
        })),
      })),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
