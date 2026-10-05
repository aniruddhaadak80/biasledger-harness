---
name: run-an-audit
description: Use when you need to find out which fairness claims in a repository are actually still backed by evidence, because claim records drift silently as documents are rewritten.
metadata:
  version: 1.0.0
---

# Running an audit

## When to use this

You need to know which claims still hold, before a review, a sign-off, or a hand-over. You want
findings, not a summary.

## Steps

1. Check the tree is wired before trusting any answer:

   ```
   biasledger doctor
   ```

   The `engine`, `evidence` and `index` rows must pass. A `FAIL` on `index` means the
   committed manifest was edited by hand; re-publish it with `biasledger index --write`.

2. Read the board:

   ```
   biasledger
   ```

   Each card carries a verdict (`attestable`, `partial`, `unsubstantiated`) and a
   **span-lineage strip**: one band per cited document, `#` for a citation that resolved, `x`
   for one that no longer says what it said, `.` for the parts of the document the claim does
   not rest on. Wide gaps are a claim resting on a sentence of a long document.

3. Drill into anything that is not `attestable`:

   ```
   biasledger show <claimId>
   ```

   Read the gaps and the per-span reasons. `text-mismatch` means the document was edited
   after the claim was written — the citation still points at live bytes, but at different
   words.

4. Check the arithmetic across the board:

   ```
   biasledger claims
   ```

   Each line lists the moves the claim is currently allowed, derived from its verdict rather
   than from its state. A claim marked `attested` whose verdict is `partial` is the finding
   you are looking for.

5. Verify the attestation still recomputes:

   ```
   biasledger root
   ```

   This re-reduces the Merkle root from the committed manifest alone — no corpus, no rebuild —
   and reports whether the evidence files have drifted since the index was written. A
   third party can run exactly this.

## Reading the numbers

- `attestable` — every required dimension has a citation that resolves, and no citation is
  invalid. This is the only state from which `attested` is reachable.
- `partial` — some required dimensions are backed. The gaps are named.
- `unsubstantiated` — no required dimension is backed.

## Verify

```
biasledger root
```

`consistent yes` and `drifted (none)` means the committed attestation still describes the
bytes on disk.
