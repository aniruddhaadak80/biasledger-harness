# Getting started

## Requirements

| Tool   | Version    | Checked by                                            |
| ------ | ---------- | ----------------------------------------------------- |
| Node   | >= 22.12.0 | `doctor`                                              |
| Python | >= 3.11    | `pytest`                                              |
| git    | any recent | needed for blob ids and `commit` in the health report |

## Install

```bash
git clone https://github.com/aniruddhaadak80/biasledger-harness.git
cd biasledger-harness
npm install
```

`npm install` also formats the tree, so `npm run check` should pass on the first run.

## Confirm the install

```bash
npm run cli -- doctor
```

Nine rows, each with a status and — if it failed — a fix hint. Everything must read `PASS` or
`WARN`. Two rows are worth understanding rather than skimming:

- **`engine`** — actually calls the Python engine and reports how many operations answered. If
  this fails, nothing else in the product works.
- **`index`** — recomputes the Merkle root from the committed manifest. `consistent yes` means the
  committed attestation still describes the bytes on disk.

## Read the board

```bash
npm run cli -- board
```

This repository audits itself. `audit/` contains four evidence artifacts, six claims, and the
committed index, so you are looking at real findings rather than a demo fixture — including one
citation that has genuinely rotted.

Start with the red `x` run on `consent-withdrawal`. That is the product working.

## Run the tests

```bash
npm test          # every TypeScript package
npm run pytest    # the Python engine, including property tests and the golden-file tests
```

The Python suite includes a golden-file test that re-evaluates the shipped corpus and asserts it
still produces the committed verdicts, and a subprocess regression test for the encoding bug in
[ADR 0004](adr/0004-byte-offsets-and-locale-encoding.md).

## Run the web app

```bash
npm run build
cd apps/web && npm run start
```

<http://localhost:3000>. The board is server-rendered from the same committed corpus; verify with:

```bash
curl -s localhost:3000/api/health
```

## Start here next

- [architecture.md](architecture.md) — the narrow waist and the footprint ladder
- [cli.md](cli.md) — every command, with its exit codes
- [../skills/cite-evidence/SKILL.md](../skills/cite-evidence/SKILL.md) — how to write a citation
- [troubleshooting.md](troubleshooting.md) — if something is broken

## Running it on your own claims

The shipped `audit/` directory is a worked example. To audit your own system:

1. Put one markdown artifact per evidence document in `audit/evidence/`. The filename minus
   `.md` is the `docId`.
2. Read the dimension taxonomy for your domain rather than inventing dimensions:

   ```bash
   npm run cli -- mcp call list_dimension_sets '{}'
   ```

   Ship a new domain as a plugin if none fits — see [plugins.md](plugins.md).

3. Write `audit/claims/<id>.json` with a `dimensions` array, each with citations measured by
   `npm run cli -- cite`.
4. Evaluate, then publish the attestation:

   ```bash
   npm run cli -- show <id>
   npm run cli -- index --write
   npm run cli -- root
   ```

Do not commit a stale `audit/index.json`. `root` will tell you, but a reviewer should not have to
run it to notice.
