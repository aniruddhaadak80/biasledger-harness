import Link from 'next/link'
import {
  CLAIM_STATES,
  VERDICT_LABEL,
  boardEntries,
  groupByState,
  lineage,
  readCorpus,
  stats,
} from '@/lib/audit'
import {
  backedDimensions,
  docBytes,
  requiredCount,
  shortBlob,
  stateTone,
  verdictLabel,
  verdictTone,
} from '@/lib/present'
import { Coverage, Strip } from '@/components/Strip'
import { ProductError } from '@/components/ProductError'
import { BoardEmpty } from '@/components/BoardEmpty'

export const dynamic = 'force-dynamic'

/**
 * The claim board.
 *
 * Server-rendered on every request from the committed audit corpus, so the first paint already
 * contains this repository's real claims, verdicts and Merkle root. There is no client fetch,
 * no loading shell over an empty page, and no fixture data: if the corpus is unreadable the
 * page says which file is wrong and what to run, because a board that silently rendered an
 * empty project would be indistinguishable from a project with no findings.
 */
export default function BoardPage() {
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

  const entries = boardEntries(corpus)
  const groups = groupByState(entries)
  const numbers = stats(entries)
  const bytes = docBytes(corpus)
  const index = corpus.index

  if (entries.length === 0) {
    return <BoardEmpty root={corpus.root} />
  }

  return (
    <>
      <section className="ledger-head">
        <div className="ledger-title">
          <p className="eyebrow">claim board</p>
          <h1>What the evidence still backs</h1>
          <p className="lede">
            Every claim below cites byte ranges inside named git blobs. A verdict is a statement about those
            bytes and nothing else — this board does not judge whether the evidence is persuasive, only
            whether it says what the claim says it says.
          </p>
        </div>

        <dl className="ledger-figures">
          <div>
            <dt>claims</dt>
            <dd>{numbers.claims}</dd>
          </div>
          <div>
            <dt>attestable</dt>
            <dd>{numbers.attestable}</dd>
          </div>
          <div>
            <dt>partial</dt>
            <dd>{numbers.partial}</dd>
          </div>
          <div>
            <dt>open gaps</dt>
            <dd>{numbers.openGaps}</dd>
          </div>
          <div>
            <dt>broken citations</dt>
            <dd className={numbers.invalidCitations > 0 ? 'figure-bad' : undefined}>
              {numbers.invalidCitations}
            </dd>
          </div>
        </dl>
      </section>

      <section className="attestation" aria-labelledby="attestation-heading">
        <h2 id="attestation-heading">The attestation</h2>
        <p className="mono attestation-body">
          <span className="attestation-label">evidence root</span>
          <span className="attestation-root">{index?.root}</span>
        </p>
        <p className="attestation-note">
          A Merkle root over every term in every cited document. Recomputing it from the committed manifest
          alone — with no access to the documents — reproduces the same value; that is what{' '}
          <code>biasledger root</code> checks, and it is what a third party can check without trusting this
          page.
        </p>
        <ul className="attestation-meta">
          <li>
            <span>documents</span>
            <strong>{corpus.docs.length}</strong>
          </li>
          <li>
            <span>index version</span>
            <strong>{index?.version ?? '—'}</strong>
          </li>
          <li>
            <span>commit</span>
            <strong className="mono">{index?.commit?.slice(0, 7) ?? 'uncommitted'}</strong>
          </li>
          <li>
            <span>corpus</span>
            <strong className="mono">{corpus.root}</strong>
          </li>
        </ul>
      </section>

      <nav className="board-nav" aria-label="Board sections">
        <Link href="/evidence">Evidence corpus</Link>
        <Link href="/surfaces">Surfaces</Link>
        <Link href="/health">Health</Link>
      </nav>

      <section className="board" aria-label="Claims by lifecycle state">
        {CLAIM_STATES.map((state) => {
          const bucket = groups[state]
          return (
            <section className="column" key={state} aria-labelledby={`col-${state}`}>
              <header className="column-head">
                <h2 id={`col-${state}`}>{state}</h2>
                <span className="count">{bucket.length}</span>
              </header>

              {bucket.length === 0 ? (
                <p className="column-empty">
                  Nothing here. A claim reaches <code>{state}</code> only through a checked transition, so an
                  empty column is a fact about the workflow.
                </p>
              ) : (
                <ul className="cards">
                  {bucket.map((entry) => {
                    const bands = lineage(entry.verdict, bytes)
                    const dimensions = backedDimensions(entry)
                    const required = requiredCount(entry)
                    const invalid = entry.verdict?.citationsInvalid ?? 0
                    return (
                      <li key={entry.claim.id}>
                        <article className="claim">
                          <div className="claim-top">
                            <span className="badge" data-tone={stateTone(entry.claim.state)}>
                              {entry.claim.state}
                            </span>
                            <span className="badge" data-tone={verdictTone(entry.verdict?.verdict)}>
                              {verdictLabel(entry.verdict?.verdict)}
                            </span>
                          </div>

                          <h3>
                            <Link href={`/claims/${entry.claim.id}`}>{entry.claim.id}</Link>
                          </h3>
                          <p className="claim-title">{entry.claim.title}</p>

                          <p className="claim-meta">
                            <span className="mono">{entry.claim.system}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {entry.verdict?.dimensionsCovered ?? 0}/{required} required dimensions
                            </span>
                            {invalid > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-bad">{invalid} broken</span>
                              </>
                            )}
                          </p>

                          <div className="claim-coverage">
                            <Coverage dimensions={dimensions} total={required} />
                            <span className="cov-legend mono">
                              {dimensions.filter((d) => d.backed).length} of {required} required dimensions
                              backed
                            </span>
                          </div>

                          <Strip bands={bands} width={320} height={18} />

                          {entry.verdict !== undefined &&
                            entry.verdict.verdict !== 'attestable' &&
                            VERDICT_LABEL[entry.verdict.verdict] !== undefined && (
                              <p className="claim-verdict">{VERDICT_LABEL[entry.verdict.verdict]}</p>
                            )}

                          {entry.verdict !== undefined && entry.verdict.gaps.length > 0 && (
                            <ul className="gaps">
                              {entry.verdict.gaps.map((gap) => (
                                <li key={gap.dimension}>
                                  <span className="gap-dim">{gap.dimension}</span>
                                  <span className="gap-why">{gap.reason}</span>
                                </li>
                              ))}
                            </ul>
                          )}

                          {bands.length > 0 && (
                            <p className="claim-blob mono">
                              attested over {bands.map((band) => shortBlob(band.blob)).join(', ')}
                            </p>
                          )}
                        </article>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}
      </section>
    </>
  )
}
