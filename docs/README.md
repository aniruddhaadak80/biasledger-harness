# Documentation

| Page                                  | Read it when                                 |
| ------------------------------------- | -------------------------------------------- |
| [getting-started](getting-started.md) | you have just cloned this                    |
| [architecture](architecture.md)       | you need the map before changing anything    |
| [cli](cli.md)                         | you are scripting the CLI                    |
| [mcp](mcp.md)                         | you are connecting an agent                  |
| [skills](skills.md)                   | you are writing or editing a skill           |
| [plugins](plugins.md)                 | you are adding a fairness-dimension taxonomy |
| [configuration](configuration.md)     | you are changing how it runs                 |
| [troubleshooting](troubleshooting.md) | something is broken                          |
| [ci](ci.md)                           | you are adding a gate                        |
| [adr/](adr/)                          | you want the reasoning behind a decision     |
| [notes/](notes/)                      | you want the honest contributor history      |

## Decisions worth reading first

- [ADR 0004](adr/0004-byte-offsets-and-locale-encoding.md) — why citations are byte offsets, and
  the encoding bug that proved it. The single most informative document here.
- [ADR 0005](adr/0005-git-as-system-of-record.md) — why git is the record and SQLite is a cache.
- [ADR 0006](adr/0006-attestation-as-gated-transition.md) — why attestation is a checked
  transition and not a field.

## What is not documented here

The audit corpus. `audit/evidence/` and `audit/claims/` are a worked example of a real triage-model
audit, and reading them is the fastest way to understand the data model:

```bash
npm run cli -- show consent-withdrawal
npm run cli -- cite dataset-statement "Evaluation cohorts are retained for 24 months"
```
