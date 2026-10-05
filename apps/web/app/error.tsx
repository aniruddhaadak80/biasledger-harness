'use client'

import { useEffect } from 'react'

/**
 * The thrown-error state, distinct from both the empty state and the unreadable-corpus state.
 *
 * This one is a React render failure rather than a data problem, so it says so and offers the
 * only action that can help: try the render again. It also prints the digest, because the next
 * step for whoever gets this page is to grep a server log for it.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // stderr is where a platform collects it; the console is only a dev convenience.
    console.error(error)
  }, [error])

  return (
    <section className="product-error" role="alert">
      <p className="eyebrow">render failed</p>
      <h1>This page threw while rendering</h1>
      <p className="error-problem">{error.message}</p>
      {error.digest !== undefined && (
        <p className="error-root mono">
          digest <code>{error.digest}</code> — quote this when reporting it
        </p>
      )}
      <div className="error-fix">
        <h2>What this means</h2>
        <p className="attestation-note">
          This is not the audit corpus failing. That case has its own state, with the file name and the
          command to fix it. This is the page failing to render, which usually means a data shape the page did
          not expect.
        </p>
        <p>
          <button type="button" className="badge" data-tone="ok" onClick={reset}>
            Try rendering again
          </button>
        </p>
      </div>
      <p className="error-foot">
        If it persists, <code>biasledger doctor</code> will tell you whether the CLI can read the same corpus
        this page could not.
      </p>
    </section>
  )
}
