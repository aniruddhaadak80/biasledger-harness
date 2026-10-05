---
name: cite-evidence
description: Use when you need to attach evidence to a fairness claim and must not guess a byte offset, because a citation that names the wrong bytes is worse than no citation.
metadata:
  version: 1.0.0
---

# Citing evidence byte-exactly

## When to use this

You are adding a citation to a claim in `audit/claims/<id>.json` and need the `byteStart` and
`byteEnd` values. **Never count characters or lines by hand.** A citation is a byte range into
the UTF-8 encoding of an evidence file, and a hand-computed offset is wrong the moment the
document contains a non-ASCII character.

## Steps

1. Find the document's id — it is the filename without `.md`.

   ```
   biasledger tools
   ```

   or read `audit/evidence/` directly.

2. Measure the phrase instead of guessing it:

   ```
   biasledger cite <docId> "<exact phrase>"
   ```

   This prints the byte range, the line, the blob id, and a ready-to-paste citation object.

3. Add the citation to the dimension, and record what it claims to say:

   ```json
   {
     "key": "calibration-spread",
     "required": true,
     "citations": [
       {
         "docId": "calibration-report",
         "byteStart": 417,
         "byteEnd": 485,
         "expects": "The worst expected calibration error across the four groups is 0.036"
       }
     ]
   }
   ```

   `expects` is not decoration. It is what lets the engine notice that the document was
   rewritten underneath the citation and now says something else at the same place.

4. Resolve the citation the same way an auditor will:

   ```
   biasledger show <claimId>
   ```

   Every span must report `ok`. A `FAIL` line names the reason — `text-mismatch`,
   `span-past-end`, `blank-span`, `unknown-document` — and is a finding, not a bug.

## Rules

- A citation that resolves to whitespace is a `blank-span` finding. Cite words.
- A citation with no `expects` cannot detect drift. Add one.
- One dimension is one thing you are claiming. Do not let a dimension quietly cover two.
- Do not widen a byte range to make it resolve. Narrow it until it names the sentence you mean.

## Verify

```
biasledger show <claimId>
```

The claim's `citations N valid, 0 invalid` line must read zero invalid.
