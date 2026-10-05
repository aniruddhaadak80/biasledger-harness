import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  auditPaths,
  gitBlob,
  headCommit,
  parseClaim,
  readClaims,
  readEvidence,
  readManifest,
  shortBlob,
  writeClaim,
} from './repository.js'

const dirs: string[] = []

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'ledger-repo-'))
  dirs.push(root)
  mkdirSync(join(root, 'audit', 'evidence'), { recursive: true })
  mkdirSync(join(root, 'audit', 'claims'), { recursive: true })
  return root
}

function evidence(root: string, docId: string, text: string): void {
  writeFileSync(join(root, 'audit', 'evidence', `${docId}.md`), text, 'utf8')
}

function claimJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'c1',
    title: 'a claim',
    system: 'sys',
    state: 'evidenced',
    note: '',
    dimensions: [{ key: 'k', required: true, citations: [] }],
    ...overrides,
  })
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('gitBlob', () => {
  it('matches what git itself computes for the same bytes', () => {
    // The point of a blob id is that it means what git says it means. Ask git.
    const root = repo()
    const text = 'Calibration — 0.031\nacross all groups.\n'
    writeFileSync(join(root, 'probe.md'), text, 'utf8')
    const fromGit = execFileSync('git', ['hash-object', 'probe.md'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    expect(gitBlob(text)).toBe(fromGit)
  })

  it('is stable for the same text', () => {
    expect(gitBlob('hello')).toBe(gitBlob('hello'))
  })

  it('changes when a single byte changes', () => {
    expect(gitBlob('hello')).not.toBe(gitBlob('hellp'))
  })

  it('counts UTF-8 bytes rather than characters', () => {
    // "é" is one character and two bytes; the header must say two.
    expect(gitBlob('é')).toHaveLength(40)
    expect(gitBlob('é')).not.toBe(gitBlob('e'))
  })
})

describe('shortBlob', () => {
  it('abbreviates to the conventional seven characters', () => {
    expect(shortBlob('0123456789abcdef')).toBe('0123456')
  })
})

describe('readEvidence', () => {
  it('returns nothing when the directory is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'ledger-empty-'))
    dirs.push(root)
    expect(() => readEvidence(root)).toThrow(/audit\/evidence/)
  })

  it('reads markdown files and derives the doc id from the name', () => {
    const root = repo()
    evidence(root, 'model-card', 'a card\n')
    const docs = readEvidence(root)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.docId).toBe('model-card')
  })

  it('reports each document byte length in UTF-8', () => {
    const root = repo()
    evidence(root, 'd', 'café\n')
    expect(readEvidence(root)[0]?.bytes).toBe(6)
  })

  it('sorts by doc id so the corpus order never depends on the filesystem', () => {
    const root = repo()
    evidence(root, 'zeta', 'z\n')
    evidence(root, 'alpha', 'a\n')
    expect(readEvidence(root).map((d) => d.docId)).toEqual(['alpha', 'zeta'])
  })

  it('ignores non-markdown files', () => {
    const root = repo()
    evidence(root, 'a', 'a\n')
    writeFileSync(join(root, 'audit', 'evidence', 'notes.txt'), 'ignored\n', 'utf8')
    expect(readEvidence(root)).toHaveLength(1)
  })

  it('computes a blob id matching git for each artifact', () => {
    const root = repo()
    const text = 'Group A 0.028\n'
    evidence(root, 'report', text)
    const expected = execFileSync('git', ['hash-object', 'audit/evidence/report.md'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    expect(readEvidence(root)[0]?.blob).toBe(expected)
  })
})

describe('parseClaim', () => {
  it('accepts a well-formed claim', () => {
    const claim = parseClaim(claimJson(), 'test')
    expect(claim.id).toBe('c1')
    expect(claim.state).toBe('evidenced')
  })

  it('defaults a missing note and system rather than failing', () => {
    const raw = JSON.stringify({ id: 'c', title: 't', state: 'attested', dimensions: [] })
    const claim = parseClaim(raw, 'test')
    expect(claim.note).toBe('')
    expect(claim.system).toBe('unknown')
  })

  it('rejects invalid JSON with the file name', () => {
    expect(() => parseClaim('{oops', 'audit/claims/bad.json')).toThrow(/bad\.json/)
  })

  it('rejects a non-object', () => {
    expect(() => parseClaim('[]', 'test')).toThrow(/must be a JSON object/)
  })

  it.each(['id', 'title', 'state', 'dimensions'])('rejects a claim missing %s', (key) => {
    const raw = JSON.parse(claimJson()) as Record<string, unknown>
    delete raw[key]
    expect(() => parseClaim(JSON.stringify(raw), 'test')).toThrow(new RegExp(key))
  })

  it('rejects an unknown state and names the field', () => {
    expect(() => parseClaim(claimJson({ state: 'vibes' }), 'test')).toThrow(/state must be one of/)
  })

  it('rejects dimensions that are not an array', () => {
    expect(() => parseClaim(claimJson({ dimensions: {} }), 'test')).toThrow(/must be an array/)
  })

  it('rejects an empty id', () => {
    expect(() => parseClaim(claimJson({ id: '' }), 'test')).toThrow(/non-empty/)
  })
})

describe('readClaims', () => {
  it('returns nothing when the directory is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'ledger-noclaims-'))
    dirs.push(root)
    expect(readClaims(root)).toEqual([])
  })

  it('sorts claims by id', () => {
    const root = repo()
    writeFileSync(join(root, 'audit', 'claims', 'b.json'), claimJson({ id: 'b' }), 'utf8')
    writeFileSync(join(root, 'audit', 'claims', 'a.json'), claimJson({ id: 'a' }), 'utf8')
    expect(readClaims(root).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('reports the offending file when a claim is invalid', () => {
    const root = repo()
    writeFileSync(join(root, 'audit', 'claims', 'bad.json'), '{', 'utf8')
    expect(() => readClaims(root)).toThrow(/bad\.json/)
  })
})

describe('writeClaim', () => {
  it('round-trips a claim through disk', () => {
    const root = repo()
    const claim = parseClaim(claimJson({ note: 'a note' }), 'test')
    writeClaim(claim, root)
    expect(readClaims(root)[0]?.note).toBe('a note')
  })

  it('names the file after the claim id', () => {
    const root = repo()
    const claim = parseClaim(claimJson({ id: 'triage-calibration' }), 'test')
    writeClaim(claim, root)
    expect(readFileSync(join(root, 'audit', 'claims', 'triage-calibration.json'), 'utf8')).toContain(
      '"triage-calibration"',
    )
  })

  it('fails with a fix hint when the claims directory is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'ledger-nowrite-'))
    dirs.push(root)
    expect(() => writeClaim(parseClaim(claimJson(), 'test'), root)).toThrow(/audit\/claims/)
  })
})

describe('readManifest', () => {
  it('returns undefined when no index has been published', () => {
    const root = repo()
    expect(readManifest(root)).toBeUndefined()
  })

  it('rejects a manifest with no root rather than trusting it', () => {
    const root = repo()
    writeFileSync(join(root, 'audit', 'index.json'), JSON.stringify({ version: 1 }), 'utf8')
    expect(() => readManifest(root)).toThrow(/no root/)
  })
})

describe('auditPaths', () => {
  it('locates every part of the store', () => {
    const paths = auditPaths('C:\\repo')
    expect(paths.evidence).toContain('evidence')
    expect(paths.claims).toContain('claims')
    expect(paths.index).toContain('index.json')
  })
})

describe('headCommit', () => {
  it('returns undefined outside a git repository rather than throwing', () => {
    const root = mkdtempSync(join(tmpdir(), 'ledger-nogit-'))
    dirs.push(root)
    expect(headCommit(root)).toBeUndefined()
  })
})
