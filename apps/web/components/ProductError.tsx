/**
 * The error state, and it is deliberately not the empty state.
 *
 * A board with nothing on it is a result. A board that could not read its corpus is a broken
 * deployment. Showing the same box for both would let a failed deploy look like a clean audit,
 * which for this product is the single worst failure mode there is.
 */
export function ProductError({
  heading,
  problem,
  root,
}: {
  heading: string
  problem: string
  root?: string
}) {
  return (
    <section className="product-error" role="alert">
      <p className="eyebrow">cannot render the board</p>
      <h1>{heading}</h1>
      <p className="error-problem">{problem}</p>
      {root !== undefined && (
        <p className="error-root mono">
          looked for audit/index.json above <code>{root}</code>
        </p>
      )}
      <div className="error-fix">
        <h2>What to do</h2>
        <ol>
          <li>
            Confirm the repository was deployed with its <code>audit/</code> directory intact — it is the
            system of record, not build output.
          </li>
          <li>
            Rebuild the index from the CLI if the claim verdicts are stale:{' '}
            <code>biasledger index --write</code>
          </li>
          <li>
            Check the parse error with{' '}
            <code>
              node -e &quot;JSON.parse(require(&apos;fs&apos;).readFileSync(
              &apos;audit/index.json&apos;,&apos;utf8&apos;))&quot;
            </code>
          </li>
        </ol>
      </div>
      <p className="error-foot">
        The health endpoint reports the same problem in machine-readable form at{' '}
        <a href="/api/health">/api/health</a>.
      </p>
    </section>
  )
}
