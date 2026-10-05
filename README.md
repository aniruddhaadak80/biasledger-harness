# biasledger-harness

**Turn AI fairness claims into a git-backed evidence index, then prove byte-exactly which ones still hold.**

[CI](https://github.com/aniruddhaadak80/biasledger-harness/actions/workflows/ci.yml) ·
[License](https://github.com/aniruddhaadak80/biasledger-harness/blob/main/LICENSE) ·
[Issues](https://github.com/aniruddhaadak80/biasledger-harness/issues) ·
[Live board](https://biasledger-harness.vercel.app)

---

## The problem

Somebody wrote that your triage model is calibrated across all four demographic groups. Six months
later a reviewer asks for the evidence, and you go looking for it: the numbers are in a slide
deck, the methodology is in a wiki page, and nobody can tell you whether either still describes
the model that is running.

The tooling that exists for this is a spreadsheet. Spreadsheets rot silently — nothing notices
that a document was rewritten and the sentence your claim cited now says something else.

## What this does instead

A claim is stored as **byte ranges inside named git blobs**. Every claim is evaluated against the
actual bytes on disk, and the result is reduced to a Merkle root that a third party can recompute
without access to your documents.

So the tool can tell you a claim is unsubstantiated — and prove it. What it will not tell you is
whether the evidence is _persuasive_. It answers a narrower question, exactly.

The claim cannot be marked `attested` unless every required dimension is backed by a citation that
still resolves. That is enforced in the engine, not in the UI: promotion is a checked state
transition, so nobody can move a claim past its evidence by editing a field.

---

## Quick start

```bash
git clone https://github.com/aniruddhaadak80/biasledger-harness.git
cd biasledger-harness
npm install
npm run cli -- doctor
```

`doctor` probes the runtime, the skill catalog, the plugin registry, the Python engine, the
evidence corpus and the committed index, and prints a **fix hint** for anything that fails.

> **Why `npm run cli --` and not `biasledger`?** This repository is not published to npm, so the
> `biasledger` binary is not on your PATH. Every command below is written the long way and has
> been run exactly as shown. If you install it, drop the prefix.

---

## Walkthrough

This repository audits itself. `audit/` holds four evidence artifacts, six fairness claims, and
the committed index — so every command below has real output.

### 1. The board

```bash
npm run cli -- board
```

Five columns, one per lifecycle state. Every card carries a **span-lineage strip**: one band per
cited document, drawn across that document's real byte range. `#` is a citation that resolved, `x`
is one that no longer says what it said, `.` is the part of the document the claim does not rest
on.

```
EVIDENCED (2)
  consent-withdrawal
    Subjects can withdraw consent and have their data deleted promptly
    partial  2/3 covered  1 broken
    dataset-statement
    [.............xxxxxxxxxxx..........]
    +3 corpus document(s) not cited
    gap: deletion-sla (all-citations-unresolvable)
```

That red run is the whole product in one line: a citation written against v1 of the dataset
statement, still pointing at live bytes that now say something else.

`biasledger` with no arguments is the same board.

### 2. Read one claim

```bash
npm run cli -- show consent-withdrawal
```

Every citation with its resolved byte range, line, blob id and outcome:

```
consent-withdrawal  [evidenced]
  Subjects can withdraw consent and have their data deleted promptly
  system   intake-2025H2
  verdict  partial  (0.666667 coverage, 2/3 required dimensions)
  citations 2 valid, 1 invalid
  root     10df64b9a45f30dcd440593f54457f389da451be7a6fb2749bc3fb3b1d185eaa
  attested over dataset-statement
    [ok  ] withdrawal-mechanism  dataset-statement:823-863 (line 18, blob 1370d89)  ok
           "A withdrawal request sets `withdrawn_at`"
    [FAIL] deletion-sla  dataset-statement:1146-1197 (line 23, blob 1370d89)  text-mismatch
           "the identity service issues a deletion job covering"
    [ok  ] retention-policy  dataset-statement:1350-1395 (line 29, blob 1370d89)  ok
           "Evaluation cohorts are retained for 24 months"
  gaps:
    deletion-sla: all-citations-unresolvable
```

### 3. Measure a citation instead of guessing one

```bash
npm run cli -- cite dataset-statement "Evaluation cohorts are retained for 24 months"
```

```
  dataset-statement  bytes 1350-1395  line 29
  blob  1370d899f146e4077eb20ec4b910c3dd9936452f
  citation: {"docId":"dataset-statement","byteStart":1350,"byteEnd":1395}
```

Never count characters or lines by hand. A citation is a byte range into the UTF-8 encoding, and
a hand-computed offset is wrong the moment the document contains an em dash. See
[ADR 0004](docs/adr/0004-byte-offsets-and-locale-encoding.md) for the bug that taught us this.

### 4. Build and verify the attestation

```bash
npm run cli -- index --write
npm run cli -- root
```

`index` builds — or **resumes** — the inverted index, reusing any document whose blob id has not
changed. `root` recomputes the Merkle root from the committed manifest alone, with no access to
the documents, and reports whether the corpus has drifted:

```
  committed   252aa61853ae3f6469c87e34089128b9d6041f53ea931036fc5bbd6d4aac1cb4
  recomputed  252aa61853ae3f6469c87e34089128b9d6041f53ea931036fc5bbd6d4aac1cb4
  consistent  yes
  drifted     (none)
```

### 5. Try to lie to it

```bash
npm run cli -- move consent-withdrawal attested
```

```
  refused: verdict is 'partial', not 'attestable' (unbacked: deletion-sla)
```

And withdrawal without a reason:

```bash
npm run cli -- move triage-calibration withdrawn
```

```
  refused: withdrawn requires a non-empty note saying why
```

Nothing is written when a move is refused. See
[skills/attest-a-claim](skills/attest-a-claim/SKILL.md) for the whole lifecycle.

### 6. The web board

```bash
npm run build
cd apps/web && npm run start
```

Then <http://localhost:3000>. Server-rendered from the same committed corpus, so the first paint
already contains the real claims and the real Merkle root.

```bash
curl -s localhost:3000/api/health
```

### 7. Connect an agent over MCP

```bash
npm run mcp:proof
```

That launches this product as a subprocess and speaks real MCP to it over stdio — `initialize`,
`tools/list`, a `tools/call` that reaches the Python engine, a refused transition, and an error
envelope. It is the script, not a claim, that proves the MCP surface works:

```
  [PASS] the catalog is not empty  13 tool(s)
  [PASS] evidence_index reached the engine and returned a sha256 root  252aa61853ae3f64…
  [PASS] the stale citation was caught over MCP too
  [PASS] a claim whose verdict is partial cannot be attested
  prove-mcp PASSED — 20/20 checks, over real stdio MCP
```

### 8. Run the engine directly

The engine is a pure function over stdin/stdout — no server, no port, no daemon:

```bash
cd services/engine/src
echo '{"op":"lifecycle","input":{}}' | python -m biasledger_harness
```

Same input, same output, every time. No clock, no network, no randomness, no filesystem.

### 9. The whole gate

```bash
npm run check
```

Exactly what CI runs, in the same order: format, lint, typecheck, six policy gates, the
TypeScript tests, the Python tests, and the build.

---

## How it works

```
              ┌───────────────┐
  CLI ───────▶│               │
  TUI ───────▶│  ToolRegistry │───▶ services/engine   pure Python over stdin/stdout
  Web API ───▶│  one registry │        │
  MCP server ▶│               │        ├─▶ index.py    byte-exact spans, Merkle reduction
  MCP client ▶└───────────────┘        ├─▶ claims.py   span checks, the gated lifecycle
              │                       └─▶ analysis.py the operation registry
              └──▶ audit/  the system of record: evidence, claims, committed index
```

The five invariants:

1. Tools are **stateless**. State lives in the repository, not in a tool.
2. Input is validated **before** the handler runs, never after.
3. Permissions are **declared**, and a call exceeding the granted set is refused.
4. A duplicate tool name **throws**, naming both registrants.
5. No cross-package deep imports. `check:boundaries` enforces it.

### The deterministic engine

Everything that decides whether evidence supports a claim is code, never a model call — because
the product's entire claim is that no model was asked.

| Operation         | What it guarantees                                                                 |
| ----------------- | ---------------------------------------------------------------------------------- |
| `build_index`     | Resumable inverted index; a document whose blob id is unchanged is reused          |
| `reduce_root`     | Order-independent Merkle root, so two auditors who indexed differently still agree |
| `reduce_manifest` | Recomputes the root from a committed manifest with no corpus at all                |
| `verify_span`     | A byte range resolves, or names the reason it does not                             |
| `evaluate_claim`  | Coverage, gaps, and an attestation over exactly the blobs it rests on              |
| `transition`      | The claim lifecycle, with `attested` gated on the verdict                          |

The engine refuses a blob id that does not hash the text it was sent, because a self-consistent
index over the wrong bytes is worse than no index.

### The footprint ladder

1. Extend an existing tool
2. Add a CLI command plus a skill
3. Add a service-gated tool
4. Add a plugin — for a new fairness-dimension taxonomy, this is the right home
5. Add an MCP server tool
6. Add a new core tool — **last resort**

A new regulated domain gets its own dimension taxonomy as a plugin, without touching core.

---

## What ships

| Surface              | Status  | What it is                                          |
| -------------------- | ------- | --------------------------------------------------- |
| CLI + board          | shipped | the primary interface; no arguments shows the board |
| Web                  | shipped | server-rendered Next.js, deployed to Vercel         |
| MCP server           | shipped | 13 tools over stdio                                 |
| MCP client           | shipped | connects to configured servers                      |
| Skills catalog       | shipped | 5 skills, version-gated                             |
| Plugin registry      | shipped | fairness-dimension taxonomies as plugins            |
| Deterministic engine | shipped | pure Python over stdin/stdout                       |
| Desktop shell        | shipped | Electron around the web build, plus a doctor window |
| Memory               | shipped | SQLite with WAL, numbered migrations, FTS5          |

### Deliberate omissions

**Channels are not built.** This is a local-first instrument over a repository you already own. A
messaging adapter would be a strictly worse way to read a claim board, and it would add an
unaudited network egress path to a product whose entire pitch is auditability.

**Model providers are not in the decision path.** A provider may summarise a finding for a human.
Nothing that decides support may route through one.

---

## Configuration

Layered, later wins: **defaults → `product.config.json` → environment**. An invalid value raises
an error naming the field; it is never coerced. See [docs/configuration.md](docs/configuration.md).

---

## Documentation

| Page                                       | Read it when                              |
| ------------------------------------------ | ----------------------------------------- |
| [getting-started](docs/getting-started.md) | you have just cloned this                 |
| [architecture](docs/architecture.md)       | you need the map before changing anything |
| [cli](docs/cli.md)                         | you are scripting the CLI                 |
| [mcp](docs/mcp.md)                         | you are connecting an agent               |
| [skills](docs/skills.md)                   | you are writing or editing a skill        |
| [plugins](docs/plugins.md)                 | you are adding a domain taxonomy          |
| [ci](docs/ci.md)                           | you are adding a gate                     |
| [troubleshooting](docs/troubleshooting.md) | something is broken                       |
| [adr/](docs/adr/)                          | you want the reasoning behind a decision  |

## Development

```bash
npm install
npm run build        # turbo build across every package
npm run typecheck    # tsc --noEmit across every package
npm run lint         # eslint
npm run format       # prettier --write
npm test             # vitest, every package
npm run pytest       # the Python engine, including property tests
npm run mcp:proof    # end-to-end MCP over real stdio
npm run check        # everything CI runs
```

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). The rules that are not negotiable are in
[AGENTS.md](AGENTS.md), and the reasoning behind each decision is in [docs/adr/](docs/adr/).

## License

Apache-2.0 — see [LICENSE](LICENSE). Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
