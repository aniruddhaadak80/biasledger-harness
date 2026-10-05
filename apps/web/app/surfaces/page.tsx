import Link from 'next/link'
import { PRODUCT, SURFACES } from '@/lib/product'
import { CLAIM_STATES, readCorpus } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const LIFECYCLE: Readonly<Record<string, string>> = {
  unverified: 'Registered, nothing checked. Reachable only from nothing and withdrawn.',
  evidenced: 'Citations exist and resolve. The only state from which attestation can begin.',
  challenged: 'A reviewer disputed it. Fully reversible.',
  attested:
    'Every required dimension is backed by a citation that resolves. Gated on the verdict, not on a human decision.',
  withdrawn: 'Retracted, with a recorded reason. A withdrawal without a reason is refused.',
}

export default function SurfacesPage() {
  const shipped = SURFACES.filter((s) => s.status === 'shipped')
  const omitted = SURFACES.filter((s) => s.status === 'omitted')
  const corpus = readCorpus()

  return (
    <>
      <header className="claim-head">
        <div>
          <p className="eyebrow">what ships</p>
          <h1>{PRODUCT.name}</h1>
          <p className="lede">{PRODUCT.tagline}</p>
        </div>
      </header>

      <section aria-labelledby="omitted-heading">
        <h2 id="omitted-heading">Deliberately not built</h2>
        <p className="attestation-note">
          Two surfaces are omitted on purpose, and each omission is a position rather than a gap in time. Both
          are listed below with the reason, because an omission without a stated reason is just an oversight.
        </p>
        <table className="table">
          <caption className="visually-hidden">Surfaces deliberately omitted, and why</caption>
          <thead>
            <tr>
              <th scope="col">surface</th>
              <th scope="col">reason</th>
            </tr>
          </thead>
          <tbody>
            {omitted.map((surface) => (
              <tr key={surface.id}>
                <th scope="row">{surface.title}</th>
                <td>
                  {surface.summary}
                  {surface.reason !== undefined && (
                    <span className="gap-why" style={{ display: 'block' }}>
                      reason: {surface.reason}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="shipped-heading">
        <h2 id="shipped-heading">Shipped surfaces</h2>
        {shipped.length === 0 ? (
          <p className="state" data-kind="empty">
            No surfaces are declared in the manifest.
          </p>
        ) : (
          <table className="table">
            <caption className="visually-hidden">Every shipped surface with its entry point</caption>
            <thead>
              <tr>
                <th scope="col">surface</th>
                <th scope="col">entry point</th>
                <th scope="col">what it does</th>
              </tr>
            </thead>
            <tbody>
              {shipped.map((surface) => (
                <tr key={surface.id}>
                  <th scope="row">{surface.title}</th>
                  <td className="mono">{surface.entrypoint ?? '—'}</td>
                  <td>{surface.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="lifecycle-heading">
        <h2 id="lifecycle-heading">The claim lifecycle</h2>
        <p className="attestation-note">
          These five states and the transitions between them are the engine's decision, not the UI's.{' '}
          <code>biasledger root</code>-style checks aside, the table below is returned verbatim by{' '}
          <code>biasledger mcp call claim_lifecycle &apos;{}&apos;</code> and by the MCP tool of the same name
          — the interface never hardcodes it.
        </p>
        <table className="table">
          <caption className="visually-hidden">The five claim states and what each asserts</caption>
          <thead>
            <tr>
              <th scope="col">state</th>
              <th scope="col">what it asserts</th>
            </tr>
          </thead>
          <tbody>
            {CLAIM_STATES.map((state) => (
              <tr key={state}>
                <th scope="row" className="mono">
                  {state}
                </th>
                <td>{LIFECYCLE[state]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="corpus-heading">
        <h2 id="corpus-heading">The corpus this deployment serves</h2>
        {!corpus.ok ? (
          <p className="state" data-kind="error">
            The audit corpus could not be read: {corpus.problem}
          </p>
        ) : (
          <p className="attestation-note">
            <span className="mono">{corpus.root}</span> — {corpus.docs.length} evidence document(s),{' '}
            {corpus.claims.length} claim record(s), root <span className="mono">{corpus.index?.root}</span>
          </p>
        )}
      </section>

      <p className="back-link">
        <Link href="/">Back to the board</Link>
      </p>
    </>
  )
}
