import { Command } from 'commander'
import { buildToolRegistry, createContext } from './bootstrap.js'
import { doctor, renderReport } from './doctor.js'
import { loadCatalog } from '@biasledgerharness/skills'
import { buildRegistry as buildPluginRegistry } from '@biasledgerharness/plugins'

const VERSION = '0.1.0'

/** Exit codes are part of the contract: 0 ok, 1 runtime failure, 2 usage error. */
function fail(message: string): void {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

function emit(value: unknown, json: boolean, render: () => string): void {
  process.stdout.write(json ? `${JSON.stringify(value ?? null, null, 2)}\n` : `${render()}\n`)
}

export function buildProgram(): Command {
  const program = new Command()

  program
    .name('biasledger')
    .description(
      'biasledger-harness — turn AI fairness claims into a git-backed evidence index, then prove byte-exactly which ones still hold.',
    )
    .version(VERSION, '-v, --version', 'print the version')
    .exitOverride((error) => {
      process.exitCode = error.exitCode === 0 ? 0 : 2
      throw error
    })

  // The board is the landing view: this is a TUI-first product, and typing nothing shows it.
  program
    .command('board', { isDefault: true })
    .description('render the claim board with the span-lineage strip for every claim')
    .option('--json', 'machine-readable output')
    .option('--width <columns>', 'board width', (value: string) => Number.parseInt(value, 10))
    .action(async (options: { json?: boolean; width?: number }) => {
      const { loadAudit, summarise } = await import('./audit.js')
      const { renderBoard } = await import('./board.js')
      const audit = await loadAudit()
      const corpus = audit.docs.map((doc) => ({ docId: doc.docId, bytes: doc.bytes }))
      if (options.json === true) {
        emit(
          { stats: summarise(audit.evaluated), commit: audit.commit ?? null, claims: audit.evaluated },
          true,
          () => '',
        )
        return
      }
      process.stdout.write(
        `${renderBoard({
          evaluated: audit.evaluated,
          corpus,
          ...(audit.commit === undefined ? {} : { commit: audit.commit }),
          ...(options.width === undefined ? {} : { width: options.width }),
        })}\n`,
      )
    })

  program
    .command('doctor')
    .description('diagnose every subsystem and print an actionable report')
    .option('--json', 'machine-readable output')
    .action(async () => {
      const report = await doctor()
      process.stdout.write(
        process.argv.includes('--json')
          ? `${JSON.stringify(report, null, 2)}\n`
          : `${renderReport(report)}\n`,
      )
      if (!report.ok) process.exitCode = 1
    })

  program
    .command('tools')
    .description('list the registered tools — the authoritative capability list')
    .option('--json', 'machine-readable output')
    .action(() => {
      const registry = buildToolRegistry()
      const tools = registry.list().map((tool) => ({
        name: tool.name,
        description: tool.description,
        surface: registry.surfaceOf(tool.name),
        source: registry.sourceOf(tool.name),
        permissions: tool.permissions,
        inputSchema: tool.inputSchema,
      }))
      if (process.argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify(tools, null, 2)}\n`)
        return
      }
      const width = Math.max(...tools.map((t) => t.name.length), 4)
      for (const tool of tools) {
        process.stdout.write(`  ${tool.name.padEnd(width)}  [${tool.surface}]  ${tool.description}\n`)
      }
    })

  program
    .command('claims')
    .description('list every claim with its verdict and coverage')
    .option('--json', 'machine-readable output')
    .action(async (options: { json?: boolean }) => {
      const { loadAudit, movesFor } = await import('./audit.js')
      const audit = await loadAudit()
      if (options.json === true) {
        emit(audit.evaluated, true, () => '')
        return
      }
      const width = Math.max(...audit.evaluated.map((e) => e.claim.id.length), 6)
      for (const entry of audit.evaluated) {
        const { claim, verdict } = entry
        const gaps = verdict.gaps.length > 0 ? `  gaps: ${verdict.gaps.length}` : ''
        const broken = verdict.citationsInvalid > 0 ? `  broken: ${verdict.citationsInvalid}` : ''
        process.stdout.write(
          `  ${claim.id.padEnd(width)}  ${claim.state.padEnd(11)}  ${verdict.verdict.padEnd(16)}` +
            `${verdict.dimensionsCovered}/${verdict.dimensionsRequired}${gaps}${broken}\n` +
            `  ${' '.repeat(width)}  -> ${movesFor(entry).join(', ') || '(terminal)'}\n`,
        )
      }
    })

  program
    .command('show')
    .description('show one claim with every citation and its verdict')
    .argument('<claimId>', 'claim id')
    .option('--json', 'machine-readable output')
    .action(async (claimId: string, options: { json?: boolean }) => {
      const { loadAudit } = await import('./audit.js')
      const { shortBlob } = await import('./repository.js')
      const audit = await loadAudit()
      const entry = audit.evaluated.find((e) => e.claim.id === claimId)
      if (entry === undefined) {
        fail(`error: no claim "${claimId}" — run "biasledger claims" to list them`)
        return
      }
      const { claim, verdict } = entry
      if (options.json === true) {
        emit(entry, true, () => '')
        return
      }
      const lines = [
        `${claim.id}  [${claim.state}]`,
        `  ${claim.title}`,
        `  system   ${claim.system}`,
        `  verdict  ${verdict.verdict}  (${verdict.coverage} coverage, ` +
          `${verdict.dimensionsCovered}/${verdict.dimensionsRequired} required dimensions)`,
        `  citations ${verdict.citationsValid} valid, ${verdict.citationsInvalid} invalid`,
        `  root     ${verdict.root}`,
        `  attested over ${verdict.attestedOver.join(', ') || '(nothing)'}`,
        claim.note === '' ? '' : `  note     ${claim.note}`,
      ]
      for (const span of verdict.spans) {
        const flag = span.valid ? 'ok  ' : 'FAIL'
        lines.push(
          `    [${flag}] ${span.dimension}  ${span.docId}:${span.byteStart}-${span.byteEnd} ` +
            `(line ${span.line}, blob ${shortBlob(span.blob)})  ${span.reason}`,
        )
        lines.push(`           "${span.text.slice(0, 96).replace(/\n/g, ' ')}"`)
      }
      if (verdict.gaps.length > 0) {
        lines.push('  gaps:')
        for (const gap of verdict.gaps) lines.push(`    ${gap.dimension}: ${gap.reason}`)
      }
      process.stdout.write(`${lines.filter((l) => l !== '').join('\n')}\n`)
    })

  program
    .command('index')
    .description('build or resume the evidence index and print its Merkle root')
    .option('--no-resume', 'force a full rebuild instead of reusing unchanged documents')
    .option('--write', 'write audit/index.json so the next run can resume')
    .option('--json', 'machine-readable output')
    .action(async (options: { resume: boolean; write?: boolean; json?: boolean }) => {
      const { buildIndex, evaluateClaim } = await import('./audit.js')
      const { readEvidence, readManifest, readClaims, writeManifest, headCommit, auditPaths } =
        await import('./repository.js')
      const docs = readEvidence()
      const stored = readManifest()
      const result = await buildIndex(docs, options.resume ? stored?.engineManifest : undefined)
      let written: string | undefined
      if (options.write === true) {
        const commit = headCommit()
        // The committed index is the whole audit record: the Merkle root, the per-document
        // state needed to recompute it offline, and a summary verdict per claim. That last
        // part is what makes the file a golden fixture rather than a cache.
        const claims: Record<string, unknown> = {}
        for (const claim of readClaims()) {
          const verdict = await evaluateClaim(claim, docs)
          // The whole verdict, spans included. A reduced summary would be smaller, but the
          // spans *are* the evidence — the board draws its lineage strip from them, and an
          // audit record that omits them cannot answer "which bytes".
          claims[claim.id] = { ...verdict, state: claim.state }
        }
        writeManifest(
          {
            version: 1,
            root: result.root,
            docs: Object.fromEntries(docs.map((d) => [d.docId, { blob: d.blob, bytes: d.bytes }])),
            claims,
            engineManifest: result.manifest,
            generatedFrom: docs.map((d) => d.docId),
            ...(commit === undefined ? {} : { commit }),
          },
          undefined,
        )
        written = auditPaths().index
      }
      if (options.json === true) {
        emit({ ...result, manifest: undefined, written: written ?? null }, true, () => '')
        return
      }
      process.stdout.write(
        `  root       ${result.root}\n` +
          `  terms      ${result.terms}\n` +
          `  postings   ${result.postings}\n` +
          `  reused     ${result.reused}\n` +
          `  rebuilt    ${result.rebuilt}\n` +
          `  dropped    ${result.dropped.length === 0 ? '(none)' : result.dropped.join(', ')}\n` +
          `  written    ${written ?? '(not written — pass --write)'}\n`,
      )
    })

  program
    .command('root')
    .description(
      'verify the committed index: recompute its root offline and check the corpus has not drifted',
    )
    .option('--json', 'machine-readable output')
    .action(async (options: { json?: boolean }) => {
      const { callEngine } = await import('./audit.js')
      const { readManifest, readEvidence } = await import('./repository.js')
      const stored = readManifest()
      if (stored === undefined) {
        fail('error: no audit/index.json — run "biasledger index --write" first')
        process.exitCode = 1
        return
      }

      // Recomputed from the committed manifest alone: no corpus, no rebuild. This is what a
      // third party can run to check the claim is not a promise.
      const reduced = await callEngine<{
        root: string
        claimedRoot: string | null
        consistent: boolean | null
        terms: number
        docs: string[]
      }>('reduce_manifest', { manifest: stored.engineManifest })

      // Then the other half: has the corpus moved since the index was written?
      const drifted: string[] = []
      for (const doc of readEvidence()) {
        const recorded = stored.docs[doc.docId]
        if (recorded === undefined) drifted.push(`${doc.docId} (not in the index)`)
        else if (recorded.blob !== doc.blob) drifted.push(`${doc.docId} (blob changed)`)
      }

      const ok = reduced.consistent === true && drifted.length === 0
      if (options.json === true) {
        emit({ ok, ...reduced, drifted }, true, () => '')
      } else {
        process.stdout.write(
          `  committed   ${stored.root}\n` +
            `  recomputed  ${reduced.root}\n` +
            `  consistent  ${reduced.consistent === true ? 'yes' : 'NO — the manifest was edited'}\n` +
            `  terms       ${reduced.terms}\n` +
            `  drifted     ${drifted.length === 0 ? '(none)' : drifted.join(', ')}\n`,
        )
      }
      if (!ok) process.exitCode = 1
    })

  program
    .command('cite')
    .description('find the byte range of a phrase so a citation is measured, not guessed')
    .argument('<docId>', 'evidence document id')
    .argument('<phrase>', 'exact phrase to locate')
    .option('--json', 'machine-readable output')
    .action(async (docId: string, phrase: string, options: { json?: boolean }) => {
      const { locate } = await import('./audit.js')
      const { readEvidence } = await import('./repository.js')
      const doc = readEvidence().find((entry) => entry.docId === docId)
      if (doc === undefined) {
        fail(`error: no evidence document "${docId}"`)
        return
      }
      const probe = await locate(doc, phrase)
      if (options.json === true) {
        emit(probe, true, () => '')
        return
      }
      process.stdout.write(
        `  ${docId}  bytes ${probe.byteStart}-${probe.byteEnd}  line ${probe.line}\n` +
          `  blob  ${probe.blob}\n` +
          `  citation: {"docId":"${docId}","byteStart":${probe.byteStart},` +
          `"byteEnd":${probe.byteEnd}}\n`,
      )
    })

  program
    .command('move')
    .description('move a claim through the lifecycle; the engine refuses anything the evidence forbids')
    .argument('<claimId>', 'claim id')
    .argument('<to>', 'unverified | evidenced | challenged | attested | withdrawn')
    .option('--note <note>', 'required when withdrawing')
    .option('--json', 'machine-readable output')
    .action(async (claimId: string, to: string, options: { note?: string; json?: boolean }) => {
      const { moveClaim } = await import('./audit.js')
      const { writeClaim, readClaim } = await import('./repository.js')
      const { isClaimState } = await import('@biasledgerharness/core')
      if (!isClaimState(to)) {
        fail(`error: "${to}" is not a lifecycle state`)
        process.exitCode = 2
        return
      }
      try {
        const result = await moveClaim(readClaim(claimId), to, {
          ...(options.note === undefined ? {} : { note: options.note }),
        })
        if (options.json === true) {
          emit(result, true, () => '')
        } else if (result.applied) {
          process.stdout.write(`  ${claimId}: ${result.decision.fromState} -> ${to}\n`)
          writeClaim(result.claim)
        } else {
          process.stderr.write(`  refused: ${result.decision.reason}\n`)
        }
        if (!result.applied) process.exitCode = 1
      } catch (cause) {
        fail(`error: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    })

  program
    .command('skills')
    .description('list the skill catalog loaded from disk')
    .option('--json', 'machine-readable output')
    .action((options: { json?: boolean }) => {
      const { skills, issues } = loadCatalog('skills')
      if (options.json === true) {
        emit({ count: skills.length, issues, skills }, true, () => '')
        return
      }
      const width = Math.max(...skills.map((s) => s.name.length), 5)
      for (const skill of skills) {
        process.stdout.write(
          `  ${skill.name.padEnd(width)}  ${skill.version.padEnd(8)}  ${skill.description}\n`,
        )
      }
      for (const issue of issues) process.stderr.write(`  issue: ${issue}\n`)
    })

  program
    .command('plugins')
    .description('list the resolved plugin registry and why anything was rejected')
    .option('--json', 'machine-readable output')
    .action((options: { json?: boolean }) => {
      const registry = buildPluginRegistry('plugins')
      if (options.json === true) {
        emit(registry, true, () => '')
        return
      }
      for (const plugin of registry.active) {
        process.stdout.write(
          `  ${plugin.manifest.name.padEnd(20)}  v${plugin.manifest.version}  ` +
            `[${plugin.manifest.capabilities.join(', ')}]\n`,
        )
      }
      for (const rejected of registry.rejected) {
        process.stderr.write(`  rejected ${rejected.path}: ${rejected.issues.join('; ')}\n`)
      }
    })

  const mcp = program.command('mcp').description('Model Context Protocol commands')

  mcp
    .command('serve')
    .description('run the MCP server over stdio')
    .action(async () => {
      const { serveStdio } = await import('@biasledgerharness/mcp')
      const registry = buildToolRegistry()
      // stdout belongs to the protocol from here on; diagnostics must go to stderr.
      await serveStdio(registry, createContext('mcp'))
    })

  mcp
    .command('call')
    .description('invoke one tool directly, without MCP')
    .argument('<tool>', 'tool name')
    .argument('<input>', 'JSON input document')
    .action(async (tool: string, raw: string) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (cause) {
        process.stderr.write(`error: input is not valid JSON — ${String(cause)}\n`)
        process.exitCode = 2
        return
      }
      const registry = buildToolRegistry()
      try {
        const value = await registry.invoke(tool, parsed, createContext('cli'), [
          'fs:read',
          'fs:write',
          'net:fetch',
          'proc:spawn',
        ])
        process.stdout.write(`${JSON.stringify(value ?? null, null, 2)}\n`)
      } catch (cause) {
        const code = (cause as { code?: string }).code ?? 'INTERNAL'
        process.stderr.write(`${code}: ${cause instanceof Error ? cause.message : String(cause)}\n`)
        process.exitCode = 1
      }
    })

  program
    .command('version')
    .description('print version and runtime information as JSON')
    .action(() => {
      process.stdout.write(
        `${JSON.stringify(
          {
            name: 'biasledger-harness',
            version: VERSION,
            node: process.versions.node,
            platform: process.platform,
            tools: buildToolRegistry().size,
          },
          null,
          2,
        )}\n`,
      )
    })

  return program
}
