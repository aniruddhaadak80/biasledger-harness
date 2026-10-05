# ADR 0005 — Git is the system of record; SQLite is a disposable cache

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

The product has to answer two different questions with different requirements:

- **What is the evidence?** This must be immutable, diffable, reviewable in a pull request, and
  verifiable by someone with no access to our infrastructure.
- **What did the last run conclude?** This is derived, disposable, and worthless the moment the
  corpus changes.

A database is excellent at the second and bad at the first: you cannot review a fairness claim in
a diff, and you cannot hand a reviewer a commit.

The scaffold ships `packages/memory` on SQLite with WAL, numbered migrations and FTS5. Keeping it
as the authoritative store would have been the path of least resistance.

## Decision

**Git is the system of record.** Everything authoritative lives in `audit/`:

```
audit/evidence/*.md    the artifacts themselves — plain text, the bytes that get hashed
audit/claims/*.json    claim records: dimensions, citations, expected text, lifecycle state
audit/index.json       the committed index: Merkle root, per-document blobs, per-claim verdicts
```

`audit/index.json` is **derived and disposable**: delete it and `biasledger index --write`
rebuilds it to the same root.

**SQLite is a cache, never an authority.** `packages/memory` holds a run journal and an index
cache. Nothing in the product reads it to decide whether a claim is supported. If it is deleted,
corrupted, or never created, the product still answers every question from the repository.

## Consequences

**Good**

- A reviewer sees a fairness claim change in a pull request, exactly as they see any other
  change. "Attested" is a commit, not a row.
- The attestation is transferable. A third party clones the repository and recomputes the root
  with `biasledger root`, with no credentials and no service.
- The product works on a laptop with no database, which is how an auditor would actually use it.
- Drift is impossible to hide: if `audit/evidence/` changed without the index being rebuilt, the
  committed blob ids stop matching and `biasledger root` reports the drift.

**Bad**

- Bulk edits to evidence files shift every byte offset after them. This is ADR 0004's cost, and
  it lands here: a rewritten document means re-running `cite` and re-publishing the index.
- Git history grows with every claim edit. Acceptable — an audit trail _should_ be append-only —
  but it means `git log` is part of the product's storage budget.
- Large binary evidence (a PDF, a parquet shard) has no business in a repository. The current
  engine indexes markdown; a binary format would need its own ADR rather than a flag.

## Alternatives rejected

**SQLite as the authoritative store.** Rejected: claims become unreviewable and un-transferable,
and the audit trail becomes a table nobody can read in a diff. It also makes "hand the reviewer
a commit" impossible, which is the property the product exists to provide.

**A hosted service as the record.** Rejected: it would make the attestation unauditable by
construction, and would contradict the local-first posture.

**Committing only the claims and hashing the evidence externally.** Rejected: it splits the
thing being attested from the thing attesting it.
