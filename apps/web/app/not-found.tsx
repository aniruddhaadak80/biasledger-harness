import Link from 'next/link'
import { readCorpus } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * A 404 on a claim id is a *finding*, not a typo: it means something referenced a claim that is
 * not on the board. So this page lists the ids that do exist, rather than apologising.
 */
export default function NotFound() {
  const corpus = readCorpus()
  const ids = corpus.ok ? corpus.claims.map((claim) => claim.id) : []

  return (
    <section className="product-error">
      <p className="eyebrow">404 — no such claim</p>
      <h1>No claim with that id is on the board</h1>
      <p className="attestation-note">
        Either the claim was never raised, or it was withdrawn and removed. Both are worth knowing, so this
        page lists what does exist rather than offering a generic apology.
      </p>

      {ids.length > 0 ? (
        <>
          <div className="error-fix">
            <h2>Claims on the board</h2>
            <ul className="gaps">
              {ids.map((id) => (
                <li key={id}>
                  <Link href={`/claims/${id}`} className="gap-dim mono">
                    {id}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <p className="error-foot">
            To raise a new one, follow <Link href="/">the board</Link> or read{' '}
            <code>skills/cite-evidence/SKILL.md</code>.
          </p>
        </>
      ) : (
        <p className="error-foot">
          The board is empty, so there is nothing to link to. Start at <Link href="/">the board</Link>.
        </p>
      )}
    </section>
  )
}
