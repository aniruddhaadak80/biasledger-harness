# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `evidence_span`, `evidence_index`, `evidence_evaluate`, `claim_board`, `claim_move`,
  `claim_lifecycle` and `list_dimension_sets` tools, exposed identically to the CLI and MCP.
- The engine's index family: a byte-exact tokenizer, a resumable inverted index, an
  order-independent Merkle reduction, and `reduce_manifest`, which recomputes the root from a
  committed manifest with no corpus at all.
- The engine's claim family: span verification, coverage evaluation, and the gated five-state
  lifecycle.
- The claim board as the CLI landing view, with the span-lineage strip.
- A git-backed audit corpus — four evidence artifacts, six claims, a committed index — which the
  repository audits itself with.
- `npm run cli -- root`, which verifies the committed attestation offline.
- Fairness-dimension taxonomies as plugins: `clinical-triage` and `employment-screening`.
- Three skills: `cite-evidence`, `run-an-audit`, `attest-a-claim`.
- `npm run mcp:proof` — an end-to-end MCP proof over real stdio, 20 assertions.
- The web board, claim detail, evidence corpus, and surfaces pages, server-rendered from the
  committed corpus, plus `/api/board`.

### Fixed

- **The engine decoded stdin with the platform locale.** On Windows that is `cp1252`, so a
  three-byte UTF-8 character became three characters and then eight bytes, shifting every byte
  offset after the first non-ASCII character in every document. `protocol.py` now reads and writes
  raw bytes and decodes UTF-8 explicitly; a subprocess regression test pins it. This is
  [ADR 0004](docs/adr/0004-byte-offsets-and-locale-encoding.md).
- **The engine trusted a caller-supplied blob id.** Edited text with the original blob produced a
  self-consistent index over stale postings. `build_index` now verifies the blob hashes the text
  and refuses `BLOB_MISMATCH`.
- The committed index stored a reduced per-claim summary with no `spans`, and the web board threw
  while rendering. The index now stores the whole verdict, and a web test asserts the fields the
  board reads.
- `--width` on the board could overflow: the card budget did not account for the board's own
  indent. Lines are now clamped to the requested width on every line, including the legend.

### Changed

- `.prettierignore` excludes `audit/evidence/`. Formatting a paragraph invalidates every citation
  pointing past the change, so evidence artifacts are data rather than prose.
- `doctor` gained three real probes — `engine`, `evidence`/`claims`, and `index` — which call the
  Python engine and recompute the Merkle root rather than reading configuration.
- The desktop shell's doctor window loads the web app's own `/health` route instead of re-running
  probes, so it cannot disagree with the CLI.

### Removed

- The sample plugin, replaced by two real dimension taxonomies.
- The `channels` surface from the shipped surface list. It is omitted on purpose: this is a
  local-first instrument over a repository, and a messaging adapter would add an unaudited network
  egress path to a product whose pitch is auditability.

## [0.1.0] - 2026-10-05

### Added

- The narrow waist: one `Tool` interface and one `ToolRegistry`, reachable from the CLI, the web
  app, and the MCP server.
- `biasledger doctor` — subsystem probes with a fix hint per failing row.
- The deterministic Python engine, called as a pure function over stdin/stdout.
- The skills catalog with frontmatter validation and a CI version gate.
- The plugin registry with schema validation and priority-based conflict resolution.
- SQLite storage with WAL, numbered migrations, and FTS5 search, as a **cache** — git is the
  system of record ([ADR 0005](docs/adr/0005-git-as-system-of-record.md)).
- An MCP server exposing the registry over stdio, plus an MCP client.
- The web workspace, deployed to Vercel, with a real `/api/health` endpoint.
- The Electron desktop shell.

[Unreleased]: https://github.com/aniruddhaadak80/biasledger-harness/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aniruddhaadak80/biasledger-harness/releases/tag/v0.1.0
