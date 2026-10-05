#!/usr/bin/env node
// The web app's snapshot must never drift from the git-backed corpus.
//
// `apps/web/lib/audit-data.mjs` is committed so the deployed board needs no filesystem, which
// means it *can* go stale. This gate regenerates it into a temp file and compares, so a stale
// snapshot is a build failure rather than a deployed page serving a Merkle root that does not
// describe the evidence in this repository.
//
//   node scripts/check-web-data.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT = join(ROOT, 'apps', 'web', 'lib', 'audit-data.mjs')
const TYPES = join(ROOT, 'apps', 'web', 'lib', 'audit-data.d.mts')
const GENERATOR = join(ROOT, 'apps', 'web', 'scripts', 'generate-audit-data.mjs')

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

const head = gitHead()
if (head === null) {
  console.log('check:web-data — no git HEAD yet (fresh repo), skipping the comparison')
  process.exit(0)
}

const committed = readFileSync(SNAPSHOT, 'utf8')
const scratch = mkdtempSync(join(tmpdir(), 'web-data-'))

try {
  // Regenerate in place, compare, and restore. Doing it in the working tree rather than a copy
  // keeps the generator's path logic under test -- the same code the developer runs.
  execFileSync('node', [GENERATOR], { cwd: ROOT, stdio: 'ignore' })
  const fresh = readFileSync(SNAPSHOT, 'utf8')
  const freshTypes = readFileSync(TYPES, 'utf8')

  const committedTypes = (() => {
    try {
      return execFileSync('git', ['show', `HEAD:apps/web/lib/audit-data.d.mts`], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      return null
    }
  })()

  if (committed !== fresh) {
    console.error('check:web-data FAILED — the committed web snapshot is stale')
    console.error('  apps/web/lib/audit-data.mjs does not match audit/')
    console.error('  fix: npm run generate:web-data, then commit the result')
    process.exit(1)
  }

  if (committedTypes !== null && committedTypes !== freshTypes) {
    console.error('check:web-data FAILED — the committed snapshot type declarations are stale')
    console.error('  apps/web/lib/audit-data.d.mts does not match the generator')
    console.error('  fix: npm run generate:web-data, then commit the result')
    process.exit(1)
  }

  console.log('check:web-data — clean (apps/web/lib/audit-data.mjs matches audit/index.json)')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
