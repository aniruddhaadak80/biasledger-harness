import { NextResponse } from 'next/server'
import { runHealthChecks } from '@/lib/health'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The machine-readable health endpoint.
 *
 * `ok` is false — and the status is 503 — when a *required* check fails. A broken citation is a
 * `warn`, not a failure: it is a finding about the evidence, and a deployment whose evidence
 * contains a rotted citation is working exactly as intended.
 */
export function GET() {
  const report = runHealthChecks()
  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  })
}
