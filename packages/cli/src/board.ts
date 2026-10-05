import {
  CLAIM_STATES,
  groupByState,
  lineage,
  type ClaimState,
  type EvaluatedClaim,
} from '@biasledgerharness/core'

/**
 * The claim board: this product's primary interface.
 *
 * It is a kanban over the five claim states, and its one identifying feature is the
 * span-lineage strip under every card — one band per cited document, drawn across that
 * document's real byte range. A tick is a citation that resolved; the gaps are the parts of
 * the document the claim does not actually rest on; an `x` is a citation that no longer says
 * what it said. Two reviewers looking at the same claim see the same silhouette, which is the
 * entire point of the product.
 */

export interface CorpusEntry {
  readonly docId: string
  readonly bytes: number
}

export interface BoardInput {
  readonly evaluated: readonly EvaluatedClaim[]
  readonly corpus: readonly CorpusEntry[]
  readonly width?: number
  readonly commit?: string
  readonly root?: string
}

const DEFAULT_WIDTH = 78
const STRIP_WIDTH = 34

/** Glyphs. No emoji: a terminal board is read by people who pipe it. */
const TICK = '#'
const GAP = '.'
const BROKEN = 'x'
const RULE = '-'

/**
 * Draw one document's band.
 *
 * `width` columns represent the document's whole byte range. A citation occupies the columns
 * its byte span covers, rounded outward, so a citation can never be hidden by rounding — and
 * an out-of-range citation clamps into the band instead of vanishing.
 */
export function renderStrip(
  segments: readonly { readonly from: number; readonly to: number; readonly valid: boolean }[],
  docBytes: number,
  width = STRIP_WIDTH,
): string {
  if (docBytes <= 0) return ''.padEnd(width, GAP)

  const cells = new Array<string>(width).fill(GAP)
  for (const segment of segments) {
    const from = Math.min(Math.max(segment.from, 0), docBytes)
    const to = Math.min(Math.max(segment.to, from), docBytes)
    const first = Math.min(width - 1, Math.floor((from / docBytes) * width))
    const last = Math.min(width - 1, Math.max(first, Math.ceil((to / docBytes) * width) - 1))
    const glyph = segment.valid ? TICK : BROKEN
    for (let column = first; column <= last; column += 1) cells[column] = glyph
  }
  return cells.join('')
}

function segmentsFor(entry: EvaluatedClaim, corpus: readonly CorpusEntry[]) {
  const sizes = Object.fromEntries(corpus.map((doc) => [doc.docId, doc.bytes]))
  return lineage(entry.verdict, sizes)
}

function truncate(text: string, budget: number): string {
  if (text.length <= budget) return text
  return budget <= 1 ? text.slice(0, Math.max(budget, 0)) : `${text.slice(0, budget - 1)}…`
}

/**
 * Render one card.
 *
 * `budget` is the number of columns this card's own text may occupy, *after* the board has
 * added its two-space column indent — so the board trims the card budget by two rather than
 * silently emitting lines four columns wider than the requested width.
 */
function renderCard(
  entry: EvaluatedClaim,
  corpus: readonly CorpusEntry[],
  budget: number,
): readonly string[] {
  const { claim, verdict } = entry
  const segments = segmentsFor(entry, corpus)
  const lines: string[] = [
    truncate(claim.id, budget),
    `  ${truncate(claim.title, budget - 2)}`,
    `  ${truncate(
      `${verdict.verdict}  ${verdict.dimensionsCovered}/${verdict.dimensionsRequired} covered` +
        (verdict.citationsInvalid > 0 ? `  ${verdict.citationsInvalid} broken` : ''),
      budget - 2,
    )}`,
  ]

  const stripWidth = Math.max(Math.min(STRIP_WIDTH, budget - 2), 4)
  for (const segment of segments) {
    lines.push(`  ${truncate(segment.docId, budget - 2)}`)
    lines.push(`  [${renderStrip([segment], segment.docBytes, stripWidth)}]`)
  }

  const uncited = corpus.filter((doc) => !verdict.attestedOver.includes(doc.docId)).length
  if (uncited > 0) {
    lines.push(truncate(`  +${uncited} corpus document(s) not cited`, budget))
  }

  for (const gap of verdict.gaps) {
    lines.push(truncate(`  gap: ${gap.dimension} (${gap.reason})`, budget))
  }

  return lines
}

/**
 * Wrap the legend to the requested width.
 *
 * `--width` is a promise about the output, and a legend wider than the board breaks it — the
 * one line a reader needs most is the one that wrapped.
 */
function legend(width: number): readonly string[] {
  const entries = [
    `${TICK} citation resolved`,
    `${BROKEN} citation no longer says what it said`,
    `${GAP} uncited`,
  ]
  const out: string[] = []
  let line = 'legend:'
  for (const entry of entries) {
    if (line.length + entry.length + 2 > width) {
      out.push(line)
      line = `  ${entry}`
      continue
    }
    line = `${line}  ${entry}`
  }
  out.push(line)
  return out
}

/** The whole board, one section per state, in the lifecycle order. */
export function renderBoard(input: BoardInput): string {
  const width = Math.max(input.width ?? DEFAULT_WIDTH, 32)
  const groups = groupByState(input.evaluated)
  const out: string[] = []

  out.push(RULE.repeat(width))
  out.push(`biasledger — claim board${input.commit === undefined ? '' : ` @ ${input.commit.slice(0, 7)}`}`)
  if (input.root !== undefined) out.push(`evidence root ${input.root}`)
  out.push(RULE.repeat(width))

  for (const state of CLAIM_STATES) {
    const bucket = groups[state]
    out.push('')
    out.push(`${state.toUpperCase()} (${bucket.length})`)
    if (bucket.length === 0) {
      out.push('  (none)')
      continue
    }
    for (const entry of bucket) out.push(...renderCard(entry, input.corpus, width - 2))
  }

  out.push('')
  out.push(...legend(width))
  out.push(RULE.repeat(width))
  return out.join('\n')
}

// ------------------------------------------------------------------ navigation

/**
 * The cursor is a separate state machine from the renderer on purpose: the interesting
 * failure — a cursor that walks off the end of a column — is testable without a terminal.
 */
export interface Cursor {
  readonly column: number
  readonly row: number
}

export type KeyAction =
  | { readonly kind: 'move'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'select' }
  | { readonly kind: 'quit' }
  | { readonly kind: 'none' }

/** Map a keypress to an intent. Unrecognised keys are explicitly a no-op, never a guess. */
export function keyToAction(key: string): KeyAction {
  switch (key) {
    case 'h':
    case '\u001b[D':
      return { kind: 'move', dx: -1, dy: 0 }
    case 'l':
    case '\u001b[C':
      return { kind: 'move', dx: 1, dy: 0 }
    case 'k':
    case '\u001b[A':
      return { kind: 'move', dx: 0, dy: -1 }
    case 'j':
    case '\u001b[B':
      return { kind: 'move', dx: 0, dy: 1 }
    case '\r':
    case '\n':
      return { kind: 'select' }
    case 'q':
      return { kind: 'quit' }
    default:
      return { kind: 'none' }
  }
}

/** Clamp, never wrap: wrapping in a claim board silently teleports a reviewer. */
export function moveCursor(
  cursor: Cursor,
  action: Extract<KeyAction, { kind: 'move' }>,
  counts: readonly number[],
): Cursor {
  const column = Math.min(Math.max(cursor.column + action.dx, 0), Math.max(counts.length - 1, 0))
  const inColumn = counts[column] ?? 0
  const row = inColumn === 0 ? 0 : Math.min(Math.max(cursor.row + action.dy, 0), inColumn - 1)
  return { column, row }
}

export function emptyCursor(): Cursor {
  return { column: 0, row: 0 }
}

export function boardCounts(evaluated: readonly EvaluatedClaim[]): readonly number[] {
  const groups = groupByState(evaluated)
  return CLAIM_STATES.map((state: ClaimState) => groups[state].length)
}
