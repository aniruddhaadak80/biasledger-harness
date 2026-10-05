# Troubleshooting

Start with `npm run cli -- doctor`. Nine rows, each with a **fix hint**. The rows below are ordered
by how often they are the actual cause.

---

## `engine` — FAIL

The deterministic engine did not answer. Nothing else in the product works until this does.

```bash
npm run pytest
```

| Symptom                                        | Cause                                   | Fix                                                                         |
| ---------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| `ModuleNotFoundError: biasledger_harness`      | the module is not on the path           | run from the repo root; `pyproject.toml` sets `pythonpath = ["src"]`        |
| `FileNotFoundError` for a skill/plugin fixture | pytest invoked from the wrong directory | run `npm run pytest` from the repo root, not `npm run pytest --workspace …` |
| `NONZERO_EXIT` from the bridge                 | the interpreter is wrong                | set `engine.python` in `product.config.json`                                |
| `TIMEOUT`                                      | the corpus is large enough to be slow   | raise `engine.timeoutMs`                                                    |

The engine is a pure subprocess call. If `python -m biasledger_harness` works from
`services/engine/src` but the bridge does not, the difference is the `cwd` the bridge sets — it
uses `services/engine/src`, not your shell's directory.

---

## `evidence` — FAIL

`audit/evidence/` is missing or empty. **Every citation failure you see afterwards is a
consequence of this row**, so fix it first rather than chasing `unknown-document` findings.

```bash
npm run cli -- cite <docId> "<phrase>"   # proves the engine can read the corpus
```

`docId` is the filename minus `.md`.

---

## `index` — FAIL

The committed manifest does not reduce to its own recorded root. Either the manifest was edited by
hand, or the evidence changed without the index being rebuilt.

```bash
npm run cli -- root    # names which document drifted, if any
npm run cli -- index --write
npm run cli -- root    # consistent: yes, drifted: (none)
```

`root` distinguishes the two cases on purpose: `consistent no` means the _manifest_ was tampered
with; `drifted` names the _documents_ that changed. They have different fixes.

---

## A citation says `text-mismatch`

**This is the product working.** It means the document was edited after the citation was written,
and the citation still points at live bytes that now say different words.

```bash
npm run cli -- cite <docId> "<the current wording>"
```

Then update the citation's `byteStart`, `byteEnd` **and** `expects` in
`audit/claims/<id>.json`, and re-publish the index.

Do not "fix" it by widening the byte range until it resolves. That defeats the check.

---

## A citation says `span-past-end`

The document got shorter. Re-measure with `cite`.

## A citation says `blank-span`

The range points at whitespace. Cite words, not formatting.

## A citation says `unknown-document`

The `docId` does not match a file in `audit/evidence/`. Check for a rename:

```bash
npm run cli -- tools   # or: list_evidence over MCP
```

---

## `unverified -> attested` is refused

Correctly. There is no such transition — a claim must be evidenced first. See
[ADR 0006](adr/0006-attestation-as-gated-transition.md).

## `verdict is 'partial', not 'attestable'`

The engine re-evaluated the claim and found a required dimension unbacked. The refusal names it.
Either add the missing citation, or drop the dimension if the taxonomy listed it in error.

---

## `check:theme-tokens` fails

A raw hex, `rgb()` or `hsl()` literal appeared outside `apps/web/styles/tokens.css`. Add the
colour to the token file and reference the variable. Do not suppress the gate.

## `check:skill-version` fails

A `SKILL.md` body changed without a `metadata.version` bump. Bump it — users receive these files,
and an unbumped change is never offered to them.

## `check:public-hygiene` fails on `audit/evidence/`

It should not: `audit/evidence/` is in `.prettierignore` because a formatter reflowing a paragraph
invalidates every citation pointing past the change. If this fires, the ignore was removed.

## The web board renders the error state

The app could not read `audit/index.json`. It names the file and the fix on the page itself, and
`/api/health` reports the same problem as `corpus: fail`.

The usual cause is a deploy that excluded `audit/`. It is the system of record, not build output —
see [ADR 0005](adr/0005-git-as-system-of-record.md).

## The MCP server starts but an agent sees no tools

```bash
npm run mcp:proof
```

That is the real end-to-end proof over stdio. If it passes and the agent still sees nothing, the
problem is the agent's server configuration — `command` must be the absolute path to the built
binary, and `cwd` must be the repository root, because the server reads the corpus from its working
directory.
