import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalog } from '@biasledgerharness/skills'
import { buildRegistry as buildPluginRegistry } from '@biasledgerharness/plugins'

export type Status = 'ok' | 'warn' | 'fail'

export interface Check {
  readonly name: string
  readonly status: Status
  readonly detail: string
  readonly fix?: string
}

export interface DoctorReport {
  readonly ok: boolean
  readonly checks: readonly Check[]
}

const pkg = { name: 'biasledger-harness', version: '0.1.0' }

export interface DoctorOptions {
  /**
   * Where the Python engine lives. Defaults to `cwd`, which is correct for a real checkout
   * and is only overridden by tests that build a synthetic tree for the other probes.
   */
  readonly engineRoot?: string
}

/**
 * The flagship command. An agent that mutates its own configuration must be able to
 * diagnose itself, and every failing row carries a fix hint rather than only a status.
 */
export async function doctor(cwd = process.cwd(), options: DoctorOptions = {}): Promise<DoctorReport> {
  const checks: Check[] = []

  const nodeMajor = Number(process.versions.node.split('.')[0])
  checks.push(
    nodeMajor >= 22
      ? { name: 'node', status: 'ok', detail: `v${process.versions.node}` }
      : {
          name: 'node',
          status: 'fail',
          detail: `v${process.versions.node} is below the required v22.12.0`,
          fix: 'install Node 22.12 or newer (see .nvmrc)',
        },
  )

  checks.push({
    name: 'package',
    status: 'ok',
    detail: `${pkg.name}@${pkg.version}`,
  })

  const skills = loadCatalog(join(cwd, 'skills'))
  checks.push(
    skills.issues.length === 0
      ? { name: 'skills', status: 'ok', detail: `${skills.skills.length} skills, 0 invalid` }
      : {
          name: 'skills',
          status: 'fail',
          detail: `${skills.skills.length} valid, ${skills.issues.length} invalid`,
          fix: skills.issues[0] ?? 'see npm run check:skill-version',
        },
  )

  const plugins = buildPluginRegistry(join(cwd, 'plugins'))
  checks.push(
    plugins.rejected.length === 0
      ? {
          name: 'plugins',
          status: 'ok',
          detail: `${plugins.active.length} active, ${plugins.disabled.length} disabled`,
        }
      : {
          name: 'plugins',
          status: 'warn',
          detail: `${plugins.rejected.length} rejected`,
          fix: plugins.rejected[0]?.issues[0] ?? 'inspect plugins/*/plugin.json',
        },
  )

  const configPath = join(cwd, 'product.config.json')
  checks.push(
    existsSync(configPath)
      ? { name: 'config', status: 'ok', detail: 'product.config.json found' }
      : {
          name: 'config',
          status: 'warn',
          detail: 'no product.config.json — using defaults',
          fix: 'run with defaults, or create product.config.json',
        },
  )

  checks.push(...(await probeEngine(options.engineRoot ?? cwd)))
  checks.push(...(await probeCorpus(cwd)))
  checks.push(...(await probeIndex(cwd, options.engineRoot ?? cwd)))

  return { ok: checks.every((c) => c.status !== 'fail'), checks }
}

/**
 * The Python engine must actually answer. Probing it is the only way to know the bridge is
 * wired, the interpreter is present, and the module is importable — three separate ways for
 * the product's credibility to be missing.
 */
async function probeEngine(cwd: string): Promise<Check[]> {
  try {
    const { callEngine } = await import('./audit.js')
    const lifecycle = (await callEngine('lifecycle', {}, cwd)) as { states?: string[] }
    const operations = (await callEngine('operations', {}, cwd)) as {
      count?: number
      operations?: string[]
    }
    const states = lifecycle.states?.length ?? 0
    const ops = operations.count ?? 0
    const reachable = states > 0 && ops > 0
    return [
      {
        name: 'engine',
        status: reachable ? 'ok' : 'fail',
        detail: `${states} lifecycle states, ${ops} operations reachable`,
        ...(reachable ? {} : { fix: 'run: python -m pytest services/engine -q' }),
      },
    ]
  } catch (cause) {
    return [
      {
        name: 'engine',
        status: 'fail',
        detail: `the deterministic engine did not answer — ${cause instanceof Error ? cause.message : String(cause)}`,
        fix: 'from the repo root: python -c "import biasledger_harness" with PYTHONPATH=services/engine/src',
      },
    ]
  }
}

/** The corpus is the product's input. An empty or missing one is a configuration problem. */
async function probeCorpus(cwd: string): Promise<Check[]> {
  const { readEvidence, readClaims } = await import('./repository.js')
  try {
    const docs = readEvidence(cwd)
    const claims = readClaims(cwd)
    return [
      {
        name: 'evidence',
        status: docs.length > 0 ? 'ok' : 'fail',
        detail: `${docs.length} artifact(s), ${Buffer.byteLength(docs.map((d) => d.text).join(''))} bytes indexed`,
        ...(docs.length > 0 ? {} : { fix: 'add at least one file to audit/evidence/*.md' }),
      },
      {
        name: 'claims',
        status: claims.length > 0 ? 'ok' : 'warn',
        detail: `${claims.length} claim record(s)`,
        ...(claims.length > 0 ? {} : { fix: 'add audit/claims/<id>.json, or run: biasledger init' }),
      },
    ]
  } catch (cause) {
    return [
      {
        name: 'evidence',
        status: 'fail',
        detail: cause instanceof Error ? cause.message : String(cause),
        fix: 'create audit/evidence/ with one markdown artifact per evidence document',
      },
    ]
  }
}

/** The committed index is the attestation. Report whether it still verifies. */
async function probeIndex(cwd: string, engineRoot: string): Promise<Check[]> {
  const { readManifest } = await import('./repository.js')
  const stored = readManifest(cwd)
  if (stored === undefined) {
    return [
      {
        name: 'index',
        status: 'warn',
        detail: 'no committed index — the Merkle root has not been published yet',
        fix: 'run: biasledger index --write',
      },
    ]
  }
  try {
    const { callEngine } = await import('./audit.js')
    const reduced = (await callEngine(
      'reduce_manifest',
      { manifest: stored.engineManifest },
      engineRoot,
    )) as { consistent: boolean | null; root: string }
    return [
      {
        name: 'index',
        status: reduced.consistent === true ? 'ok' : 'fail',
        detail:
          reduced.consistent === true
            ? `root ${reduced.root.slice(0, 16)}… verifies offline`
            : `committed root does not match the manifest (${reduced.root.slice(0, 16)}…)`,
        ...(reduced.consistent === true
          ? {}
          : { fix: 'run: biasledger index --write (the manifest was edited by hand)' }),
      },
    ]
  } catch (cause) {
    return [
      {
        name: 'index',
        status: 'fail',
        detail: `could not verify the committed index — ${cause instanceof Error ? cause.message : String(cause)}`,
        fix: 'run: biasledger index --write',
      },
    ]
  }
}

export function renderReport(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((c) => c.name.length), 5)
  const icon = (status: Status): string => (status === 'ok' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL')
  const lines = report.checks.map((c) => {
    const head = `  [${icon(c.status)}] ${c.name.padEnd(width)}  ${c.detail}`
    return c.fix === undefined ? head : `${head}\n         fix: ${c.fix}`
  })
  return [
    `${pkg.name} doctor`,
    ...lines,
    '',
    report.ok ? 'all required checks passed' : 'one or more checks failed',
  ].join('\n')
}
