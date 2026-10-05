"""The evidence index: byte-exact tokenizer, resumable index, Merkle reduction.

These functions are the reason the product is credible. Everything here is pure: it reads
its arguments, it returns a value, and it touches nothing else. No clock, no network, no
randomness, no filesystem.

The one invariant that matters: **a citation is a byte range, and this module knows byte
ranges exactly.** Terms carry byte offsets into the UTF-8 encoding of the artifact, never
line/column pairs that drift the moment a line is reflowed. That is why the Merkle root
below covers byte offsets and deliberately excludes line numbers -- a line is derivable
from a byte offset, but a byte offset is not derivable from a line.
"""

from __future__ import annotations

import hashlib
from bisect import bisect_right
from typing import Any, Final, TypedDict

from .protocol import EngineError

INDEX_VERSION: Final[int] = 1

#: A word is a maximal run of these bytes. Anything else is a boundary. Deliberately narrow:
#: a wider class would make "calibration-rate" and "calibration" two different terms.
WORD_BYTES: Final[frozenset[int]] = frozenset(
    b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"
)

#: Unit separator. A byte that cannot occur inside a term, a doc id, or a decimal number,
#: so it is the canonical field delimiter: "a\x1fb" cannot collide with "a\x1fb" split
#: differently.
FIELD_SEP: Final[bytes] = b"\x1f"

#: The root of an empty corpus is a constant, so an empty index is still attestable.
EMPTY_ROOT: Final[str] = hashlib.sha256(b"").hexdigest()


class Posting(TypedDict):
    """One occurrence of a term inside one document, in bytes."""

    start: int
    end: int
    line: int


class DocumentIndex(TypedDict):
    """The per-document index. This is the unit a resumable build caches."""

    blob: str
    bytes: int
    terms: dict[str, list[Posting]]


class Manifest(TypedDict):
    """The resumable build state, safe to commit and to hand to another auditor."""

    version: int
    docs: dict[str, DocumentIndex]
    root: str


class Row(TypedDict):
    """A posting joined to its document: the shape the merged index stores."""

    docId: str
    start: int
    end: int
    line: int


class Index(TypedDict):
    version: int
    terms: dict[str, list[Row]]
    docBytes: dict[str, int]


class BuildOutput(TypedDict):
    index: Index
    manifest: Manifest
    root: str
    reused: int
    rebuilt: int
    dropped: list[str]


# ---------------------------------------------------------------- shape guards


def require_docs(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", "expected an object with a 'docs' array")
    docs = payload.get("docs")
    if not isinstance(docs, list):
        raise EngineError("BAD_SHAPE", "'docs' must be an array")
    seen: set[str] = set()
    for index, doc in enumerate(docs):
        if not isinstance(doc, dict):
            raise EngineError("BAD_SHAPE", f"docs[{index}] must be an object")
        for key in ("docId", "blob", "text"):
            if key not in doc:
                raise EngineError("MISSING_FIELD", f"docs[{index}] is missing {key!r}")
        if not isinstance(doc["docId"], str) or not doc["docId"]:
            raise EngineError("BAD_SHAPE", f"docs[{index}].docId must be a non-empty string")
        if not isinstance(doc["blob"], str) or not doc["blob"]:
            raise EngineError("BAD_SHAPE", f"docs[{index}].blob must be a non-empty string")
        if not isinstance(doc["text"], str):
            raise EngineError("BAD_SHAPE", f"docs[{index}].text must be a string")
        # The whole product rests on a blob id meaning "the hash of these bytes", so the
        # engine does not take a caller's word for it. A host that sends a stale blob with
        # edited text would otherwise produce a self-consistent index over the wrong bytes.
        actual = _blob_of(doc["text"])
        if doc["blob"] != actual:
            raise EngineError(
                "BLOB_MISMATCH",
                f"docs[{index}].blob {doc['blob']!r} does not hash these bytes "
                f"(expected {actual!r}); re-read the artifact rather than carrying a stale id",
            )
        if doc["docId"] in seen:
            raise EngineError("DUPLICATE_DOC", f"docId {doc['docId']!r} appears more than once")
        seen.add(doc["docId"])
    return docs


def _blob_of(text: str) -> str:
    """The git object name for these exact bytes -- how a citation stays immutable."""
    header = f"blob {len(text.encode('utf-8'))}\0"
    return hashlib.sha1(  # noqa: S324 - git object ids are sha1 by definition, not a choice
        header.encode("ascii") + text.encode("utf-8")
    ).hexdigest()


def blob_for(text: str) -> str:
    return _blob_of(text)


# ---------------------------------------------------------------- tokenizer


def line_starts(data: bytes) -> list[int]:
    starts = [0]
    for offset, byte in enumerate(data):
        if byte == 0x0A:
            starts.append(offset + 1)
    return starts


def tokenize(data: bytes) -> list[tuple[bytes, int, int]]:
    """Split into maximal word runs with byte-exact half-open spans.

    Returned as (raw_bytes, start, end). Lowercasing happens in `index_document`, so the
    span always points at the original bytes on disk and never at a normalised copy.
    """
    tokens: list[tuple[bytes, int, int]] = []
    start: int | None = None
    for offset, byte in enumerate(data):
        if byte in WORD_BYTES:
            if start is None:
                start = offset
        elif start is not None:
            tokens.append((data[start:offset], start, offset))
            start = None
    if start is not None:
        tokens.append((data[start : len(data)], start, len(data)))
    return tokens


def line_of(starts: list[int], offset: int) -> int:
    """1-based line number for a byte offset."""
    return bisect_right(starts, offset)


def index_document(doc_id: str, blob: str, text: str) -> DocumentIndex:
    """Index one artifact. Deterministic: same text always gives the same structure."""
    if not doc_id:
        raise EngineError("BAD_SHAPE", "docId must be a non-empty string")
    data = text.encode("utf-8")
    starts = line_starts(data)
    terms: dict[str, list[Posting]] = {}

    for raw, start, end in tokenize(data):
        term = raw.decode("utf-8").lower()
        bucket = terms.get(term)
        posting: Posting = {"start": start, "end": end, "line": line_of(starts, start)}
        if bucket is None:
            terms[term] = [posting]
        else:
            bucket.append(posting)

    for postings in terms.values():
        postings.sort(key=lambda item: (item["start"], item["end"]))

    return {"blob": blob, "bytes": len(data), "terms": dict(sorted(terms.items()))}


# ---------------------------------------------------------------- merge + root


def merge(documents: dict[str, DocumentIndex]) -> Index:
    """Join per-document indexes into one inverted index.

    Sorted by term, then by (docId, byteStart, byteEnd). The result does not depend on the
    order documents were indexed in.
    """
    terms: dict[str, list[Row]] = {}
    for doc_id in sorted(documents):
        doc = documents[doc_id]
        for term, postings in doc["terms"].items():
            bucket = terms.get(term)
            for posting in postings:
                row: Row = {
                    "docId": doc_id,
                    "start": posting["start"],
                    "end": posting["end"],
                    "line": posting["line"],
                }
                if bucket is None:
                    terms[term] = [row]
                else:
                    bucket.append(row)

    for bucket in terms.values():
        bucket.sort(key=lambda row: (row["docId"], row["start"], row["end"]))

    return {
        "version": INDEX_VERSION,
        "terms": dict(sorted(terms.items())),
        "docBytes": {doc_id: documents[doc_id]["bytes"] for doc_id in sorted(documents)},
    }


def leaf_hash(term: str, row: Row) -> bytes:
    """One Merkle leaf.

    Covers the term, the document, and the byte span. Excludes the line number on purpose:
    a line is a rendering of an offset, so folding it in would make the root sensitive to
    how earlier lines happened to wrap.
    """
    payload = FIELD_SEP.join(
        [
            term.encode("utf-8"),
            row["docId"].encode("utf-8"),
            str(row["start"]).encode("ascii"),
            str(row["end"]).encode("ascii"),
        ]
    )
    return hashlib.sha256(payload).digest()


def merkle_root(leaves: list[bytes]) -> bytes:
    """Fold leaves pairwise. An odd node at any level is paired with itself."""
    if not leaves:
        return hashlib.sha256(b"").digest()
    level = list(leaves)
    while len(level) > 1:
        if len(level) % 2 == 1:
            level.append(level[-1])
        level = [
            hashlib.sha256(level[i] + level[i + 1]).digest() for i in range(0, len(level), 2)
        ]
    return level[0]


def reduce_root(index: Index) -> str:
    """Reduce an index to its Merkle root, as a hex string.

    Re-sorts before hashing, so the root depends only on the *content* of the index and not
    on the order postings happened to arrive in. Two auditors who indexed the same bytes
    differently and still agree on the root were looking at the same evidence.
    """
    leaves: list[bytes] = []
    for term in sorted(index["terms"]):
        rows = sorted(
            index["terms"][term], key=lambda row: (row["docId"], row["start"], row["end"])
        )
        for row in rows:
            leaves.append(leaf_hash(term, row))
    return merkle_root(leaves).hex()


# ---------------------------------------------------------------- resumable build


def reduce_manifest(payload: Any) -> dict[str, Any]:
    """Reduce a stored manifest to its root, using no corpus at all.

    This is the property that makes an attestation checkable offline: give it the manifest you
    committed three reviews ago and it recomputes the same root, because the per-document
    indexes inside the manifest are the whole index. It also reports whether the manifest is
    self-consistent, which catches a hand-edited file that someone hoped nobody would re-hash.
    """
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", "expected an object with a manifest")
    manifest = payload.get("manifest")
    if not isinstance(manifest, dict):
        raise EngineError("BAD_SHAPE", "'manifest' must be an object")
    docs = manifest.get("docs")
    if not isinstance(docs, dict):
        raise EngineError("BAD_SHAPE", "manifest.docs must be an object")

    documents: dict[str, DocumentIndex] = {}
    for key, value in docs.items():
        if not isinstance(value, dict) or not isinstance(value.get("terms"), dict):
            raise EngineError("BAD_SHAPE", f"manifest.docs[{key!r}] must carry a 'terms' object")
        if not isinstance(value.get("bytes"), int):
            raise EngineError("BAD_SHAPE", f"manifest.docs[{key!r}] must carry an integer 'bytes'")
        blob = value.get("blob")
        documents[key] = {
            "blob": blob if isinstance(blob, str) else "",
            "bytes": value["bytes"],
            "terms": value["terms"],
        }

    index = merge(documents)
    root = reduce_root(index)
    claimed = manifest.get("root")
    return {
        "root": root,
        "claimedRoot": claimed if isinstance(claimed, str) else None,
        "consistent": claimed == root if isinstance(claimed, str) else None,
        "terms": len(index["terms"]),
        "docs": sorted(documents),
    }


def build_index(payload: Any) -> BuildOutput:
    """Build (or resume) the evidence index.

    Pass a previous `manifest` and any document whose `blob` is unchanged is reused from
    cache instead of re-tokenized. This is safe rather than a shortcut: a blob id *is* the
    hash of the bytes, so a cached entry whose blob matches the current text describes the
    current bytes by construction.

    Resuming is idempotent. Building twice with the first result as the manifest reuses
    every document and leaves the root untouched.
    """
    docs = require_docs(payload)
    manifest = payload.get("manifest")
    cached: dict[str, DocumentIndex] = {}
    if manifest is not None:
        if not isinstance(manifest, dict):
            raise EngineError("BAD_SHAPE", "'manifest' must be an object when present")
        raw_docs = manifest.get("docs")
        if raw_docs is not None and not isinstance(raw_docs, dict):
            raise EngineError("BAD_SHAPE", "manifest.docs must be an object")
        for key, value in (raw_docs or {}).items():
            if isinstance(value, dict) and isinstance(value.get("terms"), dict):
                cached[key] = value  # type: ignore[assignment]

    indexed: dict[str, DocumentIndex] = {}
    reused = 0
    rebuilt = 0

    for doc in docs:
        doc_id = doc["docId"]
        blob = doc["blob"]
        text = doc["text"]
        entry = cached.get(doc_id)
        if entry is not None and entry.get("blob") == blob:
            indexed[doc_id] = entry
            reused += 1
        else:
            indexed[doc_id] = index_document(doc_id, blob, text)
            rebuilt += 1

    index = merge(indexed)
    root = reduce_root(index)

    return {
        "index": index,
        "manifest": {
            "version": INDEX_VERSION,
            "docs": dict(sorted(indexed.items())),
            "root": root,
        },
        "root": root,
        "reused": reused,
        "rebuilt": rebuilt,
        "dropped": sorted(set(cached) - set(indexed)),
    }