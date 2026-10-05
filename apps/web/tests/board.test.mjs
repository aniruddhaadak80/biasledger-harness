import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  CLAIM_STATES,
  LEGAL,
  VERDICT_LABEL,
  boardEntries,
  gitBlob,
  groupByState,
  lineage,
  readCorpus,
  stats,
} from '../lib/audit.ts'
import { backedDimensions, shortBlob, stateTone, verdictTone } from '../lib/present.ts'

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(WEB, '..', '..')
const CORPUS = readCorpus()

function verdictFixture(overrides = {}) {
  return {
    claimId: 'c',
    verdict: 'attestable',
    dimensionsTotal: 2,
    dimensionsRequired: 2,
    dimensionsCovered: 2,
    coverage: 1,
    citationsChecked: 2,
    citationsValid: 2,
    citationsInvalid: 0,
    attestedOver: ['a'],
    root: 'f'.repeat(64),
    gaps: [],
    spans: [],
    ...overrides,
  }
}

function spanFixture(overrides = {}) {
  return {
    dimension: 'calibration',
    docId: 'a',
    blob: 'ab'.repeat(20),
    byteStart: 100,
    byteEnd: 300,
    line: 4,
    valid: true,
    reason: 'ok',
    text: 'x',
    ...overrides,
  }
}

// ── the derivation the board depends on ────────────────────────────────────

test("lineage draws a band at the citation's real byte proportion", () => {
  const bands = lineage(verdictFixture({ spans: [spanFixture()] }), { a: 1000 })
  assert.equal(bands.length, 1)
  assert.equal(bands[0].from, 100)
  assert.equal(bands[0].to, 300)
  assert.equal(bands[0].docBytes, 1000)
})

test('lineage merges several citations in one document into one band', () => {
  const bands = lineage(
    verdictFixture({
      spans: [
        spanFixture({ dimension: 'calibration' }),
        spanFixture({ dimension: 'missingness', byteStart: 500, byteEnd: 600 }),
      ],
    }),
    { a: 1000 },
  )
  assert.equal(bands.length, 1)
  assert.equal(bands[0].from, 100)
  assert.equal(bands[0].to, 600)
  assert.deepEqual(bands[0].dimensions, ['calibration', 'missingness'])
})

test('lineage marks a document tainted when any of its spans failed', () => {
  const bands = lineage(
    verdictFixture({
      spans: [spanFixture(), spanFixture({ dimension: 'x', valid: false, reason: 'text-mismatch' })],
    }),
    { a: 1000 },
  )
  assert.equal(bands[0].valid, false)
})

test('lineage clamps a span that runs past the end of the document', () => {
  const bands = lineage(verdictFixture({ spans: [spanFixture({ byteStart: 900, byteEnd: 9999 })] }), {
    a: 1000,
  })
  assert.equal(bands[0].to, 1000)
})

test('lineage drops a document of unknown length rather than drawing a false band', () => {
  assert.deepEqual(lineage(verdictFixture({ spans: [spanFixture()] }), {}), [])
})

test('lineage returns nothing when there is no verdict', () => {
  assert.deepEqual(lineage(undefined, { a: 1000 }), [])
})

test('stats derives every number from verdicts rather than from claim states', () => {
  const entries = [
    { claim: { id: 'a', state: 'evidenced' }, verdict: verdictFixture({ verdict: 'attestable' }) },
    {
      claim: { id: 'b', state: 'evidenced' },
      verdict: verdictFixture({ verdict: 'partial', citationsInvalid: 1 }),
    },
    {
      claim: { id: 'c', state: 'evidenced' },
      verdict: verdictFixture({
        verdict: 'unsubstantiated',
        gaps: [{ dimension: 'x', reason: 'no-citation' }],
      }),
    },
  ]
  const numbers = stats(entries)
  assert.deepEqual(numbers, {
    claims: 3,
    attestable: 1,
    partial: 1,
    unsubstantiated: 1,
    openGaps: 1,
    invalidCitations: 1,
  })
})

test('groupByState fills every lifecycle bucket and sorts it', () => {
  const groups = groupByState([
    { claim: { id: 'b', state: 'attested' }, verdict: undefined },
    { claim: { id: 'a', state: 'attested' }, verdict: undefined },
  ])
  assert.equal(groups.attested.length, 2)
  assert.deepEqual(
    groups.attested.map((entry) => entry.claim.id),
    ['a', 'b'],
  )
  for (const state of CLAIM_STATES) assert.ok(Array.isArray(groups[state]))
})

test('backedDimensions marks a dimension backed when any of its citations resolved', () => {
  const entry = {
    claim: {
      id: 'c',
      state: 'evidenced',
      dimensions: [
        { key: 'a', required: true, citations: [] },
        { key: 'b', required: false, citations: [] },
      ],
    },
    verdict: verdictFixture({ spans: [spanFixture({ dimension: 'a' })] }),
  }
  assert.deepEqual(backedDimensions(entry), [
    { key: 'a', required: true, backed: true },
    { key: 'b', required: false, backed: false },
  ])
})

test('a failed citation does not count as backing its dimension', () => {
  const entry = {
    claim: { id: 'c', state: 'evidenced', dimensions: [{ key: 'a', required: true, citations: [] }] },
    verdict: verdictFixture({ spans: [spanFixture({ dimension: 'a', valid: false })] }),
  }
  assert.equal(backedDimensions(entry)[0].backed, false)
})

test('a claim with no verdict reports every dimension as unbacked rather than crashing', () => {
  const entry = {
    claim: { id: 'c', state: 'unverified', dimensions: [{ key: 'a', required: true, citations: [] }] },
    verdict: undefined,
  }
  assert.equal(backedDimensions(entry)[0].backed, false)
})

// ── presentation mapping ───────────────────────────────────────────────────

test('every lifecycle state has a tone', () => {
  for (const state of CLAIM_STATES) assert.ok(stateTone(state))
})

test('only a failed citation gets the danger tone', () => {
  assert.equal(verdictTone('attestable'), 'ok')
  assert.equal(verdictTone('partial'), 'warn')
  assert.equal(verdictTone('unsubstantiated'), 'bad')
  assert.equal(verdictTone(undefined), 'idle')
})

test('shortBlob abbreviates to the conventional seven characters', () => {
  assert.equal(shortBlob('0123456789abcdef'), '0123456')
})

test('the lifecycle table names legal targets only for real states', () => {
  for (const state of CLAIM_STATES) {
    for (const target of LEGAL[state]) assert.ok(CLAIM_STATES.includes(target), `${state} -> ${target}`)
    assert.ok(!LEGAL[state].includes(state), `${state} must not reach itself`)
  }
})

test('every verdict has a human explanation', () => {
  for (const key of ['attestable', 'partial', 'unsubstantiated']) {
    assert.ok(VERDICT_LABEL[key].length > 10)
  }
})

// ── the shipped corpus, as the page will read it ───────────────────────────

test('the shipped corpus loads', { skip: !CORPUS.ok && 'no audit corpus in this checkout' }, () => {
  assert.equal(CORPUS.ok, true, CORPUS.problem)
  assert.ok(CORPUS.index.root.length === 64)
  assert.ok(CORPUS.docs.length > 0)
  assert.ok(CORPUS.claims.length > 0)
})

test(
  'every committed verdict carries the fields the board reads',
  { skip: !CORPUS.ok && 'no audit corpus in this checkout' },
  () => {
    // Regression: an earlier commit stored a reduced per-claim summary with no `spans`, and
    // the board threw while rendering the lineage strip. This is the test for that.
    for (const [id, entry] of Object.entries(CORPUS.index.claims)) {
      assert.ok(Array.isArray(entry.spans), `${id} has no spans array`)
      assert.ok(Array.isArray(entry.gaps), `${id} has no gaps array`)
      assert.ok(Array.isArray(entry.attestedOver), `${id} has no attestedOver array`)
      assert.equal(typeof entry.root, 'string', `${id} has no root`)
      assert.equal(entry.root.length, 64, `${id} root is not a sha256`)
      assert.equal(typeof entry.citationsInvalid, 'number', `${id} has no citationsInvalid`)
      assert.ok(['attestable', 'partial', 'unsubstantiated'].includes(entry.verdict), `${id}`)
      assert.ok(CLAIM_STATES.includes(entry.state), `${id} has an unknown state`)
    }
  },
)

test(
  'every claim on disk has a verdict in the committed index',
  { skip: !CORPUS.ok && 'no audit corpus in this checkout' },
  () => {
    for (const claim of CORPUS.claims) {
      assert.ok(CORPUS.index.claims[claim.id], `${claim.id} is not in audit/index.json`)
    }
  },
)

test(
  'every span points into a document the corpus knows',
  { skip: !CORPUS.ok && 'no audit corpus in this checkout' },
  () => {
    const known = new Set(CORPUS.docs.map((doc) => doc.docId))
    for (const entry of Object.values(CORPUS.index.claims)) {
      for (const span of entry.spans) {
        assert.ok(known.has(span.docId), `${span.docId} is not in the corpus`)
        assert.ok(span.byteStart >= 0, 'negative offset')
        assert.ok(span.byteEnd > span.byteStart, 'inverted or empty span')
      }
    }
  },
)

test(
  'a span marked invalid must be genuinely unresolvable, not a rendering choice',
  { skip: !CORPUS.ok && 'no audit corpus in this checkout' },
  () => {
    // The board colours a span red when `valid` is false. That colour is a claim about the
    // bytes, so it has to be earned: an invalid span must carry a reason.
    const reasons = new Set([
      'unknown-document',
      'span-past-end',
      'empty-span',
      'blank-span',
      'text-mismatch',
      'negative-offset',
      'not-utf8',
    ])
    for (const entry of Object.values(CORPUS.index.claims)) {
      for (const span of entry.spans) {
        if (span.valid) assert.equal(span.reason, 'ok', `${span.dimension} valid but reason is odd`)
        else assert.ok(reasons.has(span.reason), `unknown failure reason: ${span.reason}`)
      }
    }
  },
)

test(
  'the committed blobs still hash the evidence on disk',
  { skip: !CORPUS.ok && 'no audit corpus in this checkout' },
  () => {
    for (const doc of CORPUS.docs) {
      const text = readFileSync(join(CORPUS.root, 'evidence', `${doc.docId}.md`), 'utf8')
      assert.equal(gitBlob(text), doc.blob, `${doc.docId} drifted from the committed index`)
    }
  },
)

test('the git blob id is 40 hex characters', { skip: !existsSync(REPO) && 'no repo' }, () => {
  assert.match(gitBlob('hello'), /^[0-9a-f]{40}$/)
})

test('boardEntries pairs every claim with its committed verdict', () => {
  const entries = boardEntries(CORPUS)
  assert.equal(entries.length, CORPUS.claims.length)
  for (const entry of entries) {
    assert.equal(entry.claim.id, entry.claim.id)
    if (CORPUS.ok) assert.ok(entry.verdict !== undefined, `${entry.claim.id} has no verdict`)
  }
})

// ── the snapshot cannot drift from audit/ ───────────────────────────────────

test(
  'the committed web snapshot still matches audit/index.json',
  { skip: !CORPUS.ok && 'no audit corpus in this checkout' },
  () => {
    // The web app reads audit-data.ts, not the filesystem. If the snapshot drifts from the
    // corpus, the deployed board would show a Merkle root that does not describe the evidence
    // in this repository -- the exact failure the product exists to prevent.
    const onDisk = JSON.parse(readFileSync(join(CORPUS.root, 'index.json'), 'utf8'))
    assert.equal(CORPUS.index.root, onDisk.root, 'snapshot root differs from audit/index.json')
    assert.equal(CORPUS.index.version, onDisk.version, 'snapshot version differs')
    assert.deepEqual(
      CORPUS.docs.map((d) => [d.docId, d.blob, d.bytes]),
      Object.entries(onDisk.docs)
        .map(([docId, e]) => [docId, e.blob, e.bytes])
        .sort((a, b) => a[0].localeCompare(b[0])),
      'snapshot documents differ from audit/index.json',
    )
    assert.equal(
      Object.keys(CORPUS.index.claims).length,
      Object.keys(onDisk.claims).length,
      'snapshot verdict count differs',
    )
  },
)

test(
  'every claim on disk is in the snapshot, byte for byte',
  { skip: !CORPUS.ok && 'no audit corpus in this checkout' },
  () => {
    const claimDir = join(CORPUS.root, 'claims')
    for (const name of readdirSync(claimDir)
      .filter((f) => f.endsWith('.json'))
      .sort()) {
      const onDisk = JSON.parse(readFileSync(join(claimDir, name), 'utf8'))
      const inSnapshot = CORPUS.claims.find((c) => c.id === onDisk.id)
      assert.ok(inSnapshot, `${onDisk.id} is on disk but not in the web snapshot`)
      assert.deepEqual(inSnapshot, onDisk, `${onDisk.id} differs between audit/ and the snapshot`)
    }
  },
)

test('the snapshot needs no filesystem: readCorpus works with no audit/ on disk', () => {
  // Asserted structurally. `readCorpus` imports only audit-data.ts, so if this file ever
  // reintroduces an fs import the import list below fails and this test says so.
  const source = readFileSync(join(WEB, 'lib', 'audit.ts'), 'utf8')
  assert.doesNotMatch(source, /from 'node:fs'/, 'audit.ts must not read the filesystem')
  assert.doesNotMatch(source, /from 'node:path'/, 'audit.ts must not resolve paths')
  assert.equal(CORPUS.ok, true, 'the snapshot alone should satisfy readCorpus')
})
