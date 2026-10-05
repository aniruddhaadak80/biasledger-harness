"""The claim lifecycle: byte-exact span verification, coverage, and a gated state machine.

The product's claim is that no model was asked whether the evidence supports the claim. So
everything that decides support is here, in code:

  * `verify_span`  -- does this byte range exist, in this blob, and say what it says?
  * `evaluate_claim` -- which required fairness dimensions are actually backed, and which
    are gaps?
  * `transition`   -- may this claim move to that state, *given* what the evidence shows?

The last one is the load-bearing rule. A claim cannot be marked `attested` unless its
verdict is `attestable`. A reviewer cannot promote a claim past the evidence, because the
promotion itself is a checked transition rather than a field edit.
"""

from __future__ import annotations

import hashlib
from typing import Any, Final, Literal, TypedDict

from .index import blob_for, index_document, line_of, line_starts, merge, reduce_root
from .protocol import EngineError

ClaimState = Literal["unverified", "evidenced", "challenged", "attested", "withdrawn"]

#: The five states a claim can occupy. Ordered by how much they assert.
STATES: Final[tuple[str, ...]] = (
    "unverified",
    "evidenced",
    "challenged",
    "attested",
    "withdrawn",
)

#: The only legal moves. Anything not listed here is refused -- this table is the whole
#: lifecycle, and an unlisted transition is a bug rather than an edge case.
TRANSITIONS: Final[dict[str, tuple[str, ...]]] = {
    "unverified": ("evidenced", "withdrawn"),
    "evidenced": ("challenged", "attested", "withdrawn"),
    "challenged": ("evidenced", "attested", "withdrawn"),
    "attested": ("challenged", "withdrawn"),
    "withdrawn": ("unverified",),
}

#: Reaching these states is conditional, not merely legal.
GATED: Final[dict[str, str]] = {
    "attested": "the verdict must be 'attestable'",
    "withdrawn": "a non-empty note is required",
}

VERDICTS: Final[tuple[str, ...]] = ("attestable", "partial", "unsubstantiated")

_COVERAGE_SCALE: Final[int] = 6


class Citation(TypedDict):
    docId: str
    byteStart: int
    byteEnd: int
    expects: str


class Dimension(TypedDict):
    key: str
    required: bool
    citations: list[Citation]


class Claim(TypedDict):
    id: str
    title: str
    state: str
    dimensions: list[Dimension]


class SpanResult(TypedDict):
    docId: str
    blob: str
    byteStart: int
    byteEnd: int
    docBytes: int
    line: int
    valid: bool
    reason: str
    text: str
    spanSha256: str


class Gap(TypedDict):
    dimension: str
    reason: str


class Span(TypedDict):
    dimension: str
    docId: str
    blob: str
    byteStart: int
    byteEnd: int
    line: int
    valid: bool
    reason: str
    text: str


class Verdict(TypedDict):
    claimId: str
    verdict: str
    dimensionsTotal: int
    dimensionsRequired: int
    dimensionsCovered: int
    coverage: float
    citationsChecked: int
    citationsValid: int
    citationsInvalid: int
    attestedOver: list[str]
    root: str
    gaps: list[Gap]
    spans: list[Span]


class Decision(TypedDict):
    ok: bool
    fromState: str
    toState: str
    legal: list[str]
    gated: list[str]
    reason: str


# ---------------------------------------------------------------- shape guards


def _require_claim(payload: Any) -> Claim:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", "expected an object with a 'claim'")
    claim = payload.get("claim")
    if not isinstance(claim, dict):
        raise EngineError("BAD_SHAPE", "'claim' must be an object")
    for key in ("id", "title", "state", "dimensions"):
        if key not in claim:
            raise EngineError("MISSING_FIELD", f"claim is missing {key!r}")
    if not isinstance(claim["id"], str) or not claim["id"]:
        raise EngineError("BAD_SHAPE", "claim.id must be a non-empty string")
    if not isinstance(claim["title"], str):
        raise EngineError("BAD_SHAPE", "claim.title must be a string")
    if claim["state"] not in STATES:
        raise EngineError("BAD_STATE", f"unknown claim state {claim['state']!r}; expected one of "
                          + ", ".join(STATES))
    dimensions = claim["dimensions"]
    if not isinstance(dimensions, list):
        raise EngineError("BAD_SHAPE", "claim.dimensions must be an array")

    seen: set[str] = set()
    for index, dimension in enumerate(dimensions):
        if not isinstance(dimension, dict):
            raise EngineError("BAD_SHAPE", f"claim.dimensions[{index}] must be an object")
        key = dimension.get("key")
        if not isinstance(key, str) or not key:
            raise EngineError("BAD_SHAPE", f"claim.dimensions[{index}].key must be a non-empty string")
        if key in seen:
            raise EngineError("DUPLICATE_DIMENSION", f"dimension {key!r} appears more than once")
        seen.add(key)
        if not isinstance(dimension.get("required"), bool):
            raise EngineError("BAD_SHAPE", f"claim.dimensions[{index}].required must be a boolean")
        citations = dimension.get("citations")
        if not isinstance(citations, list):
            raise EngineError("BAD_SHAPE", f"claim.dimensions[{index}].citations must be an array")
        for position, citation in enumerate(citations):
            if not isinstance(citation, dict):
                raise EngineError(
                    "BAD_SHAPE", f"claim.dimensions[{index}].citations[{position}] must be an object"
                )
            for field in ("docId", "byteStart", "byteEnd"):
                if field not in citation:
                    raise EngineError(
                        "MISSING_FIELD",
                        f"claim.dimensions[{index}].citations[{position}] is missing {field!r}",
                    )
            if not isinstance(citation["docId"], str) or not citation["docId"]:
                raise EngineError(
                    "BAD_SHAPE",
                    f"claim.dimensions[{index}].citations[{position}].docId must be a string",
                )
            for field in ("byteStart", "byteEnd"):
                if not isinstance(citation[field], int) or isinstance(citation[field], bool):
                    raise EngineError(
                        "BAD_SHAPE",
                        f"claim.dimensions[{index}].citations[{position}].{field} must be an integer",
                    )
            expects = citation.get("expects")
            if expects is not None and not isinstance(expects, str):
                raise EngineError(
                    "BAD_SHAPE",
                    f"claim.dimensions[{index}].citations[{position}].expects must be a string",
                )
    return claim  # type: ignore[return-value]


# ---------------------------------------------------------------- span verification


def check_span(
    data: bytes,
    starts: list[int],
    doc_id: str,
    blob: str,
    byte_start: int,
    byte_end: int,
    expected: str | None,
) -> SpanResult:
    """Verify one byte range against one document. Never raises for a bad range.

    A citation that cannot be resolved is a *finding*, not an exception: "this claim points
    at bytes that do not exist" is exactly what the audit exists to surface.
    """
    doc_bytes = len(data)

    def failure(reason: str, text: str = "") -> SpanResult:
        return {
            "docId": doc_id,
            "blob": blob,
            "byteStart": byte_start,
            "byteEnd": byte_end,
            "docBytes": doc_bytes,
            "line": line_of(starts, max(byte_start, 0)) if doc_bytes else 0,
            "valid": False,
            "reason": reason,
            "text": text,
            "spanSha256": "",
        }

    if byte_start < 0 or byte_end < 0:
        return failure("negative-offset")
    if byte_end <= byte_start:
        return failure("empty-span")
    if byte_start >= doc_bytes:
        return failure("span-past-end")
    if byte_end > doc_bytes:
        return failure("span-past-end")

    chunk = data[byte_start:byte_end]
    try:
        text = chunk.decode("utf-8")
    except UnicodeDecodeError:
        return failure("not-utf8")

    if not text.strip():
        return failure("blank-span", text)
    if expected is not None and expected not in text:
        return failure("text-mismatch", text)

    return {
        "docId": doc_id,
        "blob": blob,
        "byteStart": byte_start,
        "byteEnd": byte_end,
        "docBytes": doc_bytes,
        "line": line_of(starts, byte_start),
        "valid": True,
        "reason": "ok",
        "text": text,
        "spanSha256": _sha256_hex(chunk),
    }


def _sha256_hex(chunk: bytes) -> str:
    return hashlib.sha256(chunk).hexdigest()


def verify_span(payload: Any) -> SpanResult:
    """Engine op: verify a single citation against a single document."""
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", "expected an object")
    doc = payload.get("doc")
    if not isinstance(doc, dict):
        raise EngineError("BAD_SHAPE", "'doc' must be an object")
    for key in ("docId", "text"):
        if key not in doc:
            raise EngineError("MISSING_FIELD", f"doc is missing {key!r}")
    if not isinstance(doc["text"], str):
        raise EngineError("BAD_SHAPE", "doc.text must be a string")
    doc_id = doc["docId"] if isinstance(doc["docId"], str) else ""
    if not doc_id:
        raise EngineError("BAD_SHAPE", "doc.docId must be a non-empty string")

    text = doc["text"]
    blob = doc.get("blob") if isinstance(doc.get("blob"), str) else blob_for(text)
    byte_start = payload.get("byteStart")
    byte_end = payload.get("byteEnd")
    if not isinstance(byte_start, int) or isinstance(byte_start, bool):
        raise EngineError("BAD_SHAPE", "'byteStart' must be an integer")
    if not isinstance(byte_end, int) or isinstance(byte_end, bool):
        raise EngineError("BAD_SHAPE", "'byteEnd' must be an integer")
    expected = payload.get("expected")
    if expected is not None and not isinstance(expected, str):
        raise EngineError("BAD_SHAPE", "'expected' must be a string when present")

    data = text.encode("utf-8")
    return check_span(data, line_starts(data), doc_id, blob, byte_start, byte_end, expected)


# ---------------------------------------------------------------- evaluation


def evaluate_claim(payload: Any) -> Verdict:
    """Engine op: decide how much of a claim the evidence actually backs.

    The verdict is a function of bytes only. A required dimension is covered when at least
    one of its citations resolves to real, non-blank, UTF-8 text in a document that was
    supplied -- and `attestedOver` lists exactly the blobs the answer rests on, so the
    Merkle root returned here is an attestation over that precise set rather than over
    whatever happened to be in the folder.
    """
    claim = _require_claim(payload)
    docs = payload.get("docs")
    if docs is None:
        docs = []
    if not isinstance(docs, list):
        raise EngineError("BAD_SHAPE", "'docs' must be an array")

    corpus: dict[str, tuple[str, bytes, list[int]]] = {}
    for index, doc in enumerate(docs):
        if not isinstance(doc, dict):
            raise EngineError("BAD_SHAPE", f"docs[{index}] must be an object")
        doc_id = doc.get("docId")
        text = doc.get("text")
        if not isinstance(doc_id, str) or not doc_id:
            raise EngineError("BAD_SHAPE", f"docs[{index}].docId must be a non-empty string")
        if not isinstance(text, str):
            raise EngineError("BAD_SHAPE", f"docs[{index}].text must be a string")
        if doc_id in corpus:
            raise EngineError("DUPLICATE_DOC", f"docId {doc_id!r} appears more than once")
        blob = doc.get("blob") if isinstance(doc.get("blob"), str) else blob_for(text)
        data = text.encode("utf-8")
        corpus[doc_id] = (blob, data, line_starts(data))

    spans: list[Span] = []
    gaps: list[Gap] = []
    checked = 0
    valid = 0
    cited_docs: set[str] = set()
    required_total = 0
    required_covered = 0
    total_dimensions = 0
    covered_dimensions = 0

    for dimension in claim["dimensions"]:
        total_dimensions += 1
        key = dimension["key"]
        required = dimension["required"]
        if required:
            required_total += 1

        dimension_valid = 0
        for citation in dimension["citations"]:
            checked += 1
            doc_id = citation["docId"]
            entry = corpus.get(doc_id)
            if entry is None:
                result: SpanResult = {
                    "docId": doc_id,
                    "blob": "",
                    "byteStart": citation["byteStart"],
                    "byteEnd": citation["byteEnd"],
                    "docBytes": 0,
                    "line": 0,
                    "valid": False,
                    "reason": "unknown-document",
                    "text": "",
                    "spanSha256": "",
                }
            else:
                blob, data, starts = entry
                expects = citation.get("expects")
                result = check_span(
                    data,
                    starts,
                    doc_id,
                    blob,
                    citation["byteStart"],
                    citation["byteEnd"],
                    expects if isinstance(expects, str) else None,
                )
            if result["valid"]:
                valid += 1
                dimension_valid += 1
                cited_docs.add(doc_id)
            spans.append(
                {
                    "dimension": key,
                    "docId": result["docId"],
                    "blob": result["blob"],
                    "byteStart": result["byteStart"],
                    "byteEnd": result["byteEnd"],
                    "line": result["line"],
                    "valid": result["valid"],
                    "reason": result["reason"],
                    "text": result["text"],
                }
            )

        if dimension_valid > 0:
            covered_dimensions += 1
            if required:
                required_covered += 1
        else:
            gaps.append(
                {
                    "dimension": key,
                    "reason": "no-citation"
                    if not dimension["citations"]
                    else "all-citations-unresolvable",
                }
            )

    attested_over = sorted(cited_docs)
    if required_total == 0:
        verdict = "unsubstantiated"
    elif required_covered == required_total and valid == checked:
        verdict = "attestable"
    elif required_covered > 0:
        verdict = "partial"
    else:
        verdict = "unsubstantiated"

    coverage = round(required_covered / required_total, _COVERAGE_SCALE) if required_total else 0.0

    # The root covers exactly the documents the verdict depends on.
    root = reduce_root(_index_for(attested_over, corpus)) if attested_over else reduce_root(
        {"version": 1, "terms": {}, "docBytes": {}}
    )

    return {
        "claimId": claim["id"],
        "verdict": verdict,
        "dimensionsTotal": total_dimensions,
        "dimensionsRequired": required_total,
        "dimensionsCovered": covered_dimensions,
        "coverage": coverage,
        "citationsChecked": checked,
        "citationsValid": valid,
        "citationsInvalid": checked - valid,
        "attestedOver": attested_over,
        "root": root,
        "gaps": gaps,
        "spans": spans,
    }


def _index_for(doc_ids: list[str], corpus: dict[str, tuple[str, bytes, list[int]]]) -> Any:
    """A minimal inverted index over just the cited documents."""
    documents = {}
    for doc_id in doc_ids:
        blob, data, _ = corpus[doc_id]
        documents[doc_id] = index_document(doc_id, blob, data.decode("utf-8"))
    return merge(documents)


# ---------------------------------------------------------------- state machine


def legal_targets(state: str) -> list[str]:
    return list(TRANSITIONS.get(state, ()))


def transition(payload: Any) -> Decision:
    """Engine op: decide whether a claim may move to a new state.

    Refuses in four cases, each with its own reason: an unknown state, an unlisted
    transition, a self-transition, and a transition whose gate is not satisfied. The
    `attested` gate is the one that matters -- a claim whose required dimensions are not all
    backed cannot be attested, no matter who asks.
    """
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", "expected an object")
    claim = payload.get("claim")
    if not isinstance(claim, dict):
        raise EngineError("BAD_SHAPE", "'claim' must be an object")
    state = claim.get("state")
    if not isinstance(state, str) or state not in TRANSITIONS:
        raise EngineError("BAD_STATE", f"unknown claim state {state!r}; expected one of "
                          + ", ".join(STATES))
    to = payload.get("to")
    if not isinstance(to, str) or not to:
        raise EngineError("BAD_SHAPE", "'to' must be a non-empty string")

    legal = legal_targets(state)
    gated = [name for name in legal if name in GATED]

    def refuse(reason: str) -> Decision:
        return {
            "ok": False,
            "fromState": state,
            "toState": to,
            "legal": legal,
            "gated": gated,
            "reason": reason,
        }

    if to not in STATES:
        return refuse(f"unknown state {to!r}; expected one of " + ", ".join(STATES))
    if to == state:
        return refuse(f"already in state {state!r}; a transition must change the state")
    if to not in legal:
        return refuse(f"{state} -> {to} is not a legal transition; from {state} the legal "
                      f"targets are " + (", ".join(legal) or "(none)"))

    if to == "attested":
        verdict = payload.get("verdict")
        if not isinstance(verdict, dict):
            return refuse("attested requires an evaluated verdict; run the claim through "
                          "evidence_evaluate first")
        actual = verdict.get("verdict")
        if actual != "attestable":
            detail = ""
            if isinstance(verdict.get("gaps"), list):
                names = [g.get("dimension") for g in verdict["gaps"] if isinstance(g, dict)]
                named = [n for n in names if isinstance(n, str)]
                if named:
                    detail = " (unbacked: " + ", ".join(named) + ")"
            return refuse(f"verdict is {actual!r}, not 'attestable'{detail}")

    if to == "withdrawn":
        note = payload.get("note")
        if not isinstance(note, str) or not note.strip():
            return refuse("withdrawn requires a non-empty note saying why")

    return {"ok": True, "fromState": state, "toState": to, "legal": legal, "gated": gated,
            "reason": "ok"}


def lifecycle() -> dict[str, Any]:
    """Engine op: the whole lifecycle as data, so a UI never has to hardcode it."""
    return {
        "states": list(STATES),
        "transitions": {key: list(value) for key, value in TRANSITIONS.items()},
        "gates": dict(GATED),
        "verdicts": list(VERDICTS),
    }