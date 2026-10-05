#!/usr/bin/env node
// End-to-end proof that the MCP surface is real, over a real stdio transport.
//
// The unit tests in packages/mcp exercise the server in-process with a synthetic registry.
// That proves the protocol plumbing and nothing about *this* product. This script proves the
// opposite: it launches the shipped CLI as a subprocess, speaks real MCP to it with the real
// client, lists the real tool catalog, calls a tool that reaches the Python engine, and checks
// that a bad call comes back as an error envelope rather than a crash.
//
// It exits non-zero on the first failed expectation, so it can be a CI step.
//
//   node scripts/prove-mcp.mjs

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpClient } from '@biasledgerharness/mcp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'packages', 'cli', 'dist', 'bin.js')

const failures = []
let checks = 0

function check(label, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  [PASS] ${label}${detail === '' ? '' : `  ${detail}`}`)
  } else {
    console.log(`  [FAIL] ${label}${detail === '' ? '' : `  ${detail}`}`)
    failures.push(label)
  }
}

function section(title) {
  console.log('')
  console.log(title)
  console.log('-'.repeat(title.length))
}

async function main() {
  if (!existsSync(BIN)) {
    console.error(`prove-mcp — ${BIN} not found. Run "npm run build" first.`)
    process.exitCode = 1
    return
  }

  section('transport')
  console.log(`  spawning: node packages/cli/dist/bin.js mcp serve   (cwd: ${ROOT})`)
  const client = new McpClient()
  await client.connect({
    id: 'biasledger',
    command: process.execPath,
    args: [BIN, 'mcp', 'serve'],
    enabled: true,
    cwd: ROOT,
  })
  check('initialize + connect over stdio', true)

  section('tools/list')
  const tools = await client.listTools()
  check('the catalog is not empty', tools.length > 0, `${tools.length} tool(s)`)
  check('at least five tools, as the product contract requires', tools.length >= 5)
  for (const tool of tools) {
    console.log(`    ${tool.name.padEnd(22)} ${tool.description.slice(0, 68)}`)
  }
  const everyNameIsMcpSafe = tools.every((t) => /^[a-z][a-z0-9_]{0,63}$/.test(t.name))
  check('every tool name is MCP-safe', everyNameIsMcpSafe)
  check(
    'every tool has an object input schema',
    tools.every((t) => t.inputSchema?.type === 'object'),
  )
  check(
    'every tool description is written for a model',
    tools.every((t) => t.description.length > 40),
  )

  section('tools/call — reaching the Python engine')
  const lifecycle = await client.callTool('claim_lifecycle', {})
  check(
    'claim_lifecycle returned the five states',
    Array.isArray(lifecycle?.states) && lifecycle.states.length === 5,
    JSON.stringify(lifecycle?.states),
  )
  check(
    'attested is a gated transition',
    typeof lifecycle?.gates?.attested === 'string',
    lifecycle?.gates?.attested,
  )

  const evidence = await client.callTool('list_evidence', {})
  check(
    'list_evidence found the shipped corpus',
    Array.isArray(evidence?.docs) && evidence.docs.length > 0,
    `${evidence?.docs?.length ?? 0} document(s)`,
  )
  check(
    'every document carries a 40-character git blob id',
    (evidence?.docs ?? []).every((d) => /^[0-9a-f]{40}$/.test(d.blob)),
  )

  const index = await client.callTool('evidence_index', { resume: true })
  check(
    'evidence_index reached the engine and returned a sha256 root',
    /^[0-9a-f]{64}$/.test(index?.root ?? ''),
    index?.root,
  )
  check('evidence_index reported real term counts', (index?.terms ?? 0) > 0, `${index?.terms} terms`)

  const verdict = await client.callTool('evidence_evaluate', { claimId: 'consent-withdrawal' })
  check(
    'evidence_evaluate resolved a real claim against the corpus',
    typeof verdict?.verdict === 'string',
    `${verdict?.verdict}, ${verdict?.citationsValid} valid / ${verdict?.citationsInvalid} invalid`,
  )
  check(
    'the stale citation was caught over MCP too',
    verdict?.citationsInvalid === 1 && verdict?.spans?.some((s) => s.reason === 'text-mismatch'),
  )

  section('tools/call — the gated transition, refused')
  // A refusal is a *result*, not a tool failure: the engine decided, and the agent needs the
  // reason. So this asserts on the returned decision rather than on a thrown error.
  const refused = await client.callTool('claim_move', {
    claimId: 'pain-score-imputation',
    to: 'attested',
  })
  check(
    'an unsupported attestation is refused, not applied',
    refused?.applied === false,
    `applied=${refused?.applied}`,
  )
  check(
    'the refusal names the reason and the legal targets',
    typeof refused?.decision?.reason === 'string' &&
      refused.decision.reason.includes('not a legal transition') &&
      Array.isArray(refused.decision.legal),
    refused?.decision?.reason,
  )
  check(
    'the claim is returned unchanged',
    refused?.claim?.state === 'unverified',
    `state=${refused?.claim?.state}`,
  )

  // And a move the evidence forbids, from a state that *could* reach attested.
  const forbidden = await client.callTool('claim_move', {
    claimId: 'consent-withdrawal',
    to: 'attested',
  })
  check(
    'a claim whose verdict is partial cannot be attested',
    forbidden?.applied === false && /not 'attestable'/.test(forbidden?.decision?.reason ?? ''),
    forbidden?.decision?.reason,
  )

  section('tools/call — the error envelope')
  let missing = null
  try {
    await client.callTool('evidence_evaluate', { claimId: 'no-such-claim' })
  } catch (cause) {
    missing = cause
  }
  check(
    'an unknown claim returns NOT_FOUND, not a crash',
    missing !== null && /NOT_FOUND/.test(String(missing.message)),
    missing ? String(missing.message).slice(0, 90) : 'no error was raised',
  )

  await client.close()
  check('the transport closed cleanly', true)

  console.log('')
  console.log('-'.repeat(60))
  if (failures.length > 0) {
    console.log(`  prove-mcp FAILED — ${failures.length} of ${checks} checks failed:`)
    for (const failure of failures) console.log(`    ${failure}`)
    process.exitCode = 1
  } else {
    console.log(`  prove-mcp PASSED — ${checks}/${checks} checks, over real stdio MCP`)
  }
  console.log('-'.repeat(60))
}

main().catch((error) => {
  console.error('')
  console.error('prove-mcp FAILED — the transport itself threw:')
  console.error(error)
  process.exitCode = 1
})
