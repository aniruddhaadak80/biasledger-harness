import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { doctor, renderReport } from './doctor.js'

const dirs: string[] = []

/** The real repository root, so the engine probe has a real engine to reach. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * A synthetic tree for every probe except the engine.
 *
 * The engine probe is pointed at the real checkout rather than stubbed: a doctor test that
 * mocks the thing it is supposed to be diagnosing proves nothing, and a stub would let a
 * broken engine path pass CI.
 */
function repo(withEvidence = true): string {
  const root = mkdtempSync(join(tmpdir(), 'doctor-'))
  dirs.push(root)
  mkdirSync(join(root, 'skills', 'alpha'), { recursive: true })
  writeFileSync(
    join(root, 'skills', 'alpha', 'SKILL.md'),
    '---\nname: alpha\ndescription: A valid skill for the doctor test suite.\nmetadata:\n  version: 1.0.0\n---\nBody.\n',
    'utf8',
  )
  mkdirSync(join(root, 'plugins'), { recursive: true })
  if (withEvidence) {
    mkdirSync(join(root, 'audit', 'evidence'), { recursive: true })
    mkdirSync(join(root, 'audit', 'claims'), { recursive: true })
    writeFileSync(join(root, 'audit', 'evidence', 'card.md'), 'Calibration 0.031\n', 'utf8')
    writeFileSync(
      join(root, 'audit', 'claims', 'c1.json'),
      JSON.stringify({
        id: 'c1',
        title: 't',
        system: 's',
        state: 'evidenced',
        note: '',
        dimensions: [],
      }),
      'utf8',
    )
  }
  return root
}

const check = (report: { checks: readonly { name: string }[] }, name: string) =>
  report.checks.find((c) => c.name === name)

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('doctor', () => {
  it('passes on a well-formed tree', async () => {
    const report = await doctor(repo(), { engineRoot: REPO_ROOT })
    expect(report.ok).toBe(true)
    expect(check(report, 'skills')?.status).toBe('ok')
    expect(check(report, 'evidence')?.status).toBe('ok')
    expect(check(report, 'engine')?.status).toBe('ok')
  })

  it('fails and names a fix when a skill is invalid', async () => {
    const root = repo()
    mkdirSync(join(root, 'skills', 'broken'), { recursive: true })
    writeFileSync(join(root, 'skills', 'broken', 'SKILL.md'), 'no frontmatter', 'utf8')
    const report = await doctor(root, { engineRoot: REPO_ROOT })
    expect(report.ok).toBe(false)
    const skills = report.checks.find((c) => c.name === 'skills')
    expect(skills?.status).toBe('fail')
    expect(skills?.fix).toBeTruthy()
  })

  it('warns rather than fails when config is absent', async () => {
    const report = await doctor(repo(), { engineRoot: REPO_ROOT })
    expect(check(report, 'config')?.status).toBe('warn')
    expect(report.ok).toBe(true)
  })

  it('warns when no index has been published yet', async () => {
    const report = await doctor(repo(), { engineRoot: REPO_ROOT })
    expect(check(report, 'index')?.status).toBe('warn')
    expect(check(report, 'index')?.fix).toContain('index --write')
  })

  it('fails when the evidence corpus is missing', async () => {
    const report = await doctor(repo(false), { engineRoot: REPO_ROOT })
    expect(report.ok).toBe(false)
    const evidence = report.checks.find((c) => c.name === 'evidence')
    expect(evidence?.status).toBe('fail')
    expect(evidence?.fix).toContain('audit/evidence')
  })

  it('reports the operation count the engine actually reports', async () => {
    const report = await doctor(repo(), { engineRoot: REPO_ROOT })
    const engine = report.checks.find((c) => c.name === 'engine')
    // Read from the engine, not from a constant written next to the doctor.
    expect(engine?.detail).toMatch(/^5 lifecycle states, \d+ operations reachable$/)
  })

  it('fails when the engine cannot be reached', async () => {
    const report = await doctor(repo(), { engineRoot: join(tmpdir(), 'no-engine-here') })
    expect(report.ok).toBe(false)
    const engine = report.checks.find((c) => c.name === 'engine')
    expect(engine?.status).toBe('fail')
    expect(engine?.fix).toBeTruthy()
  })

  it('renders every check with a status token', async () => {
    const rendered = renderReport(await doctor(repo(), { engineRoot: REPO_ROOT }))
    expect(rendered).toMatch(/doctor/)
    expect(rendered).toMatch(/\[PASS\]/)
    expect(rendered).toMatch(/\[WARN\]/)
  })

  it('renders a fix hint under a failing row', async () => {
    const rendered = renderReport(await doctor(repo(false), { engineRoot: REPO_ROOT }))
    expect(rendered).toMatch(/fix:/)
  })
})
