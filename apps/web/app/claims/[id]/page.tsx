import { notFound } from 'next/navigation'
import Link from 'next/link'
import { LEGAL, boardEntries, lineage, readCorpus, VERDICT_LABEL } from '@/lib/audit'
import {
  backedDimensions,
  docBytes,
  requiredCount,
  shortBlob,
  verdictLabel,
  verdictTone,
} from '@/lib/present'
import { Coverage, Strip } from '@/components/Strip'
import { ProductError } from '@/components/ProductError'

export const dynamic = 'force-dynamic'

/**
 * One claim, every citation, and the exact reason each one stands or falls.
 *
 * The span table is the point of this page: it shows the resolved text, the line, the blob and
 * the failure reason for every citation, so a reviewer never has to take the verdict on trust.
 */
export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const corpus = readCorpus()

  if (!corpus.ok) {
    return (
      <ProductError
        heading="The audit corpus could not be read"
        problem={corpus.problem ?? 'unknown problem'}
        root={corpus.root}
      />
    )
  }

  const entry = boardEntries(corpus).find((e) => e.claim.id === id)
  if (entry === undefined) notFound()

  const bytes = docBytes(corpus)
  const bands = lineage(entry.verdict, bytes)
  const dimensions = backedDimensions(entry)
  const required = requiredCount(entry)
  const verdict = entry.verdict
  const legal = LEGAL[entry.claim.state]

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Board</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{entry.claim.id}</span>
      </nav>

      <header className="claim-head">
        <div>
          <p className="eyebrow">claim</p>
          <h1>{entry.claim.id}</h1>
          <p className="lede">{entry.claim.title}</p>
        </div>
        <div className="claim-head-badges">
          <span className="badge" data-tone="idle">
            {entry.claim.state}
          </span>
          <span className="badge" data-tone={verdictTone(verdict?.verdict)}>
            {verdictLabel(verdict?.verdict)}
          </span>
        </div>
      </header>

      <dl className="ledger-figures">
        <div>
          <dt>required dimensions</dt>
          <dd>
            {verdict?.dimensionsCovered ?? 0}/{required}
          </dd>
        </div>
        <div>
          <dt>citations</dt>
          <dd>
            {verdict?.citationsValid ?? 0} valid
            {(verdict?.citationsInvalid ?? 0) > 0 && (
              <span className="text-bad"> / {verdict?.citationsInvalid} broken</span>
            )}
          </dd>
        </div>
        <div>
          <dt>attested over</dt>
          <dd>{verdict?.attestedOver.length ?? 0} blobs</dd>
        </div>
        <div>
          <dt>legal moves</dt>
          <dd className="mono figure-small">{legal.join(' · ') || 'none'}</dd>
        </div>
      </dl>

      <section aria-labelledby="dims-heading">
        <h2 id="dims-heading">Dimensions</h2>
        <div className="claim-coverage">
          <Coverage dimensions={dimensions} total={required} />
        </div>
        <table className="table">
          <caption className="visually-hidden">Required and advisory dimensions for this claim</caption>
          <thead>
            <tr>
              <th scope="col">dimension</th>
              <th scope="col">required</th>
              <th scope="col">backed</th>
              <th scope="col">citations</th>
            </tr>
          </thead>
          <tbody>
            {entry.claim.dimensions.map((dimension) => {
              const state = dimensions.find((d) => d.key === dimension.key)
              return (
                <tr key={dimension.key}>
                  <th scope="row" className="mono">
                    {dimension.key}
                  </th>
                  <td>{dimension.required ? 'yes' : 'advisory'}</td>
                  <td data-tone={state?.backed === true ? 'ok' : 'bad'}>
                    {state?.backed === true ? 'yes' : 'no'}
                  </td>
                  <td className="mono">{dimension.citations.length}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="lineage-heading">
        <h2 id="lineage-heading">Span lineage</h2>
        <Strip bands={bands} width={640} height={22} />
      </section>

      <section aria-labelledby="spans-heading">
        <h2 id="spans-heading">Every citation</h2>
        {verdict === undefined || verdict.spans.length === 0 ? (
          <p className="state" data-kind="empty">
            This claim has no citations, so there is nothing to resolve. Every required dimension it declares
            is an open gap.
          </p>
        ) : (
          <table className="table">
            <caption className="visually-hidden">
              Each citation with its resolved byte range and outcome
            </caption>
            <thead>
              <tr>
                <th scope="col">dimension</th>
                <th scope="col">document</th>
                <th scope="col">bytes</th>
                <th scope="col">blob</th>
                <th scope="col">result</th>
              </tr>
            </thead>
            <tbody>
              {verdict.spans.map((span, position) => (
                <tr key={`${span.dimension}-${position}`} data-tone={span.valid ? 'ok' : 'bad'}>
                  <th scope="row" className="mono">
                    {span.dimension}
                  </th>
                  <td className="mono">
                    {span.docId}
                    <span className="muted"> :{span.line}</span>
                  </td>
                  <td className="mono">
                    {span.byteStart}–{span.byteEnd}
                  </td>
                  <td className="mono">{shortBlob(span.blob)}</td>
                  <td>
                    <span className="badge" data-tone={span.valid ? 'ok' : 'bad'}>
                      {span.reason}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {verdict !== undefined && verdict.spans.length > 0 && (
          <div className="quoted">
            {verdict.spans.map((span, position) => (
              <figure key={`${span.dimension}-q-${position}`} data-valid={String(span.valid)}>
                <blockquote>
                  <span className="mono quoted-bytes">
                    {span.docId} {span.byteStart}–{span.byteEnd}
                  </span>
                  {span.text}
                </blockquote>
                {!span.valid && (
                  <figcaption>
                    this citation is recorded as saying something else — the document was edited after it was
                    written
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        )}
      </section>

      {verdict !== undefined && verdict.gaps.length > 0 && (
        <section aria-labelledby="gaps-heading">
          <h2 id="gaps-heading">Open gaps</h2>
          <ul className="gaps gaps-wide">
            {verdict.gaps.map((gap) => (
              <li key={gap.dimension}>
                <span className="gap-dim">{gap.dimension}</span>
                <span className="gap-why">
                  {gap.reason === 'no-citation'
                    ? 'no citation was ever written for this dimension'
                    : 'every citation for this dimension failed to resolve'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="root-heading">
        <h2 id="root-heading">Attestation</h2>
        <p className="mono attestation-body">
          <span className="attestation-label">root over these blobs</span>
          <span className="attestation-root">{verdict?.root ?? '—'}</span>
        </p>
        <p className="attestation-note">
          This root covers exactly the {verdict?.attestedOver.length ?? 0} document
          {verdict?.attestedOver.length === 1 ? '' : 's'} the verdict rests on
          {verdict !== undefined && verdict.attestedOver.length > 0 && (
            <> — {verdict.attestedOver.join(', ')}</>
          )}
          . It is not a root over the whole corpus; an attestation should cover its own evidence and nothing
          more.
        </p>
        {verdict !== undefined && VERDICT_LABEL[verdict.verdict] !== undefined && (
          <p className="attestation-note">Verdict means: {VERDICT_LABEL[verdict.verdict]}.</p>
        )}
      </section>

      {entry.claim.note !== '' && (
        <section aria-labelledby="note-heading">
          <h2 id="note-heading">Note</h2>
          <p className="claim-note">{entry.claim.note}</p>
        </section>
      )}

      <p className="back-link">
        <Link href="/">Back to the board</Link>
      </p>
    </>
  )
}
