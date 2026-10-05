/**
 * The empty state: a valid corpus with no claims in it.
 *
 * This is a real, reachable, healthy condition — a repository that has set up its evidence
 * documents but not yet raised any fairness claim. It gets its own design, with the exact
 * commands to leave it, because "nothing to report" is a result worth rendering well.
 */
export function BoardEmpty({ root }: { root?: string }) {
  return (
    <section className="board-empty">
      <p className="eyebrow">no claims raised</p>
      <h1>The corpus is indexed and no claim references it yet</h1>
      <p className="lede">
        This is a healthy empty state, not a failure. The evidence documents are readable and indexed; nobody
        has written a fairness claim against them.
      </p>

      {root !== undefined && (
        <p className="mono empty-root">
          corpus at <code>{root}</code>
        </p>
      )}

      <div className="empty-next">
        <h2>To raise the first claim</h2>
        <ol>
          <li>
            List the dimension taxonomy for your domain, rather than inventing dimensions:{' '}
            <code>biasledger mcp call list_dimension_sets &apos;{}&apos;</code>
          </li>
          <li>
            Measure the exact byte range of the sentence you want to cite — never count by hand:{' '}
            <code>biasledger cite &lt;docId&gt; &quot;&lt;phrase&gt;&quot;</code>
          </li>
          <li>
            Write <code>audit/claims/&lt;id&gt;.json</code> with those citations, each carrying an{' '}
            <code>expects</code> field so drift is detectable later.
          </li>
          <li>
            Evaluate it and publish the index: <code>biasledger show &lt;id&gt;</code> then{' '}
            <code>biasledger index --write</code>
          </li>
        </ol>
      </div>

      <p className="empty-foot">
        The full walkthrough is in <a href="/surfaces">Surfaces</a>, or run <code>biasledger</code> for the
        same board in your terminal.
      </p>
    </section>
  )
}
