---
name: diagnose
description: Use when biasledger-harness is misbehaving and the cause is not obvious, because the diagnostic order below finds the failing subsystem without guesswork.
metadata:
  version: 1.1.0
---

# Diagnose biasledger-harness

## When to use this

Something is broken and you do not yet know which subsystem is at fault.

## Steps

1. `biasledger doctor` — read the failing row and its **fix** line. Do not skip to step 2.
2. If `engine` is failing, the Python side is unreachable. Confirm it independently:
   `python -m pytest services/engine -q`. A `SPAWN_FAILED` or `NONZERO_EXIT` here means the
   interpreter, the `services/engine/src` path, or the `biasledger_harness` module is the fault,
   not your data.
3. If `evidence` is failing: `audit/evidence/` is missing or empty. Every failing citation you
   will see afterwards is a consequence of this row.
4. If `claims` is warning: `biasledger claims` lists what is on the board, and each line
   prints the moves currently allowed.
5. If `index` is failing: the committed manifest was edited by hand. Re-publish with
   `biasledger index --write`, then `biasledger root` to confirm `consistent yes`.
6. If `skills` is failing: `biasledger skills --json` lists every validation issue with a file
   and line. Fix the file, do not delete the skill.
7. If `plugins` is warning: `biasledger plugins --json` shows each rejection with its reason.
   A version mismatch names the required and running versions.
8. If a single capability misbehaves: `biasledger tools --json` to confirm it is registered,
   then `biasledger mcp call <tool> '<json>'` to see the error envelope with its stable code.
9. If the web app is stale: `curl -s localhost:3000/api/health` and read `checks`.

## Error codes

Host-side codes, from `packages/core`:

| Code                | Meaning                                    | First move                            |
| ------------------- | ------------------------------------------ | ------------------------------------- |
| `VALIDATION_FAILED` | input did not match the tool's schema      | print the schema, fix the caller      |
| `PERMISSION_DENIED` | tool needs a permission not granted        | check the declared permissions        |
| `NOT_FOUND`         | the claim, document or directory is absent | run the command that lists it         |
| `CONFLICT`          | duplicate name at registration             | find the other registrant             |
| `UPSTREAM_FAILED`   | the Python engine returned an error        | run the op directly, see `durationMs` |
| `TIMEOUT`           | the engine call exceeded its budget        | raise it or make the op cheaper       |

Engine-side codes, from `services/engine`:

| Code                  | Meaning                                                | First move                                      |
| --------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| `BLOB_MISMATCH`       | a document's blob id does not hash its text            | re-read the artifact; a stale id is cached      |
| `BAD_STATE`           | a claim state is not one of the five                   | read `biasledger mcp call claim_lifecycle '{}'` |
| `DUPLICATE_DOC`       | two documents share a doc id                           | rename one artifact                             |
| `DUPLICATE_DIMENSION` | a claim lists the same dimension twice                 | merge them                                      |
| `SPAN_PAST_END`       | a citation points past the end of a blob               | re-measure with `biasledger cite`               |
| `TEXT_MISMATCH`       | the bytes no longer contain what the citation expected | the document was rewritten; re-cite             |

## The one that is not a bug

`TEXT_MISMATCH` on a citation with an `expects` field is the product working. It means the
evidence document was edited after the claim was written, and the citation still points at
live bytes that now say something else. Re-cite it or withdraw the claim.

## Verify

`biasledger doctor` exits 0.
