# CLI reference

Every command below is one the author ran. The CLI is not published to npm, so invoke it as
`npm run cli -- <command>`; if you install it, drop the prefix.

Exit codes are part of the contract:

| Code | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| `0`  | success                                                                  |
| `1`  | runtime failure — a refused transition, a broken probe, a failed lookup  |
| `2`  | usage error — unknown command, unparseable JSON, unknown lifecycle state |

---

## The board (default)

```bash
npm run cli -- board
npm run cli --            # identical — this is the landing view
```

Five columns, one per lifecycle state. Each card shows the claim id, its verdict, how many
required dimensions are covered, a **span-lineage strip** per cited document, and any gaps.

| Option        | Effect                             |
| ------------- | ---------------------------------- |
| `--json`      | the whole board as structured data |
| `--width <n>` | board width; lines never exceed it |

### The span-lineage strip

One band per cited document, drawn across that document's real byte range:

| Glyph | Meaning                                              |
| ----- | ---------------------------------------------------- |
| `#`   | a citation that resolved and still says what it said |
| `x`   | a citation that no longer says what it said          |
| `.`   | the part of the document the claim does not rest on  |

A wide gap means the claim rests on a sentence of a long document. A band that is mostly `x`
means the document was rewritten.

---

## Listing and inspecting

```bash
npm run cli -- claims            # one line per claim, with its currently legal moves
npm run cli -- show <claimId>    # every citation with byte range, line, blob and outcome
npm run cli -- tools             # the registry — the authoritative capability list
npm run cli -- skills            # the skill catalog loaded from disk
npm run cli -- plugins           # the resolved plugin registry, and why anything was rejected
npm run cli -- version           # name, version, node, platform, tool count
```

`claims` prints the legal moves under each claim, derived from the claim's **live verdict** rather
than from its state. A claim marked `attested` whose verdict is `partial` shows no `attested` move
available — which is the finding.

---

## The index and the attestation

```bash
npm run cli -- index              # build or resume; print the root
npm run cli -- index --write      # publish audit/index.json so the next run can resume
npm run cli -- index --no-resume  # force a full rebuild
npm run cli -- root               # recompute the root from the committed manifest, offline
```

`index` reuses any document whose git blob id is unchanged, so a re-run after a one-line claim
edit costs one document, not the whole corpus. `root` needs **no corpus at all**: it reduces the
committed manifest on its own, which is what a third party can run.

---

## Citations

```bash
npm run cli -- cite <docId> "<exact phrase>"
```

Measures a phrase to its byte range and prints a ready-to-paste citation. Never hand-compute an
offset — see [ADR 0004](adr/0004-byte-offsets-and-locale-encoding.md).

---

## The lifecycle

```bash
npm run cli -- move <claimId> attested
npm run cli -- move <claimId> withdrawn --note "superseded by the 2026 re-audit"
```

The engine refuses illegal moves, refuses attestation whose verdict is not `attestable`, and
refuses withdrawal without a reason. A refusal exits `1` and writes nothing.

```console
$ npm run cli -- move consent-withdrawal attested
  refused: verdict is 'partial', not 'attestable' (unbacked: deletion-sla)
```

---

## Diagnostics

```bash
npm run cli -- doctor
npm run cli -- doctor --json
```

Probes node, the package, skills, plugins, config, the **Python engine**, the **evidence corpus**,
and the **committed index**. Every failing row carries a fix hint. Exits `1` if any check fails.

The engine and index rows are real probes, not configuration reads: the engine is called and the
committed Merkle root is recomputed.

---

## MCP

```bash
npm run cli -- mcp serve                          # stdio; stdout belongs to the protocol
npm run cli -- mcp call <tool> '<json-input>'     # invoke one tool without MCP
npm run mcp:proof                                 # end-to-end proof over real stdio
```

`mcp call` accepts the full permission set including writes, because it is a direct local
invocation. See [mcp.md](mcp.md).
