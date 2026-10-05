import Link from 'next/link'
import { boardEntries, readCorpus, stats } from '@/lib/audit'
import { shortBlob } from '@/lib/present'
import { ProductError } from '@/components/ProductError'
import { BoardEmpty } from '@/components/BoardEmpty'

export const dynamic = 'force-dynamic'

/**
 * The evidence corpus: every artifact, its git blob id, and which claims rest on it.
 *
 * The blob id is the important column. It is the hash of the exact bytes, so it is what a
 * citation is anchored to, and it stays meaningful after the branch moves.
 */
export default function EvidencePage() {
  const corpus = readCorpus()

  if (!corpus.ok) {
    return (
      <ProductError
        heading="The evidence corpus could not be read"
        problem={corpus.problem ?? 'unknown problem'}
        root={corpus.root}
      />
    )
  }

  if (corpus.docs.length === 0) {
    return <BoardEmpty root={corpus.root} />
  }

  const entries = boardEntries(corpus)
  const numbers = stats(entries)
  const resting = (docId: string) =>
    entries.filter((e) => e.verdict?.attestedOver.includes(docId) === true).length

  return (
    <>
      <header className="claim-head">
        <div>
          <p className="eyebrow">evidence corpus</p>
          <h1>{corpus.docs.length} documents</h1>
          <p className="lede">
            Every claim cites byte ranges inside these files. The blob id is the hash of the exact bytes on
            disk, so it is what keeps a citation pointing at the same words after the branch moves — and it is
            what the Merkle root is computed over.
          </p>
        </div>
      </header>

      <dl className="ledger-figures">
        <div>
          <dt>documents</dt>
          <dd>{corpus.docs.length}</dd>
        </div>
        <div>
          <dt>total bytes</dt>
          <dd>{corpus.docs.reduce((n, d) => n + d.bytes, 0).toLocaleString('en-US')}</dd>
        </div>
        <div>
          <dt>claims</dt>
          <dd>{numbers.claims}</dd>
        </div>
        <div>
          <dt>broken citations</dt>
          <dd className={numbers.invalidCitations > 0 ? 'figure-bad' : undefined}>
            {numbers.invalidCitations}
          </dd>
        </div>
      </dl>

      <table className="table">
        <caption className="visually-hidden">
          Every evidence document with its blob id, size and how many claims rest on it
        </caption>
        <thead>
          <tr>
            <th scope="col">doc id</th>
            <th scope="col">blob</th>
            <th scope="col">bytes</th>
            <th scope="col">claims resting on it</th>
          </tr>
        </thead>
        <tbody>
          {corpus.docs.map((doc) => (
            <tr key={doc.docId}>
              <th scope="row" className="mono">
                {doc.docId}
              </th>
              <td className="mono" title={doc.blob}>
                {shortBlob(doc.blob)}
              </td>
              <td className="mono">{doc.bytes.toLocaleString('en-US')}</td>
              <td className="mono">{resting(doc.docId)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section aria-labelledby="claims-h">
        <h2 id="claims-h">Claims and what they rest on</h2>
        <table className="table">
          <caption className="visually-hidden">Each claim with the blobs its verdict covers</caption>
          <thead>
            <tr>
              <th scope="col">claim</th>
              <th scope="col">state</th>
              <th scope="col">verdict</th>
              <th scope="col">attested over</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.claim.id}>
                <th scope="row" className="mono">
                  <Link href={`/claims/${entry.claim.id}`}>{entry.claim.id}</Link>
                </th>
                <td>{entry.claim.state}</td>
                <td>{entry.verdict?.verdict ?? 'not evaluated'}</td>
                <td className="mono">
                  {(entry.verdict?.attestedOver ?? []).map(shortBlob).join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="back-link">
        <Link href="/">Back to the board</Link>
      </p>
    </>
  )
}
