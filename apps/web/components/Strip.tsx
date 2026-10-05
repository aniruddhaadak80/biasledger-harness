import type { LineageBand } from '@/lib/audit'

/**
 * The span-lineage strip — the one element a screenshot identifies.
 *
 * One band per cited document, drawn across that document's *real byte range*. A tick is a
 * citation that resolved and still says what it said; a red tick is one that no longer does;
 * the pale run either side is the part of the document the claim does not rest on.
 *
 * It is SVG rather than styled divs for one reason: a citation's position must be its actual
 * byte offset, and percentages of an SVG viewport are exact to the subpixel. A layout built
 * out of flex children would drift as soon as a label wrapped.
 *
 * Pure and presentational, so the same derivation is unit-tested in tests/board.test.mjs.
 */

export interface StripProps {
  readonly bands: readonly LineageBand[]
  readonly width?: number
  readonly height?: number
  readonly label?: boolean
}

const TICK_INSET = 0.6

export function Strip({ bands, width = 320, height = 26, label = true }: StripProps) {
  if (bands.length === 0) {
    return (
      <p className="strip-empty">
        This claim cites nothing, so there is nothing to draw. An unattested claim is the normal state of a
        newly raised one.
      </p>
    )
  }

  return (
    <ul className="strips">
      {bands.map((band) => {
        const rowHeight = label ? height + 14 : height
        const from = (Math.min(Math.max(band.from, 0), band.docBytes) / band.docBytes) * width
        const to = (Math.min(Math.max(band.to, from), band.docBytes) / band.docBytes) * width
        const tickWidth = Math.max(to - from, 3)
        return (
          <li className="strip" key={band.docId}>
            {label && (
              <span className="strip-label">
                <span className="strip-doc">{band.docId}</span>
                <span className="strip-meta">
                  bytes {band.from}–{band.to} of {band.docBytes.toLocaleString('en-US')}
                </span>
              </span>
            )}
            <svg
              className="strip-svg"
              viewBox={`0 0 ${width} ${rowHeight}`}
              width="100%"
              height={rowHeight}
              role="img"
              preserveAspectRatio="none"
              aria-label={`${band.docId}: cited bytes ${band.from} to ${band.to} of ${band.docBytes}, covering ${band.dimensions.join(', ')}`}
            >
              {/* the uncited remainder, drawn first so ticks sit on top of it */}
              <rect x={0} y={label ? 14 : 0} width={width} height={height} className="strip-gap" />
              <rect
                x={from + TICK_INSET}
                y={(label ? 14 : 0) + TICK_INSET}
                width={Math.max(tickWidth - TICK_INSET * 2, 1)}
                height={height - TICK_INSET * 2}
                className={band.valid ? 'strip-tick' : 'strip-broken'}
              />
              {/* a hairline at the document origin, so "start of the file" is legible */}
              <line x1={0} x2={0} y1={label ? 14 : 0} y2={label ? 14 : 0 + height} className="strip-origin" />
            </svg>
            {label && <span className="strip-dims">{band.dimensions.join(' · ')}</span>}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Coverage as a segmented bar: one cell per required dimension, filled when backed.
 *
 * Segmented rather than a percentage because the interesting question is never "how much" —
 * it is "which", and a continuous bar hides a claim that is 90% backed in one dimension and
 * 0% in another.
 */
export function Coverage({
  dimensions,
  total,
}: {
  readonly dimensions: readonly { key: string; required: boolean; backed: boolean }[]
  readonly total: number
}) {
  if (total === 0) return <span className="cov-none">no required dimensions</span>
  return (
    <span className="cov" role="img" aria-label={`${total} required dimensions`}>
      {dimensions.map((dimension) => (
        <span
          key={dimension.key}
          className={
            dimension.required
              ? dimension.backed
                ? 'cov-cell cov-backed'
                : 'cov-cell cov-missing'
              : 'cov-cell cov-advisory'
          }
          title={`${dimension.key}: ${dimension.backed ? 'backed' : 'not backed'}`}
        />
      ))}
    </span>
  )
}
