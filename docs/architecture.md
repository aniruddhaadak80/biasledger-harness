# Architecture

## The narrow waist

Every capability is a `Tool` registered in exactly one registry, reachable identically from the
CLI, the board, the web API, and the MCP server.

```ts
Tool {
  name: string
  description: string
  inputSchema: JSONSchema          // validated at the boundary, always
  outputSchema: JSONSchema
  handler: (input, ctx) => Promise<Output>
  permissions: Permission[]        // declared, not assumed
  surface: 'core' | 'plugin' | 'mcp'
}
```

Four rules keep the waist narrow:

1. Tools never import another package's internals — only its declared entry point.
2. Tools are stateless. State lives in the repository, or arrives in `ctx`.
3. Input is validated against `inputSchema` **before** the handler runs.
4. Every tool declares its permissions, and `doctor` checks the declaration against what the
   handler actually touches.

If a second abstraction is needed, it goes through the waist too. There is no parallel path — the
desktop shell's doctor window is the clearest example: it loads the web app's own `/health` route
rather than re-running probes, precisely so it cannot disagree with the CLI.

## Layers

| Package                  | Responsibility                                                 | Depends on I/O? |
| ------------------------ | -------------------------------------------------------------- | --------------- |
| `packages/core`          | types, the `Tool` interface, the registry, the claim domain    | **no**          |
| `packages/config`        | layered config with a zod schema as the single source of truth | no              |
| `packages/memory`        | SQLite cache: WAL, numbered migrations, FTS5                   | yes             |
| `packages/skills`        | `SKILL.md` discovery, YAML frontmatter, validation             | reads disk      |
| `packages/plugins`       | manifest loading, schema validation, priority conflicts        | reads disk      |
| `packages/channels`      | the `Channel` interface and its adapters                       | yes             |
| `packages/providers`     | model provider adapters behind one interface                   | yes             |
| `packages/engine-client` | typed bridge to the Python engine                              | spawns          |
| `packages/mcp`           | MCP server **and** client                                      | spawns / stdio  |
| `packages/cli`           | commander, the board, `doctor`, the audit pipeline             | yes             |
| `packages/sdk`           | the public SDK surface                                         | no              |
| `services/engine`        | the deterministic core                                         | **no**          |
| `apps/web`               | Next.js App Router, reads the committed corpus                 | reads disk      |
| `apps/desktop`           | Electron shell around the web build                            | yes             |

## The deterministic engine

`services/engine` is Python, called as a subprocess over JSON on stdin/stdout. There is no server,
no port, and no state that survives a call, so two concurrent invocations cannot interfere.

Three modules, all pure:

- **`index.py`** — byte-exact tokenizer, resumable inverted index, Merkle reduction.
- **`claims.py`** — span verification, coverage evaluation, the gated lifecycle.
- **`analysis.py`** — the operation registry the host dispatches through.

Hard constraints, and why:

- **No clock, no network, no randomness, no filesystem.** Time and entropy are injected. A
  probabilistic answer cannot be the root of a Merkle tree.
- **Byte spans, not line/column.** See [ADR 0004](adr/0004-byte-offsets-and-locale-encoding.md).
- **The transport decodes UTF-8 explicitly**, never with the platform locale.
- **The engine verifies blob ids** rather than trusting the host.

## The store

Git is the system of record; SQLite is a disposable cache. The full reasoning is in
[ADR 0005](adr/0005-git-as-system-of-record.md).

```
audit/evidence/*.md    artifacts — the exact bytes that get hashed
audit/claims/*.json    claim records: dimensions, citations, expected text, state
audit/index.json       derived: Merkle root, per-document blobs, per-claim verdicts
```

`audit/index.json` can be deleted and rebuilt to the same root. That is what `npm run cli -- root`
proves, offline, with no access to the documents.

## The footprint ladder

1. Extend an existing tool
2. Add a CLI command plus a skill
3. Add a service-gated tool with a `check_fn`
4. Add a plugin
5. Add an MCP server tool to the catalog
6. Add a new core tool — **last resort**

Every core tool is paid for in context on every request, forever; plugins are free. That asymmetry
is the entire reason for the ladder, and it is why adding to `packages/core` first is the most
common review comment.

In practice, step 4 is the right home for a new **fairness-dimension taxonomy**: onboarding a
regulated domain should not require touching core.

## Decisions

| ADR                                                  | Decision                                  |
| ---------------------------------------------------- | ----------------------------------------- |
| [0001](adr/0001-narrow-waist.md)                     | one registry, one `Tool` interface        |
| [0002](adr/0002-python-engine-boundary.md)           | the Python engine boundary                |
| [0003](adr/0003-web-app-self-contained.md)           | the web app has no workspace dependencies |
| [0004](adr/0004-byte-offsets-and-locale-encoding.md) | byte offsets, and a UTF-8 transport       |
| [0005](adr/0005-git-as-system-of-record.md)          | git is the record; SQLite is a cache      |
| [0006](adr/0006-attestation-as-gated-transition.md)  | attestation is a gated transition         |
