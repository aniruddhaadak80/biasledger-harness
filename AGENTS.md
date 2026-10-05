# AGENTS.md

A **router**, not a manual. Read the file that owns the area before changing it.

| Area                                          | Read first                                           |
| --------------------------------------------- | ---------------------------------------------------- |
| tool interface, registry, permissions, errors | `packages/core/src/`                                 |
| the claim domain, lifecycle, lineage          | `packages/core/src/ledger.ts`                        |
| the engine-call path                          | `packages/cli/src/audit.ts`                          |
| reading and writing the audit corpus          | `packages/cli/src/repository.ts`                     |
| the board and its cursor                      | `packages/cli/src/board.ts`                          |
| registering the tools                         | `packages/cli/src/bootstrap.ts`                      |
| the byte-exact tokenizer and Merkle reduction | `services/engine/src/biasledger_harness/index.py`    |
| the gated claim lifecycle                     | `services/engine/src/biasledger_harness/claims.py`   |
| the wire protocol                             | `services/engine/src/biasledger_harness/protocol.py` |
| configuration schema                          | `packages/config/src/schema.ts`                      |
| storage, migrations (the cache)               | `packages/memory/src/migrations.ts`                  |
| skill format and authoring rules              | `skills/AGENTS.md`                                   |
| plugin manifests and dimension taxonomies     | `docs/plugins.md`                                    |
| MCP surface and tool naming                   | `docs/mcp.md`                                        |
| the web app and design tokens                 | `apps/web/styles/tokens.css`                         |
| the shipped audit corpus                      | `audit/` and `npm run cli -- board`                  |
| CI jobs and gates                             | `docs/ci.md`                                         |
| architectural decisions                       | `docs/adr/`                                          |

## Hard rules

1. **The narrow waist holds.** One registry, one `Tool` interface. A surface is a transport,
   never a second implementation. A second code path is a bug even when it works. The desktop
   doctor window is the reference: it loads the web app's `/health`, it does not re-probe.
2. **The footprint ladder is binding.** Extend an existing tool → CLI command + skill →
   service-gated tool → plugin → MCP tool → new core tool. Core is last, not first. A new
   fairness-dimension taxonomy belongs in a **plugin**, not in core.
3. **No cross-package deep imports.** Only declared entry points. `check:boundaries` fails
   otherwise.
4. **Tokens only in `apps/web`.** No raw colour literal outside `styles/tokens.css`.
5. **Never edit a version in a PR.** The release workflow owns version bumps.
6. **Never edit an applied migration.** Append a new one.
7. **The engine is pure.** No clock, no network, no randomness, no filesystem.
8. **Byte offsets, never line/column.** And the transport decodes UTF-8 explicitly — never with
   the platform locale. See `docs/adr/0004-byte-offsets-and-locale-encoding.md`.
9. **Never let a formatter touch `audit/evidence/`.** It is in `.prettierignore` for
   correctness, not tidiness: reflowing a paragraph invalidates every citation past the change.
10. **Git is the record; SQLite is a cache.** Nothing that decides whether a claim is supported
    may read the database.
11. **Attestation is a checked transition.** Never a mutable field. Never a client-side-only gate.
12. **Bump `metadata.version` on any `SKILL.md` body change.**
13. **Only ship commands you ran.** In the README and in skills. An aspirational command is a lie
    an agent will act on.
14. **Run the full gate before claiming done:** `npm run check`.

## Structural limits

A file over ~2000 lines, a function over ~300 lines, or a cyclomatic complexity over 30 is a
defect, not a style preference. Split it.

## Definition of done

- [ ] `npm run check` exits 0
- [ ] `npm run mcp:proof` passes if the change touches the registry or the engine
- [ ] tests cover the failure path, not only the happy path
- [ ] `CHANGELOG.md` has an `Unreleased` entry
- [ ] any user-visible change has a docs update (see the table in `docs/notes/`)
- [ ] every command you added was actually run, and its real output pasted

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
