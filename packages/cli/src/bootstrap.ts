import { join } from 'node:path'
import {
  ToolRegistry,
  NotFoundError,
  ValidationError,
  type Tool,
  type ToolContext,
} from '@biasledgerharness/core'
import { buildRegistry } from '@biasledgerharness/plugins'
import { loadCatalog } from '@biasledgerharness/skills'
import type * as Audit from './audit.js'

export const ENGINE_MODULE = 'biasledger_harness'

/**
 * Builds the one registry every surface shares.
 *
 * Two families of tool live here. The five `engine_*` / `list_*` tools are the generic core:
 * they work on a fresh install so the MCP server is never a dead list. The `evidence_*` and
 * `claim_*` tools are the product: they read the git-backed audit corpus and answer questions
 * about it that no model can answer, because every one of them resolves byte ranges and hashes
 * rather than asking anything to be believed.
 *
 * Every name matches ^[a-z][a-z0-9_]*$ so it is directly exposable over MCP.
 */
export function buildToolRegistry(cwd = process.cwd()): ToolRegistry {
  const registry = new ToolRegistry()

  registry.register(
    {
      name: 'list_skills',
      description:
        'List the skill catalog with each skill name, version and description. Use this to discover what the agent can do before guessing a command.',
      inputSchema: {
        type: 'object',
        properties: {
          includeBodies: { type: 'boolean', description: 'Include each skill body.' },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          issues: { type: 'array', items: { type: 'string' } },
          skills: { type: 'array', items: { type: 'object' } },
        },
        required: ['count', 'issues', 'skills'],
      },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async (input: { includeBodies?: boolean }) => {
        const { skills, issues } = loadCatalog(join(cwd, 'skills'))
        return {
          count: skills.length,
          issues: [...issues],
          skills: skills.map((skill) => ({
            name: skill.name,
            version: skill.version,
            description: skill.description,
            ...(input.includeBodies === true ? { body: skill.body } : {}),
          })),
        }
      },
    } satisfies Tool<{ includeBodies?: boolean }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'list_plugins',
      description:
        'List the resolved plugin registry, including plugins that were shadowed, disabled or rejected and why. Use this to explain why an expected capability is missing.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: { type: 'object' },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async () => {
        const result = buildRegistry(join(cwd, 'plugins'))
        return {
          active: result.active.map((p) => ({
            name: p.manifest.name,
            version: p.manifest.version,
            capabilities: p.manifest.capabilities,
            shadowed: p.shadowed,
          })),
          disabled: result.disabled.map((p) => p.manifest.name),
          rejected: result.rejected.map((p) => ({ path: p.path, issues: p.issues })),
        }
      },
    } satisfies Tool<Record<string, never>, unknown>,
    { source: 'core' },
  )

  const runEngine = async (op: string, input: unknown): Promise<unknown> => {
    // One engine-call path for the whole product: the same function the CLI commands and the
    // web API use. A second bridge here would be a second place for the engine's contract to
    // drift away from.
    const { callEngine } = await import('./audit.js')
    return await callEngine(op, input, cwd)
  }

  const engineSchema = (properties: Record<string, unknown>, required: string[]) =>
    ({
      type: 'object',
      properties: { records: { type: 'array', items: { type: 'object' } }, ...properties },
      required: ['records', ...required],
      additionalProperties: false,
    }) as const

  const validateRecords = (input: unknown): unknown[] => {
    const records = (input as { records?: unknown }).records
    if (!Array.isArray(records)) {
      throw new ValidationError('"records" must be an array', { field: 'records' })
    }
    return records
  }

  registry.register(
    {
      name: 'engine_summarize',
      description:
        'Aggregate a set of records by kind and report the total and the newest/oldest timestamps. Deterministic: same records always give the same answer.',
      inputSchema: engineSchema({}, []),
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        validateRecords(input)
        return await runEngine('summarize', input)
      },
    } satisfies Tool<{ records: unknown[] }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'engine_diff',
      description:
        'Compute a minimal structural diff between two record sets, reporting added, removed, changed and unchanged identifiers. Use this instead of comparing JSON by eye.',
      inputSchema: {
        type: 'object',
        properties: {
          before: { type: 'array', items: { type: 'object' } },
          after: { type: 'array', items: { type: 'object' } },
        },
        required: ['before', 'after'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        if (!Array.isArray((input as { before?: unknown }).before)) {
          throw new ValidationError('"before" must be an array', { field: 'before' })
        }
        if (!Array.isArray((input as { after?: unknown }).after)) {
          throw new ValidationError('"after" must be an array', { field: 'after' })
        }
        return await runEngine('diff', input)
      },
    } satisfies Tool<{ before: unknown[]; after: unknown[] }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'engine_normalize',
      description:
        'Flatten records into a stable, sorted, comparable shape. Use this before diffing or storing so ordering never changes the result.',
      inputSchema: engineSchema({}, []),
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        validateRecords(input)
        return await runEngine('normalize', input)
      },
    } satisfies Tool<{ records: unknown[] }, unknown>,
    { source: 'core' },
  )

  registerProductTools(registry, cwd)
  return registry
}

/**
 * The product tools.
 *
 * Registered into the same registry as the generic core, so the MCP server, the CLI and the
 * web API all reach them the same way. Each one is deliberately stateless: it reads the
 * repository, hands the work to the deterministic engine, and returns a value. `claim_move` is
 * the only one that writes, and it writes a claim record through the engine-checked state
 * machine rather than by setting a field.
 */
export function registerProductTools(registry: ToolRegistry, cwd: string): ToolRegistry {
  const engineTools = async (): Promise<typeof Audit> => await import('./audit.js')

  registry.register(
    {
      name: 'list_evidence',
      description:
        'List the evidence corpus: one entry per artifact with its doc id, git blob id and byte length. Call this first to learn which documents exist before citing any of them.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          docs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                docId: { type: 'string' },
                blob: { type: 'string' },
                bytes: { type: 'number' },
              },
            },
          },
        },
        required: ['count', 'docs'],
      },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async () => {
        const { readEvidence } = await import('./repository.js')
        const docs = readEvidence(cwd).map((doc) => ({
          docId: doc.docId,
          blob: doc.blob,
          bytes: doc.bytes,
        }))
        return { count: docs.length, docs }
      },
    } satisfies Tool<Record<string, never>, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'evidence_index',
      description:
        'Build or resume the evidence index over the whole corpus and return its Merkle root. Pass resume=false to force a full rebuild. Two auditors who run this on the same bytes get the same root; that is the reproducibility check.',
      inputSchema: {
        type: 'object',
        properties: { resume: { type: 'boolean', description: 'Reuse unchanged documents. Default true.' } },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          root: { type: 'string' },
          terms: { type: 'number' },
          postings: { type: 'number' },
          reused: { type: 'number' },
          rebuilt: { type: 'number' },
          dropped: { type: 'array', items: { type: 'string' } },
        },
        required: ['root', 'terms', 'postings', 'reused', 'rebuilt', 'dropped'],
      },
      permissions: ['fs:read', 'proc:spawn'],
      surface: 'core',
      handler: async (input: { resume?: boolean }) => {
        const { buildIndex } = await engineTools()
        const { readEvidence, readManifest } = await import('./repository.js')
        const docs = readEvidence(cwd)
        const previous = input.resume === false ? undefined : readManifest(cwd)?.['engineManifest']
        const result = await buildIndex(docs, previous, cwd)
        return {
          root: result.root,
          terms: result.terms,
          postings: result.postings,
          reused: result.reused,
          rebuilt: result.rebuilt,
          dropped: [...result.dropped],
        }
      },
    } satisfies Tool<{ resume?: boolean }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'evidence_span',
      description:
        'Resolve one citation against the corpus: given a docId and a byte range, report whether those exact bytes exist, what they say, which line they fall on, and the sha256 of the span. Use this to check a citation before trusting it.',
      inputSchema: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          byteStart: { type: 'integer', minimum: 0 },
          byteEnd: { type: 'integer', minimum: 1 },
          expects: {
            type: 'string',
            description: 'Text the citation claims to say. If it is absent the citation has drifted.',
          },
        },
        required: ['docId', 'byteStart', 'byteEnd'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['fs:read', 'proc:spawn'],
      surface: 'core',
      handler: async (input: { docId: string; byteStart: number; byteEnd: number; expects?: string }) => {
        const { callEngine } = await engineTools()
        const { readEvidence } = await import('./repository.js')
        const doc = readEvidence(cwd).find((entry) => entry.docId === input.docId)
        if (doc === undefined) {
          throw new NotFoundError(`no evidence document "${input.docId}"`, {
            docId: input.docId,
            fix: 'call list_evidence to see the available documents',
          })
        }
        return await callEngine(
          'verify_span',
          {
            doc: { docId: doc.docId, blob: doc.blob, text: doc.text },
            byteStart: input.byteStart,
            byteEnd: input.byteEnd,
            ...(input.expects === undefined ? {} : { expects: input.expects }),
          },
          cwd,
        )
      },
    } satisfies Tool<{ docId: string; byteStart: number; byteEnd: number; expects?: string }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'evidence_evaluate',
      description:
        'Evaluate one fairness claim by id against the whole corpus. Returns which required dimensions are backed by resolvable citations, which are gaps, and the Merkle root of exactly the blobs the verdict rests on. This is a byte check, not a judgement about whether the evidence is persuasive.',
      inputSchema: {
        type: 'object',
        properties: { claimId: { type: 'string' } },
        required: ['claimId'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['fs:read', 'proc:spawn'],
      surface: 'core',
      handler: async (input: { claimId: string }) => {
        const { evaluateClaim } = await engineTools()
        const { readEvidence, readClaim } = await import('./repository.js')
        return await evaluateClaim(readClaim(input.claimId, cwd), readEvidence(cwd), cwd)
      },
    } satisfies Tool<{ claimId: string }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'claim_board',
      description:
        'Return every claim with its evaluated verdict, grouped by lifecycle state, plus the corpus it was judged against. Use this to answer "what is still unverified" or "which citations have rotted" without running the CLI.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: { type: 'object' },
      permissions: ['fs:read', 'proc:spawn'],
      surface: 'core',
      handler: async () => {
        const { loadAudit, summarise } = await engineTools()
        const { groupByState, CLAIM_STATES } = await import('@biasledgerharness/core')
        const audit = await loadAudit(cwd)
        const groups = groupByState(audit.evaluated)
        return {
          stats: summarise(audit.evaluated),
          commit: audit.commit ?? null,
          corpus: audit.docs.map((doc) => ({ docId: doc.docId, blob: doc.blob, bytes: doc.bytes })),
          states: CLAIM_STATES.map((state) => ({
            state,
            claims: groups[state].map((entry) => ({
              id: entry.claim.id,
              title: entry.claim.title,
              verdict: entry.verdict.verdict,
              coverage: entry.verdict.coverage,
              gaps: entry.verdict.gaps.map((gap) => gap.dimension),
              invalidCitations: entry.verdict.citationsInvalid,
              root: entry.verdict.root,
            })),
          })),
        }
      },
    } satisfies Tool<Record<string, never>, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'claim_move',
      description:
        'Move a claim to another lifecycle state. The engine refuses illegal moves, refuses attestation when the evidence does not back every required dimension, and refuses withdrawal without a reason. Returns the decision and, when it was applied, the claim as it now stands.',
      inputSchema: {
        type: 'object',
        properties: {
          claimId: { type: 'string' },
          to: {
            type: 'string',
            enum: ['unverified', 'evidenced', 'challenged', 'attested', 'withdrawn'],
          },
          note: { type: 'string', description: 'Required when withdrawing.' },
        },
        required: ['claimId', 'to'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['fs:read', 'fs:write', 'proc:spawn'],
      surface: 'core',
      handler: async (input: { claimId: string; to: string; note?: string }) => {
        const { moveClaim } = await import('./audit.js')
        const { writeClaim, readClaim } = await import('./repository.js')
        const { isClaimState } = await import('@biasledgerharness/core')
        if (!isClaimState(input.to)) {
          throw new ValidationError(`"to" must be a lifecycle state`, { received: input.to })
        }
        const result = await moveClaim(readClaim(input.claimId, cwd), input.to, {
          ...(input.note === undefined ? {} : { note: input.note }),
          cwd,
        })
        if (result.applied) writeClaim(result.claim, cwd)
        return {
          applied: result.applied,
          from: result.claim.state,
          decision: result.decision,
          claim: result.claim,
        }
      },
    } satisfies Tool<{ claimId: string; to: string; note?: string }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'claim_lifecycle',
      description:
        'Return the claim lifecycle as data: the five states, every legal transition between them, and which transitions are gated on a condition. Use this instead of assuming a state machine.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async () => {
        const { callEngine } = await engineTools()
        return await callEngine('lifecycle', {}, cwd)
      },
    } satisfies Tool<Record<string, never>, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'list_dimension_sets',
      description:
        'List the fairness-dimension taxonomies declared by installed plugins: for each domain, the dimensions a claim must cover before it can be attested, and the rationale for each. Use this before writing a claim so its dimensions follow a policy rather than being invented.',
      inputSchema: {
        type: 'object',
        properties: { domain: { type: 'string', description: 'Filter to one taxonomy id.' } },
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async (input: { domain?: string }) => {
        const { buildRegistry } = await import('@biasledgerharness/plugins')
        const registry = buildRegistry(join(cwd, 'plugins'))
        const sets = registry.active
          .map((plugin) => ({
            id: plugin.manifest.name,
            version: plugin.manifest.version,
            description: plugin.manifest.description,
            required: plugin.manifest.dimensions.filter((d) => d.required).map((d) => d.key),
            advisory: plugin.manifest.dimensions.filter((d) => !d.required).map((d) => d.key),
            dimensions: plugin.manifest.dimensions,
          }))
          .filter((set) => input.domain === undefined || set.id === input.domain)
        return {
          count: sets.length,
          sets,
          rejected: registry.rejected.map((entry) => ({ path: entry.path, issues: entry.issues })),
        }
      },
    } satisfies Tool<{ domain?: string }, unknown>,
    { source: 'core' },
  )

  return registry
}

/** A minimal, dependency-free logger for the tool context. */
export function createContext(requestId = 'cli'): ToolContext {
  return {
    requestId,
    now: () => Date.now(),
    log: (level, message, fields) => {
      process.stderr.write(`${JSON.stringify({ level, message, requestId, ...fields })}\n`)
    },
    dataDir: process.env.PRODUCT_DATA_DIR ?? '.data',
  }
}
