# MCP

biasledger-harness is an MCP **server**, which makes it a tool provider for other agents. It also
ships an MCP **client**, which is how the server gets verified rather than merely declared.

---

## The server

```bash
npm run cli -- mcp serve
```

Speaks MCP over stdio. From the moment this runs, **stdout belongs to the protocol** — all
diagnostics go to stderr, which is why `createContext` logs there.

Configure an agent:

```json
{
  "mcpServers": {
    "biasledger": {
      "command": "node",
      "args": ["/absolute/path/to/biasledger-harness/packages/cli/dist/bin.js", "mcp", "serve"],
      "cwd": "/absolute/path/to/biasledger-harness"
    }
  }
}
```

`cwd` matters. The server reads the audit corpus from its working directory, so without it every
citation resolves to `unknown-document`.

---

## Proving it works

```bash
npm run mcp:proof
```

This is the script that launches the built CLI as a subprocess, speaks real MCP to it with the real
client, and asserts 20 things — including `initialize`, the full tool list, a `tools/call` that
reaches the Python engine, a refused lifecycle transition, and an error envelope. Paste its output
in a PR rather than claiming the surface works.

---

## The tools

Thirteen, all backed by `packages/core`. MCP is a transport here, never a second implementation.

### Reading the evidence

| Tool                | What it does                                                                  |
| ------------------- | ----------------------------------------------------------------------------- |
| `list_evidence`     | the corpus: doc id, git blob id, byte length                                  |
| `evidence_span`     | resolve one citation — does the byte range exist, what does it say, what line |
| `evidence_index`    | build or resume the index; return the Merkle root                             |
| `evidence_evaluate` | evaluate one claim against the corpus: coverage, gaps, attestation root       |

`evidence_index` and `evidence_evaluate` spawn the Python engine, which is why they declare
`proc:spawn`.

### The lifecycle

| Tool                  | What it does                                                       |
| --------------------- | ------------------------------------------------------------------ |
| `claim_board`         | every claim with its verdict, grouped by state, plus the corpus    |
| `claim_lifecycle`     | the five states, every legal transition, and which are gated       |
| `claim_move`          | attempt a transition; the engine refuses what the evidence forbids |
| `list_dimension_sets` | the fairness-dimension taxonomies plugins declare                  |

`claim_move` is the only tool that writes. It writes through the engine-checked state machine, and
`claim_move` has no path that bypasses it — see
[ADR 0006](adr/0006-attestation-as-gated-transition.md).

### The generic core

| Tool                                                    | What it does                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `list_skills`                                           | the skill catalog from disk                                                              |
| `list_plugins`                                          | the resolved plugin registry, including why anything was rejected                        |
| `engine_summarize` / `engine_diff` / `engine_normalize` | canonicalise, compare and count claim records — "what did this commit do to the ledger?" |

---

## Two error shapes, on purpose

**A refusal is a result, not a failure.** `claim_move` on an unsupported transition returns a
normal response with `applied: false` and a `decision.reason`. An agent needs the reason, and a
thrown error would be indistinguishable from the tool being broken.

```json
{
  "applied": false,
  "from": "evidenced",
  "decision": {
    "ok": false,
    "fromState": "evidenced",
    "toState": "attested",
    "legal": ["challenged", "withdrawn"],
    "reason": "verdict is 'partial', not 'attestable' (unbacked: deletion-sla)"
  },
  "claim": { "...": "returned unchanged" }
}
```

**A genuine fault is an error envelope** with a stable code: `NOT_FOUND` for an unknown claim,
`VALIDATION_FAILED` for a malformed input, `UPSTREAM_FAILED` when the engine refuses.

The distinction matters: a rolled-out agent must be able to tell "you asked for something
impossible" from "this server is broken".

---

## Statelessness

Every tool is stateless. All state lives in the repository, addressed through the context. Two
concurrent calls to the same tool cannot interfere, and a call cannot depend on a previous one.

## Permissions

The server's ceiling is the union of what its registered tools **declare**. Running `mcp serve` is
an explicit operator action, so a tool is not additionally blocked for declaring what it needs —
but nothing is granted beyond a declaration, so a tool can never reach a capability it did not
declare.

Narrow it with `PRODUCT_MCP_PERMISSIONS`:

```bash
PRODUCT_MCP_PERMISSIONS=fs:read npm run cli -- mcp serve
```

---

## The client

`McpClient` connects to a configured server over stdio, lists its tools and calls one. It is what
`prove-mcp.mjs` uses, so the client is exercised on every proof run rather than only in unit tests.

```ts
import { McpClient } from '@biasledgerharness/mcp'

const client = new McpClient()
await client.connect({
  id: 'biasledger',
  command: process.execPath,
  args: ['packages/cli/dist/bin.js', 'mcp', 'serve'],
  enabled: true,
  cwd: process.cwd(),
})

const tools = await client.listTools()
const verdict = await client.callTool('evidence_evaluate', { claimId: 'consent-withdrawal' })
await client.close()
```

## Tool naming

Names must match `^[a-z][a-z0-9_]{0,63}$` to be exposable. This is asserted at server construction,
so a tool whose name MCP cannot carry **fails loudly** instead of silently disappearing from the
catalog.
