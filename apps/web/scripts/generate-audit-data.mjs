#!/usr/bin/env node
// Generate the web app's audit snapshot from the git-backed corpus.
//
// Why this exists
// ---------------
// The board's system of record is `audit/` at the repository root (ADR 0005). A serverless
// deployment of `apps/web` is not the repository: a function bundle has no `audit/`
// directory, so a route that calls readFileSync at request time works on a laptop and renders
// an error state in production. For this product that is the worst failure available -- a
// board that silently looks empty instead of one that admits it cannot read its evidence.
//
// So the corpus is snapshotted at build time into plain ESM. The snapshot is COMMITTED, so:
//   * the deployed app needs nothing from the filesystem at request time;
//   * a reviewer sees what the web app is serving in the diff that changes it;
//   * apps/web/tests/board.test.mjs fails if the snapshot drifts from audit/.
//
// It is emitted as .mjs rather than .ts so that Next.js and `node --test` both import it
// natively, with no bundler-specific resolution rules in between.
//
// Run: npm run generate:web-data

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..')
const OUTPUT = join(WEB, 'lib', 'audit-data.mjs')
const TYPES_OUTPUT = join(WEB, 'lib', 'audit-data.d.mts')

/** Walk upward for `audit/index.json`, so this works from apps/web or from the repo root. */
function findAuditRoot(start) {
  let dir = resolve(start)
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, 'audit')
    if (existsSync(join(candidate, 'index.json'))) return candidate
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

const root = findAuditRoot(WEB)
if (root === undefined) {
  console.error(`generate-audit-data — no audit/index.json found above ${WEB}`)
  process.exit(1)
}

const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'))

if (typeof index.root !== 'string' || index.root === '') {
  console.error('generate-audit-data — audit/index.json has no root; run: npm run cli -- index --write')
  process.exit(1)
}

const claimDir = join(root, 'claims')
const claims = readdirSync(claimDir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(claimDir, name), 'utf8')))

const docs = Object.entries(index.docs ?? {})
  .map(([docId, entry]) => ({ docId, blob: entry.blob, bytes: entry.bytes }))
  .sort((a, b) => a.docId.localeCompare(b.docId))

const payload = {
  root,
  version: index.version ?? 1,
  merkleRoot: index.root,
  commit: index.commit ?? null,
  docs,
  claims,
}

const BANNER = [
  '/**',
  ' * GENERATED FILE -- do not edit.',
  ' *',
  ' * Produced by apps/web/scripts/generate-audit-data.mjs from the git-backed audit corpus.',
  ' * Regenerate with: npm run generate:web-data',
  ' *',
  ' * Committed on purpose: a serverless bundle is not the repository, so the deployed board must',
  ' * not read the filesystem at request time. Committing it also means a reviewer sees what the',
  ' * web app serves in the diff that changes it.',
  ' *',
  ' * apps/web/tests/board.test.mjs fails if this drifts from audit/.',
  ' */',
  '',
].join('\n')

const body = [
  BANNER,
  `export const AUDIT_SNAPSHOT = ${JSON.stringify(payload, null, 2)}`,
  '',
  `export const AUDIT_VERDICTS = ${JSON.stringify(index.claims ?? {}, null, 2)}`,
  '',
].join('\n')

const TYPES = [
  '/**',
  ' * GENERATED FILE -- do not edit. Types for ./audit-data.mjs.',
  ' *',
  ' * TypeScript resolves "./audit-data.mjs" to this declaration, so the snapshot stays typed',
  ' * without the generator having to emit TypeScript.',
  ' */',
  '',
  'export interface SnapshotDoc {',
  '  readonly docId: string',
  '  readonly blob: string',
  '  readonly bytes: number',
  '}',
  '',
  'export interface SnapshotCitation {',
  '  readonly docId: string',
  '  readonly byteStart: number',
  '  readonly byteEnd: number',
  '  readonly expects?: string',
  '}',
  '',
  'export interface SnapshotDimension {',
  '  readonly key: string',
  '  readonly required: boolean',
  '  readonly citations: readonly SnapshotCitation[]',
  '}',
  '',
  'export interface SnapshotClaim {',
  '  readonly id: string',
  '  readonly title: string',
  '  readonly system: string',
  '  readonly state: string',
  '  readonly note: string',
  '  readonly dimensions: readonly SnapshotDimension[]',
  '}',
  '',
  'export interface SnapshotVerdict {',
  '  readonly claimId: string',
  '  /** The lifecycle state the claim was in when the index was published. */',
  '  readonly state: string',
  '  readonly verdict: string',
  '  readonly dimensionsTotal: number',
  '  readonly dimensionsRequired: number',
  '  readonly dimensionsCovered: number',
  '  readonly coverage: number',
  '  readonly citationsChecked: number',
  '  readonly citationsValid: number',
  '  readonly citationsInvalid: number',
  '  readonly attestedOver: readonly string[]',
  '  readonly root: string',
  '  readonly gaps: readonly { readonly dimension: string; readonly reason: string }[]',
  '  readonly spans: readonly {',
  '    readonly dimension: string',
  '    readonly docId: string',
  '    readonly blob: string',
  '    readonly byteStart: number',
  '    readonly byteEnd: number',
  '    readonly line: number',
  '    readonly valid: boolean',
  '    readonly reason: string',
  '    readonly text: string',
  '  }[]',
  '}',
  '',
  'export interface AuditSnapshot {',
  '  readonly root: string',
  '  readonly version: number',
  '  readonly merkleRoot: string',
  '  readonly commit: string | null',
  '  readonly docs: readonly SnapshotDoc[]',
  '  readonly claims: readonly SnapshotClaim[]',
  '}',
  '',
  'export declare const AUDIT_SNAPSHOT: AuditSnapshot',
  'export declare const AUDIT_VERDICTS: Readonly<Record<string, SnapshotVerdict>>',
  '',
].join('\n')

writeFileSync(OUTPUT, body, 'utf8')
writeFileSync(TYPES_OUTPUT, TYPES, 'utf8')

console.log(
  `generate-audit-data — ${claims.length} claim(s), ${docs.length} document(s), root ${index.root.slice(0, 16)}…`,
)
console.log(`  -> ${OUTPUT}`)
console.log(`  -> ${TYPES_OUTPUT}`)
