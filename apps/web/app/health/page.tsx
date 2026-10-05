import type { Metadata } from 'next'
import { runHealthChecks } from '@/lib/health'

export const metadata: Metadata = { title: 'Health' }
export const dynamic = 'force-dynamic'

const TONE = { ok: 'ok', warn: 'warn', fail: 'bad' } as const

/**
 * Live probe results, rendered from the same function the API route calls.
 *
 * No self-fetch: the page cannot claim to be healthy while its own endpoint is unreachable,
 * because it never goes through HTTP to find out.
 */
export default function HealthPage() {
  const report = runHealthChecks()

  return (
    <>
      <header className="claim-head">
        <div>
          <p className="eyebrow">diagnostics</p>
          <h1>Health</h1>
          <p className="lede">
            The same probe that serves <code>/api/health</code>, evaluated in this process. Every row below
            was observed rather than inferred from configuration.
          </p>
        </div>
        <span className="badge" data-tone={report.ok ? 'ok' : 'bad'}>
          {report.ok ? 'ok' : 'failing'}
        </span>
      </header>

      <dl className="ledger-figures">
        <div>
          <dt>documents</dt>
          <dd>{report.documents}</dd>
        </div>
        <div>
          <dt>claims</dt>
          <dd>{report.claims}</dd>
        </div>
        <div>
          <dt>attestable</dt>
          <dd>{report.attestable}</dd>
        </div>
        <div>
          <dt>broken citations</dt>
          <dd className={report.brokenCitations > 0 ? 'figure-bad' : undefined}>{report.brokenCitations}</dd>
        </div>
      </dl>

      <section aria-labelledby="checks-heading">
        <h2 id="checks-heading">Checks</h2>
        {report.checks.length === 0 ? (
          <p className="state" data-kind="empty">
            No checks ran, which is itself a failure. Report it.
          </p>
        ) : (
          <table className="table">
            <caption className="visually-hidden">Every health check with its status and fix hint</caption>
            <thead>
              <tr>
                <th scope="col">check</th>
                <th scope="col">status</th>
                <th scope="col">detail</th>
              </tr>
            </thead>
            <tbody>
              {report.checks.map((check) => (
                <tr key={check.name} data-tone={check.status === 'fail' ? 'bad' : undefined}>
                  <th scope="row" className="mono">
                    {check.name}
                  </th>
                  <td>
                    <span className="badge" data-tone={TONE[check.status]}>
                      {check.status}
                    </span>
                  </td>
                  <td>
                    {check.detail}
                    {check.fix !== undefined && (
                      <span className="gap-why" style={{ display: 'block' }}>
                        fix: {check.fix}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="att-head">
        <h2 id="att-head">Attestation served by this deployment</h2>
        <p className="mono attestation-body">
          <span className="attestation-label">merkle root</span>
          <span className="attestation-root">{report.merkleRoot ?? '—'}</span>
        </p>
        <p className="attestation-note">
          Read from <code>audit/index.json</code> at{' '}
          <span className="mono">{report.evidenceRoot ?? 'not found'}</span> at commit{' '}
          <span className="mono">{report.commit.slice(0, 7)}</span>. This page cannot be healthy without it:
          an audit product with no committed attestation has nothing to attest.
        </p>
      </section>
    </>
  )
}
