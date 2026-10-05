import type { BoardEntry, Corpus } from '@/lib/audit'

/** Per-claim presentation state, kept in one place so a card and a detail page never disagree. */

export type Tone = 'ok' | 'warn' | 'bad' | 'idle'

export function stateTone(state: string): Tone {
  switch (state) {
    case 'attested':
      return 'ok'
    case 'challenged':
      return 'warn'
    case 'withdrawn':
      return 'idle'
    case 'evidenced':
      return 'ok'
    default:
      return 'idle'
  }
}

export function verdictTone(verdict: string | undefined): Tone {
  switch (verdict) {
    case 'attestable':
      return 'ok'
    case 'partial':
      return 'warn'
    case 'unsubstantiated':
      return 'bad'
    default:
      return 'idle'
  }
}

export function verdictLabel(verdict: string | undefined): string {
  if (verdict === undefined) return 'not evaluated'
  return verdict
}

/** A dimension is backed when at least one of its citations resolved. */
export function backedDimensions(entry: BoardEntry): readonly {
  key: string
  required: boolean
  backed: boolean
}[] {
  const valid = new Map<string, number>()
  for (const span of entry.verdict?.spans ?? []) {
    if (span.valid) valid.set(span.dimension, (valid.get(span.dimension) ?? 0) + 1)
  }
  return entry.claim.dimensions.map((dimension) => ({
    key: dimension.key,
    required: dimension.required,
    backed: (valid.get(dimension.key) ?? 0) > 0,
  }))
}

export function requiredCount(entry: BoardEntry): number {
  return entry.claim.dimensions.filter((d) => d.required).length
}

export function docBytes(corpus: Corpus): Readonly<Record<string, number>> {
  return Object.fromEntries(corpus.docs.map((doc) => [doc.docId, doc.bytes]))
}

export function shortBlob(blob: string): string {
  return blob.slice(0, 7)
}
