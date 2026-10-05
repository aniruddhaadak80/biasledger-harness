import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The product's identity and its surface manifest, in one typed place.
 *
 * The web UI and the health endpoint both read from here so a value is never stated twice, and
 * the version comes from the real root manifest rather than a constant.
 */

export interface Surface {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly status: 'shipped' | 'omitted'
  /** Only for omitted surfaces: why. An omission without a reason is an oversight. */
  readonly reason?: string
  readonly entrypoint?: string
}

export const PRODUCT = {
  name: 'biasledger-harness',
  slug: 'biasledger-harness',
  version: '0.1.0',
  tagline:
    'Turn AI fairness claims into a git-backed evidence index, then prove byte-exactly which ones still hold.',
} as const

export const SURFACES: readonly Surface[] = [
  {
    id: 'cli',
    title: 'CLI — the primary interface',
    summary:
      'The claim board is the landing view, with a span-lineage strip per card. No arguments needed; typing nothing shows the board.',
    status: 'shipped',
    entrypoint: 'biasledger',
  },
  {
    id: 'web',
    title: 'Web',
    summary:
      'This app. Server-rendered from the committed corpus on every request, so the first paint already contains the real claims and the real Merkle root.',
    status: 'shipped',
    entrypoint: '/',
  },
  {
    id: 'mcp-server',
    title: 'MCP server',
    summary:
      'Speaks MCP over stdio and exposes the whole registry, so any agent can read the board, evaluate a claim and attempt a lifecycle move through the same gate.',
    status: 'shipped',
    entrypoint: 'biasledger mcp serve',
  },
  {
    id: 'mcp-client',
    title: 'MCP client',
    summary:
      'Connects to a server over stdio, lists its tools and calls one. Used to prove this server is not merely declared to work.',
    status: 'shipped',
    entrypoint: '@biasledgerharness/mcp',
  },
  {
    id: 'skills',
    title: 'Skills catalog',
    summary:
      'Five skills loaded from disk with frontmatter validation: citing evidence without guessing a byte offset, running an audit, and moving a claim.',
    status: 'shipped',
    entrypoint: 'biasledger skills',
  },
  {
    id: 'plugins',
    title: 'Plugin registry',
    summary:
      'Plugins declare a fairness-dimension taxonomy — the dimensions a claim of that domain must cover before it can be attested, with a rationale each. Onboarding a new regulated domain does not touch core.',
    status: 'shipped',
    entrypoint: 'biasledger plugins',
  },
  {
    id: 'engine',
    title: 'Deterministic engine (Python)',
    summary:
      'Tokenizer, resumable inverted index, Merkle reduction, span verification and the gated claim lifecycle. Pure functions over JSON on stdin/stdout. Nothing here may be a model call.',
    status: 'shipped',
    entrypoint: 'python -m biasledger_harness',
  },
  {
    id: 'desktop',
    title: 'Desktop',
    summary:
      'An Electron shell that loads this web build and adds a native menu, a tray and single-instance locking. It does not reimplement the UI.',
    status: 'shipped',
    entrypoint: 'apps/desktop',
  },
  {
    id: 'channels',
    title: 'Channels',
    summary:
      'Deliberately omitted. This is a local-first instrument over a git repository you already own; a messaging adapter would be a strictly worse way to read a claim board, and it would add an unaudited network egress path to a product whose entire pitch is auditability.',
    status: 'omitted',
    reason: 'local-first product with no remote surface',
  },
  {
    id: 'providers',
    title: 'Model providers',
    summary:
      'Deliberately not wired into the decision path. A provider may summarise a finding for a human, but nothing that decides support may route through one.',
    status: 'omitted',
    reason: 'the product claims no model was asked; a provider in the decision path would void it',
  },
]

function packageVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), '..', '..', 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version ?? '0.0.0'
  } catch {
    return PRODUCT.version
  }
}

export function resolveVersion(): string {
  return packageVersion()
}
