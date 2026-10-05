# The encoding bug that made the whole premise unsound

_2026-10-05_

## What happened

A citation in `triage-calibration` pointed at bytes 528–584 of `calibration-report.md` and was
refused with `text-mismatch`. The bytes the engine read were:

```
", so the spread between the best and worst group is 0.00"
```

The bytes on disk were:

```
"the spread between the best and worst group is 0.008 ECE"
```

Five bytes out. The same document's other citations were shifted by the same amount, and the first
multi-byte character in the file was an em dash at byte 21 — an `E2 80 94` sequence.

## The cause

The Node side sends UTF-8 JSON over a pipe. Python reads it with `sys.stdin.read()`, which decodes
with `locale.getpreferredencoding()` — `cp1252` on Windows. So:

| bytes on disk             | decoded as cp1252     | re-encoded to UTF-8                     |
| ------------------------- | --------------------- | --------------------------------------- |
| `E2 80 94` (3 bytes, `—`) | `â` `€` `”` (3 chars) | `C3 A2` `E2 82 AC` `E2 80 9D` (8 bytes) |

Three bytes became eight. Every offset after byte 21 moved, and the engine was confidently
reporting verdicts about text nobody wrote. The file grew from 1463 bytes to 1468 as far as Python
was concerned.

## Why the tests missed it

Every unit test injected a `StringIO`. `StringIO` has no `.buffer`, so the codec was never
consulted, and the whole suite passed with the bug present.

This is the general shape of the failure: the test exercised the logic and not the boundary. The
logic was correct.

## The fix

`protocol.py` reads `sys.stdin.buffer` and decodes UTF-8 explicitly, and writes
`sys.stdout.buffer`. Text streams (the test path) still work, so the existing tests are unchanged.

The regression test runs a real subprocess:

```python
def test_byte_offsets_survive_a_multibyte_character(self) -> None:
    text = "title — dash\nthen the cited phrase\n"
    needle = "the cited phrase"
    start = text.encode("utf-8").index(needle.encode("utf-8"))
    result = self._run({"op": "verify_span", "input": {...}})
    assert result["valid"] is True
    assert result["text"] == needle
    assert result["docBytes"] == len(text.encode("utf-8"))
```

## What it changed about the design

Three things, all now ADRs rather than comments:

1. **Spans are byte offsets, never line/column.** A column is a character count; a span is a byte
   range. They are different units and they disagree on non-ASCII text.
2. **The Merkle leaf excludes the line number.** A line is derivable from an offset; an offset is
   not derivable from a line.
3. **A citation records what it `expects` to say**, so drift is a reported reason rather than a
   citation that silently points at different words.

The related lesson: **the boundary is the test.** Anything crossing a process or a locale boundary
needs a test that actually crosses it. `StringIO` made the engine look correct and it was not.

See [ADR 0004](../adr/0004-byte-offsets-and-locale-encoding.md).
