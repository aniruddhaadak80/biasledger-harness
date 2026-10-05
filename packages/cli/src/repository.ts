import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NotFoundError, ValidationError, type Claim, type ClaimState } from '@biasledgerharness/core'
import { isClaimState } from '@biasledgerharness/core'

/**
 * The git-backed store.
 *
 * The system of record is the repository, not the database: evidence artifacts are content,
 * claim records are JSON, and the index manifest is a derived file that is safe to delete and
 * rebuild. Everything here is therefore plain filesystem reads over a directory, plus one
 * content hash — the same git blob id the Python engine computes, so a citation written by
 * either side agrees with the other.
 */

export interface EvidenceDoc {
  readonly docId: string
  readonly blob: string
  readonly text: string
  readonly bytes: number
  readonly path: string
}

export interface AuditPaths {
  readonly root: string
  readonly evidence: string
  readonly claims: string
  readonly index: string
}

export function auditPaths(cwd = process.cwd()): AuditPaths {
  const root = join(cwd, 'audit')
  return {
    root,
    evidence: join(root, 'evidence'),
    claims: join(root, 'claims'),
    index: join(root, 'index.json'),
  }
}

/**
 * The git blob id for these exact bytes.
 *
 * Identical to the engine's `blob_for`, and to what `git hash-object` prints. A citation that
 * carries this value stays meaningful after the branch moves, because the name is the hash.
 */
export function gitBlob(text: string): string {
  const bytes = Buffer.from(text, 'utf8')
  const header = Buffer.from(`blob ${bytes.length}\0`, 'ascii')
  return createHash('sha1').update(header).update(bytes).digest('hex')
}

/** The abbreviated form used everywhere a human reads a blob. */
export function shortBlob(blob: string): string {
  return blob.slice(0, 7)
}

/** The current commit, when the audit directory is inside a real git repository. */
export function headCommit(cwd = process.cwd()): string | undefined {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const sha = result.stdout?.trim()
  return result.status === 0 && sha !== undefined && sha !== '' ? sha : undefined
}

export function readEvidence(cwd = process.cwd()): readonly EvidenceDoc[] {
  const { evidence } = auditPaths(cwd)
  if (!existsSync(evidence)) {
    throw new NotFoundError('no audit/evidence directory — nothing to audit', {
      fix: 'create audit/evidence/*.md, one file per artifact',
    })
  }

  return readdirSync(evidence)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const path = join(evidence, name)
      const text = readFileSync(path, 'utf8')
      return {
        docId: name.replace(/\.md$/, ''),
        blob: gitBlob(text),
        text,
        bytes: Buffer.byteLength(text, 'utf8'),
        path,
      }
    })
}

/** Accepts a claim file if it satisfies the engine's contract; rejects it with the reason. */
export function parseClaim(raw: string, source: string): Claim {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new ValidationError(`${source}: not valid JSON — ${String(cause)}`, { source })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError(`${source}: must be a JSON object`, { source })
  }
  const record = parsed as Record<string, unknown>

  for (const key of ['id', 'title', 'state', 'dimensions']) {
    if (!(key in record)) {
      throw new ValidationError(`${source}: missing ${key}`, { source, field: key })
    }
  }
  if (typeof record['id'] !== 'string' || record['id'] === '') {
    throw new ValidationError(`${source}: id must be a non-empty string`, { source })
  }
  if (typeof record['state'] !== 'string' || !isClaimState(record['state'])) {
    throw new ValidationError(
      `${source}: state must be one of unverified, evidenced, challenged, attested, withdrawn`,
      { source, received: record['state'] },
    )
  }
  if (!Array.isArray(record['dimensions'])) {
    throw new ValidationError(`${source}: dimensions must be an array`, { source })
  }

  return {
    id: record['id'],
    title: typeof record['title'] === 'string' ? record['title'] : '',
    system: typeof record['system'] === 'string' ? record['system'] : 'unknown',
    state: record['state'] as ClaimState,
    note: typeof record['note'] === 'string' ? record['note'] : '',
    dimensions: record['dimensions'] as Claim['dimensions'],
  }
}

export function readClaims(cwd = process.cwd()): readonly Claim[] {
  const { claims } = auditPaths(cwd)
  if (!existsSync(claims)) return []
  return readdirSync(claims)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => parseClaim(readFileSync(join(claims, name), 'utf8'), `audit/claims/${name}`))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function readClaim(id: string, cwd = process.cwd()): Claim {
  const claim = readClaims(cwd).find((entry) => entry.id === id)
  if (claim === undefined) {
    throw new NotFoundError(`no claim "${id}" in audit/claims`, {
      claim: id,
      fix: 'run "biasledger claims" to list what is on the board',
    })
  }
  return claim
}

export function writeClaim(claim: Claim, cwd = process.cwd()): string {
  const { claims } = auditPaths(cwd)
  if (!existsSync(claims)) {
    throw new NotFoundError('no audit/claims directory', {
      fix: 'mkdir -p audit/claims, then re-run',
    })
  }
  const path = join(claims, `${claim.id}.json`)
  writeFileSync(path, `${JSON.stringify(claim, null, 2)}\n`, 'utf8')
  return path
}

export interface StoredManifest {
  readonly version: number
  readonly root: string
  readonly docs: Readonly<Record<string, { readonly blob: string; readonly bytes: number }>>
  readonly claims: Readonly<Record<string, unknown>>
  /** The engine's resumable build state, verbatim. Safe to delete; rebuildable from the corpus. */
  readonly engineManifest?: unknown
  readonly commit?: string
  readonly generatedFrom?: readonly string[]
}

export function readManifest(cwd = process.cwd()): StoredManifest | undefined {
  const { index } = auditPaths(cwd)
  if (!existsSync(index)) return undefined
  const parsed = JSON.parse(readFileSync(index, 'utf8')) as StoredManifest
  if (typeof parsed['root'] !== 'string') {
    throw new ValidationError('audit/index.json has no root', { fix: 'run "biasledger index"' })
  }
  return parsed
}

export function writeManifest(manifest: StoredManifest, cwd = process.cwd()): string {
  const { root: audit } = auditPaths(cwd)
  if (!existsSync(audit)) {
    throw new NotFoundError('no audit directory', { fix: 'mkdir -p audit/evidence audit/claims' })
  }
  const path = auditPaths(cwd).index
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return path
}
