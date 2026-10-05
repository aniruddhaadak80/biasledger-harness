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


class Document(TypedDict):
    """One evidence artifact, decoded once.

    The byte buffer and its line table are computed per document rather than per citation: a
    claim with forty citations against one document should decode that document once.
    """

    doc_id: str
    blob: str
    data: bytes
    starts: list[int]


def make_document(doc_id: str, blob: str, text: str) -> Document:
    data = text.encode("utf-8")
    return {"doc_id": doc_id, "blob": blob, "data": data, "starts": line_starts(data)}


def missing_document(doc_id: str, byte_start: int, byte_end: int) -> SpanResult:
    """The result for a citation pointing at a document that was not supplied."""
    return {
        "docId": doc_id,
        "blob": "",
        "byteStart": byte_start,
        "byteEnd": byte_end,
        "docBytes": 0,
        "line": 0,
        "valid": False,
        "reason": "unknown-document",
        "text": "",
        "spanSha256": "",
    }


# ---------------------------------------------------------------- shape guards


def _require_claim(payload: Any) -> Claim:  # noqa: PLR0912
    """Validate an untrusted claim record against the engine's contract.

    The branch count is inherent: this walks a nested, untrusted document and every distinct
    failure gets its own code and its own message, because the message is what a reviewer reads
    when a claim will not load. Compressing the checks into a loop would lose the field paths
    that make the error actionable.
    """
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", "expected an object with a 'claim'")
    claim = payload.get("claim")
    if not isinstance(claim, dict):
        raise EngineError("BAD_SHAPE", "'claim' must be an object")
    for field in ("id", "title", "state", "dimensions"):
        if field not in claim:
            raise EngineError("MISSING_FIELD", f"claim is missing {field!r}")
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
            raise EngineError(
                "BAD_SHAPE", f"claim.dimensions[{index}].key must be a non-empty string"
            )
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


def check_span(  # noqa: PLR0911
    document: Document, byte_start: int, byte_end: int, expected: str | None
) -> SpanResult:
    """Verify one byte range against one document. Never raises for a bad range.

    A citation that cannot be resolved is a *finding*, not an exception: "this claim points
    at bytes that do not exist" is exactly what the audit exists to surface.

    One early return per failure reason, deliberately. The reasons are a closed vocabulary that
    the board colours and the tests assert on, so each is a named exit rather than a branch
    folded into a single accumulating result.
    """
    data = document["data"]
    doc_id = document["doc_id"]
    blob = document["blob"]
    starts = document["starts"]
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
    supplied_blob = doc.get("blob")
    blob = supplied_blob if isinstance(supplied_blob, str) else blob_for(text)
    byte_start = payload.get("byteStart")
    byte_end = payload.get("byteEnd")
    if not isinstance(byte_start, int) or isinstance(byte_start, bool):
        raise EngineError("BAD_SHAPE", "'byteStart' must be an integer")
    if not isinstance(byte_end, int) or isinstance(byte_end, bool):
        raise EngineError("BAD_SHAPE", "'byteEnd' must be an integer")
    expected = payload.get("expected")
    if expected is not None and not isinstance(expected, str):
        raise EngineError("BAD_SHAPE", "'expected' must be a string when present")

    return check_span(
        make_document(doc_id, blob, text),
        byte_start,
        byte_end,
        expected if isinstance(expected, str) else None,
    )


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
    corpus = _load_corpus(payload.get("docs"))
    tally = _evaluate_dimensions(claim, corpus)

    verdict = _classify(tally)
    coverage = (
        round(tally["required_covered"] / tally["required_total"], _COVERAGE_SCALE)
        if tally["required_total"]
        else 0.0
    )

    # The root covers exactly the documents the verdict depends on -- not the whole folder.
    root = reduce_root(_index_for(tally["cited_docs"], corpus))

    return {
        "claimId": claim["id"],
        "verdict": verdict,
        "dimensionsTotal": tally["total_dimensions"],
        "dimensionsRequired": tally["required_total"],
        "dimensionsCovered": tally["covered_dimensions"],
        "coverage": coverage,
        "citationsChecked": tally["checked"],
        "citationsValid": tally["valid"],
        "citationsInvalid": tally["checked"] - tally["valid"],
        "attestedOver": tally["attested_over"],
        "root": root,
        "gaps": tally["gaps"],
        "spans": tally["spans"],
    }


def _load_corpus(docs: Any) -> dict[str, Document]:
    """Decode every supplied document once.

    Each document is decoded a single time, so a claim with many citations against the same
    artifact does not re-encode it per citation.
    """
    if docs is None:
        docs = []
    if not isinstance(docs, list):
        raise EngineError("BAD_SHAPE", "'docs' must be an array")

    corpus: dict[str, Document] = {}
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
        supplied = doc.get("blob")
        blob = supplied if isinstance(supplied, str) else blob_for(text)
        corpus[doc_id] = make_document(doc_id, blob, text)
    return corpus


class Tally(TypedDict):
    """Everything the verdict is derived from, accumulated in one pass over the claim."""

    total_dimensions: int
    required_total: int
    covered_dimensions: int
    required_covered: int
    checked: int
    valid: int
    cited_docs: list[str]
    attested_over: list[str]
    gaps: list[Gap]
    spans: list[Span]


def _resolve_citation(citation: Citation, corpus: dict[str, Document]) -> SpanResult:
    """Resolve one citation, or explain why it cannot be resolved."""
    doc_id = citation["docId"]
    document = corpus.get(doc_id)
    if document is None:
        return missing_document(doc_id, citation["byteStart"], citation["byteEnd"])
    expects = citation.get("expects")
    return check_span(
        document,
        citation["byteStart"],
        citation["byteEnd"],
        expects if isinstance(expects, str) else None,
    )


def _evaluate_dimensions(claim: Claim, corpus: dict[str, Document]) -> Tally:
    """One pass over the claim, resolving every citation exactly once."""
    tally: Tally = {
        "total_dimensions": 0,
        "required_total": 0,
        "covered_dimensions": 0,
        "required_covered": 0,
        "checked": 0,
        "valid": 0,
        "cited_docs": [],
        "attested_over": [],
        "gaps": [],
        "spans": [],
    }
    cited: set[str] = set()

    for dimension in claim["dimensions"]:
        tally["total_dimensions"] += 1
        key = dimension["key"]
        required = dimension["required"]
        if required:
            tally["required_total"] += 1

        dimension_valid = 0
        for citation in dimension["citations"]:
            tally["checked"] += 1
            result = _resolve_citation(citation, corpus)
            if result["valid"]:
                tally["valid"] += 1
                dimension_valid += 1
                cited.add(citation["docId"])
            tally["spans"].append(
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
            tally["covered_dimensions"] += 1
            if required:
                tally["required_covered"] += 1
        else:
            tally["gaps"].append(
                {
                    "dimension": key,
                    "reason": "no-citation"
                    if not dimension["citations"]
                    else "all-citations-unresolvable",
                }
            )

    tally["cited_docs"] = sorted(cited)
    tally["attested_over"] = sorted(cited)
    return tally


def _classify(tally: Tally) -> str:
    """The verdict, as a pure function of the tally.

    `attestable` requires every required dimension covered AND no invalid citation anywhere.
    The second condition is stricter than it looks and is deliberate: a claim that happens to
    have all its required dimensions backed but also carries one broken citation is not a
    claim whose evidence is intact.
    """
    if tally["required_total"] == 0:
        return "unsubstantiated"
    if tally["required_covered"] == tally["required_total"] and tally["valid"] == tally["checked"]:
        return "attestable"
    if tally["required_covered"] > 0:
        return "partial"
    return "unsubstantiated"



def _index_for(doc_ids: list[str], corpus: dict[str, Document]) -> Any:
    """A minimal inverted index over just the cited documents."""
    documents = {}
    for doc_id in doc_ids:
        document = corpus[doc_id]
        documents[doc_id] = index_document(
            doc_id, document["blob"], document["data"].decode("utf-8")
        )
    return merge(documents)


# ---------------------------------------------------------------- state machine


def legal_targets(state: str) -> list[str]:
    return list(TRANSITIONS.get(state, ()))


def transition(payload: Any) -> Decision:  # noqa: PLR0911, PLR0912
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
