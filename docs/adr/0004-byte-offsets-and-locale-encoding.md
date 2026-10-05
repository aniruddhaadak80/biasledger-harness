# ADR 0004 — Citations are byte offsets, and the transport must be UTF-8

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

A citation in this product is `{ docId, byteStart, byteEnd }` into the UTF-8 encoding of an
evidence file, plus an optional `expects` string recording what the citation claimed to say.

We originally used line and column pairs. That was wrong in two ways that only appear in
production:

1. A column is measured in _characters_; the span is stored in _bytes_. The two disagree the
   moment a document contains a non-ASCII character, and they disagree silently.
2. A line number is a rendering of an offset. Insert a paragraph above a citation and every
   line number below it is stale, with nothing to detect it.

Worse, we hit a bug that made the whole premise unsound. On Windows, Python's `sys.stdin` decodes
with the platform locale — `cp1252`. We sent UTF-8 JSON over a pipe; Python decoded a three-byte
em dash (`E2 80 94`) as three separate characters and re-encoded them as eight bytes. Every byte
offset after the first non-ASCII character in every document was wrong, and the engine was
confidently reporting verdicts about text nobody wrote.

The symptom was subtle: a citation at bytes 528–584 resolved to
`", so the spread between the best and worst group is 0.00"` instead of
`"the spread between the best and worst group is 0.008 ECE"`. A five-byte shift, deterministic,
and completely plausible-looking.

## Decision

1. **Spans are byte offsets, never line/column.** Line numbers are _derived_ for display and are
   never stored in a citation.
2. **The transport reads and writes raw bytes and decodes UTF-8 explicitly.** `protocol.py` uses
   `sys.stdin.buffer` / `sys.stdout.buffer`, never the locale codec.
3. **The Merkle leaf covers the byte span and deliberately excludes the line number.** A line is
   derivable from an offset; an offset is not derivable from a line. Folding the line in would
   make the root sensitive to how earlier paragraphs happened to wrap.
4. **A citation records what it `expects` to say**, so a document rewritten underneath it is a
   `text-mismatch` finding rather than a citation that silently now points at different words.
5. **The engine verifies the blob id it is given** rather than trusting the caller, because a
   self-consistent index over the wrong bytes is worse than no index.

## Consequences

**Good**

- A citation is immutable against any edit that does not touch its own bytes.
- Two auditors on different platforms compute the same root, because neither platform's locale
  touches the offsets.
- Drift is detectable as a _reason_ — `text-mismatch`, `span-past-end`, `blank-span` — rather
  than as a wrong number.
- `.prettierignore` excludes `audit/evidence/`, because a formatter reflowing a paragraph would
  invalidate every citation pointing past the change.

**Bad**

- Citations are unreadable by eye. `npm run cli -- cite <docId> "<phrase>"` exists so nobody
  types a byte offset, but authoring one still means running a command.
- Editing a document shifts every offset after the edit even if the cited sentence is
  untouched, so a bulk edit to an evidence file requires re-running `cite` and re-attesting.
  This is the real cost, and it is the right trade: the alternative is citations that silently
  mean something else.
- The UTF-8 requirement is invisible until it is violated. It is covered by a subprocess
  regression test rather than a comment, because a comment would not have caught it.

## Alternatives rejected

**Line and column pairs.** Rejected: the unit is ambiguous for non-ASCII text and unstable under
any edit above the citation.

**Content hashes instead of offsets.** Rejected: a hash proves _which_ document, not _which
sentence_. The offset is what makes "this claim rests on that sentence" checkable.

**Text matching at evaluation time.** Rejected as the primary mechanism: it cannot detect drift,
because after an edit the search would simply find the new text. Kept only as the `expects`
cross-check.

**Trusting the host's blob id.** Rejected after a test caught it: passing edited text with the
original blob produced a plausible root over stale postings.
