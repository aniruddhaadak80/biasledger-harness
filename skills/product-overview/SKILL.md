---
name: product-overview
description: Use when someone new to biasledger-harness needs to understand what it does and where its capabilities live, because the surface area is wider than one README can convey.
metadata:
  version: 1.1.0
---

# biasledger-harness overview

## When to use this

You are orienting yourself in biasledger-harness and need the map, not the detail.

## The one idea

A fairness claim is only worth as much as the bytes it cites. This tool turns claims into
citations into **byte ranges inside named git blobs**, hashes those ranges into a Merkle root,
and refuses to let a claim be marked `attested` unless every required dimension is backed by a
citation that still resolves.

The consequence: `biasledger` can tell you a claim is unsubstantiated, and can prove it, but
it cannot tell you the evidence is _persuasive_. It answers a narrower question exactly.

## Steps

1. `biasledger doctor` — probes the engine, the corpus, the committed index, skills and
   plugins, and prints a fix hint per failing row.
2. `biasledger` — the claim board. No arguments is the landing view; this is a TUI-first tool.
3. `biasledger tools --json` — the authoritative list of capabilities.
4. `biasledger root` — re-reduces the Merkle root from the committed manifest alone.
5. Read `docs/architecture.md` for the narrow waist and the footprint ladder.

## Where the answers come from

Every capability is a `Tool` in one registry in `packages/core`, and every tool that needs the
deterministic engine calls the same bridge into `services/engine`. The Python side has three
families of pure functions and no I/O:

- `index.py` — byte-exact tokenizer, resumable inverted index, Merkle reduction.
- `claims.py` — span verification, coverage evaluation, the gated claim lifecycle.
- `analysis.py` — the operation registry the host dispatches through.

If a question is about _whether bytes say something_, it belongs in the engine and must never
be a model call.

## Where capability belongs

In order of preference. Adding to the core registry is the _last_ option, not the first:

1. Extend an existing tool
2. Add a CLI command plus a skill
3. Add a service-gated tool with a `check_fn`
4. Add a plugin — for a new fairness-dimension taxonomy, this is the right home
5. Add an MCP server tool to the catalog
6. Add a new core tool

## Verify

`biasledger doctor` exits 0, and `biasledger root` reports `consistent yes`.
