# Configuration

Layered, later wins: **defaults → `product.config.json` → environment**. An invalid value raises a
`ValidationError` naming the field. It is never coerced.

## The file

Copy [`product.config.json.example`](../product.config.json.example) to `product.config.json`.
`doctor` warns when it is absent and runs on defaults, so the file is optional.

```json
{
  "productEnv": "development",
  "dataDir": ".data",
  "engine": { "python": "python", "timeoutMs": 10000 },
  "logLevel": "info"
}
```

| Key                | Default       | Meaning                                             |
| ------------------ | ------------- | --------------------------------------------------- |
| `productEnv`       | `development` | runtime mode                                        |
| `dataDir`          | `.data`       | where the SQLite **cache** lives — never the record |
| `engine.python`    | `python`      | interpreter for the deterministic engine            |
| `engine.timeoutMs` | `10000`       | hard ceiling on one engine call                     |
| `logLevel`         | `info`        | stderr log verbosity                                |

## Environment

| Variable                  | Effect                                             |
| ------------------------- | -------------------------------------------------- |
| `PRODUCT_DATA_DIR`        | overrides `dataDir`                                |
| `PRODUCT_MCP_PERMISSIONS` | comma-separated permission ceiling for `mcp serve` |
| `PYTHON`                  | the engine interpreter, overriding `engine.python` |
| `TELEMETRY_ENABLED`       | telemetry is off unless this is exactly `true`     |
| `PRODUCT_WEB_URL`         | the URL the desktop shell loads                    |

## The audit corpus is not configured

There is no setting for `audit/`. It is the system of record and it lives in the repository, so it
travels with the code, appears in a diff, and is reviewable in a pull request. A configurable
evidence path would let two auditors read different bytes and still claim to agree — see
[ADR 0005](adr/0005-git-as-system-of-record.md).

If you need to audit a corpus that is _not_ in this repository, copy it in. Do not add a path
setting.

## Secrets

There are none, and the product requires none. It reads a local repository, spawns a local Python
interpreter, and optionally serves a local web page. `npm run check:no-secrets` fails the build on
a committed credential, and `.env.example` ships with empty values only.

## What `doctor` reports

| Row                  | Source                                                          |
| -------------------- | --------------------------------------------------------------- |
| `node`, `package`    | runtime facts                                                   |
| `skills`, `plugins`  | read from disk                                                  |
| `config`             | whether `product.config.json` exists                            |
| `engine`             | a real call into Python, reporting how many operations answered |
| `evidence`, `claims` | the corpus                                                      |
| `index`              | the committed Merkle root, recomputed offline                   |

The last three are probes, not configuration reads. `doctor` does not report what it has not
observed.
