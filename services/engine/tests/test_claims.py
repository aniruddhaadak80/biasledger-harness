from __future__ import annotations

import json
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from biasledger_harness.claims import (
    STATES,
    TRANSITIONS,
    evaluate_claim,
    lifecycle,
    transition,
    verify_span,
)
from biasledger_harness.index import blob_for, reduce_manifest
from biasledger_harness.protocol import EngineError

CARD = "Triage model card.\nCalibration error is 0.031 across all groups.\n"
REPORT = "Calibration report.\nGroup A ECE 0.028, group B ECE 0.034.\n"


def doc(doc_id: str, text: str) -> dict[str, object]:
    return {"docId": doc_id, "blob": blob_for(text), "text": text}


def citation(doc_id: str, start: int, end: int, expects: str | None = None) -> dict[str, object]:
    base: dict[str, object] = {"docId": doc_id, "byteStart": start, "byteEnd": end}
    if expects is not None:
        base["expects"] = expects
    return base


def claim(*dimensions: dict[str, object], state: str = "evidenced") -> dict[str, object]:
    return {
        "id": "triage-calibration",
        "title": "Calibration is equal across groups",
        "state": state,
        "dimensions": list(dimensions),
    }


def dimension(key: str, *citations: dict[str, object], required: bool = True) -> dict[str, object]:
    return {"key": key, "required": required, "citations": list(citations)}


CARD_BYTES = CARD.encode("utf-8")


def card_span(needle: str) -> tuple[int, int]:
    start = CARD.index(needle)
    return start, start + len(needle)


class TestVerifySpan:
    def test_a_real_range_resolves(self) -> None:
        start, end = card_span("0.031")
        result = verify_span({"doc": doc("card", CARD), "byteStart": start, "byteEnd": end})
        assert result["valid"] is True
        assert result["reason"] == "ok"
        assert result["text"] == "0.031"
        assert result["blob"] == blob_for(CARD)
        assert result["line"] == 2

    def test_the_span_hash_is_a_position_independent_attestation(self) -> None:
        start, end = card_span("0.031")
        here = verify_span({"doc": doc("card", CARD), "byteStart": start, "byteEnd": end})
        elsewhere = verify_span({"doc": doc("other", "x" * start + "0.031"), "byteStart": start,
                                 "byteEnd": end})
        assert here["spanSha256"] == elsewhere["spanSha256"] != ""

    def test_a_range_past_the_end_is_refused_not_raised(self) -> None:
        result = verify_span({"doc": doc("card", CARD), "byteStart": 0, "byteEnd": 10_000})
        assert result["valid"] is False
        assert result["reason"] == "span-past-end"

    def test_a_negative_offset_is_refused(self) -> None:
        result = verify_span({"doc": doc("card", CARD), "byteStart": -1, "byteEnd": 4})
        assert result["reason"] == "negative-offset"

    def test_an_empty_range_is_refused(self) -> None:
        result = verify_span({"doc": doc("card", CARD), "byteStart": 4, "byteEnd": 4})
        assert result["reason"] == "empty-span"

    def test_whitespace_only_is_a_blank_span(self) -> None:
        # The newline that ends the first line of the card is at byte 18.
        result = verify_span({"doc": doc("card", CARD), "byteStart": 18, "byteEnd": 19})
        assert result["valid"] is False
        assert result["reason"] == "blank-span"

    def test_a_range_splitting_a_multibyte_character_is_not_utf8(self) -> None:
        # "café" is five bytes; bytes 4..5 is the trailing half of the two-byte é.
        result = verify_span({"doc": doc("x", "café"), "byteStart": 4, "byteEnd": 5})
        assert result["valid"] is False
        assert result["reason"] == "not-utf8"

    def test_expected_text_must_be_present(self) -> None:
        start, end = card_span("0.031")
        ok = verify_span({"doc": doc("card", CARD), "byteStart": start, "byteEnd": end,
                          "expected": "0.03"})
        bad = verify_span({"doc": doc("card", CARD), "byteStart": start, "byteEnd": end,
                           "expected": "0.99"})
        assert ok["valid"] is True
        assert bad["valid"] is False
        assert bad["reason"] == "text-mismatch"

    def test_rejects_a_non_integer_range(self) -> None:
        with pytest.raises(EngineError) as caught:
            verify_span({"doc": doc("card", CARD), "byteStart": "0", "byteEnd": 4})
        assert caught.value.code == "BAD_SHAPE"

    def test_rejects_a_missing_document(self) -> None:
        with pytest.raises(EngineError) as caught:
            verify_span({"byteStart": 0, "byteEnd": 4})
        assert caught.value.code == "BAD_SHAPE"


class TestEvaluateClaim:
    def test_a_fully_backed_claim_is_attestable(self) -> None:
        start, end = card_span("0.031")
        verdict = evaluate_claim(
            {"claim": claim(dimension("calibration", citation("card", start, end))),
             "docs": [doc("card", CARD)]}
        )
        assert verdict["verdict"] == "attestable"
        assert verdict["coverage"] == 1.0
        assert verdict["citationsInvalid"] == 0
        assert verdict["gaps"] == []
        assert verdict["attestedOver"] == ["card"]

    def test_a_missing_citation_is_a_named_gap(self) -> None:
        verdict = evaluate_claim(
            {"claim": claim(dimension("calibration", citation("card", 0, 999_999))),
             "docs": [doc("card", CARD)]}
        )
        assert verdict["verdict"] == "unsubstantiated"
        assert verdict["gaps"] == [{"dimension": "calibration",
                                    "reason": "all-citations-unresolvable"}]

    def test_an_uncited_dimension_is_a_gap(self) -> None:
        verdict = evaluate_claim({"claim": claim(dimension("consent")), "docs": []})
        assert verdict["gaps"] == [{"dimension": "consent", "reason": "no-citation"}]

    def test_an_unknown_document_is_a_gap(self) -> None:
        verdict = evaluate_claim(
            {"claim": claim(dimension("calibration", citation("nope", 0, 4))), "docs": []}
        )
        assert verdict["verdict"] == "unsubstantiated"
        assert verdict["spans"][0]["reason"] == "unknown-document"

    def test_partial_coverage_is_partial_not_attestable(self) -> None:
        start, end = card_span("0.031")
        verdict = evaluate_claim(
            {"claim": claim(
                dimension("calibration", citation("card", start, end)),
                dimension("consent"),
            ),
             "docs": [doc("card", CARD)]}
        )
        assert verdict["verdict"] == "partial"
        assert verdict["coverage"] == 0.5
        assert verdict["dimensionsRequired"] == 2
        assert verdict["dimensionsCovered"] == 1

    def test_optional_dimensions_do_not_affect_the_verdict(self) -> None:
        start, end = card_span("0.031")
        verdict = evaluate_claim(
            {"claim": claim(
                dimension("calibration", citation("card", start, end)),
                dimension("latency", required=False),
            ),
             "docs": [doc("card", CARD)]}
        )
        assert verdict["verdict"] == "attestable"
        assert verdict["dimensionsRequired"] == 1
        assert verdict["coverage"] == 1.0

    def test_a_claim_with_no_required_dimensions_is_unsubstantiated(self) -> None:
        verdict = evaluate_claim({"claim": claim(dimension("x", required=False)), "docs": []})
        assert verdict["verdict"] == "unsubstantiated"
        assert verdict["coverage"] == 0.0

    def test_the_root_covers_only_the_cited_documents(self) -> None:
        start, end = card_span("0.031")
        payload = {"claim": claim(dimension("calibration", citation("card", start, end))),
                   "docs": [doc("card", CARD), doc("report", REPORT)]}
        with_extra = evaluate_claim(payload)
        without_extra = evaluate_claim({**payload, "docs": [doc("card", CARD)]})
        assert with_extra["root"] == without_extra["root"]
        assert with_extra["attestedOver"] == ["card"]

    def test_the_root_changes_when_a_cited_byte_changes(self) -> None:
        start, end = card_span("0.031")
        before = evaluate_claim(
            {"claim": claim(dimension("calibration", citation("card", start, end))),
             "docs": [doc("card", CARD)]}
        )
        edited = CARD.replace("0.031", "0.032")
        after = evaluate_claim(
            {"claim": claim(dimension("calibration", citation("card", start, end))),
             "docs": [doc("card", edited)]}
        )
        assert before["root"] != after["root"]

    def test_the_blob_is_carried_onto_each_span(self) -> None:
        start, end = card_span("0.031")
        verdict = evaluate_claim(
            {"claim": claim(dimension("calibration", citation("card", start, end))),
             "docs": [doc("card", CARD)]}
        )
        assert verdict["spans"][0]["blob"] == blob_for(CARD)
        assert verdict["spans"][0]["line"] == 2

    def test_an_expectation_that_still_holds_passes(self) -> None:
        start, end = card_span("0.031")
        verdict = evaluate_claim(
            {"claim": claim(dimension("calibration",
                                      citation("card", start, end, expects="0.031"))),
             "docs": [doc("card", CARD)]}
        )
        assert verdict["verdict"] == "attestable"

    def test_a_document_edited_under_a_citation_is_a_text_mismatch(self) -> None:
        # The claim was written against v1, which promised a 30-day deletion. v2 was
        # rewritten to promise same-day deletion. The byte range still resolves, so only
        # the recorded expectation catches the drift.
        start, end = card_span("0.031")
        verdict = evaluate_claim(
            {"claim": claim(
                dimension("calibration", citation("card", start, end, expects="within 30 days")),
                dimension("deletion", citation("card", start, end)),
            ),
             "docs": [doc("card", CARD)]}
        )
        assert verdict["verdict"] == "partial"
        assert verdict["citationsInvalid"] == 1
        assert verdict["spans"][0]["reason"] == "text-mismatch"
        assert [gap["dimension"] for gap in verdict["gaps"]] == ["calibration"]

    def test_a_non_string_expectation_is_rejected(self) -> None:
        broken = claim(dimension("x", {"docId": "card", "byteStart": 0, "byteEnd": 2,
                                       "expects": 7}))
        with pytest.raises(EngineError) as caught:
            evaluate_claim({"claim": broken, "docs": []})
        assert caught.value.code == "BAD_SHAPE"

    def test_rejects_an_unknown_state(self) -> None:
        with pytest.raises(EngineError) as caught:
            evaluate_claim({"claim": claim(dimension("x"), state="vibes"), "docs": []})
        assert caught.value.code == "BAD_STATE"

    def test_rejects_a_duplicate_dimension(self) -> None:
        with pytest.raises(EngineError) as caught:
            evaluate_claim({"claim": claim(dimension("x"), dimension("x")), "docs": []})
        assert caught.value.code == "DUPLICATE_DIMENSION"

    def test_rejects_a_duplicate_document(self) -> None:
        with pytest.raises(EngineError) as caught:
            evaluate_claim({"claim": claim(dimension("x")), "docs": [doc("a", "1"),
                                                                    doc("a", "2")]})
        assert caught.value.code == "DUPLICATE_DOC"

    def test_rejects_a_boolean_offset(self) -> None:
        broken = claim(dimension("x", {"docId": "a", "byteStart": True, "byteEnd": 2}))
        with pytest.raises(EngineError) as caught:
            evaluate_claim({"claim": broken, "docs": []})
        assert caught.value.code == "BAD_SHAPE"

    @settings(max_examples=40, deadline=None)
    @given(st.lists(st.tuples(st.integers(0, 400), st.integers(0, 400)), max_size=6))
    def test_never_raises_on_arbitrary_ranges(self, spans: list[tuple[int, int]]) -> None:
        dimensions = [
            dimension(f"d{i}", citation("card", start, end)) for i, (start, end) in enumerate(spans)
        ]
        if not dimensions:
            dimensions = [dimension("d0", citation("card", 0, 0))]
        verdict = evaluate_claim({"claim": claim(*dimensions), "docs": [doc("card", CARD)]})
        assert verdict["citationsChecked"] == verdict["citationsValid"] + verdict["citationsInvalid"]
        assert 0.0 <= verdict["coverage"] <= 1.0

    @settings(max_examples=40, deadline=None)
    @given(st.lists(st.text(alphabet="abcdef \n", max_size=40), min_size=1, max_size=3,
                    unique=True))
    def test_evaluation_is_deterministic(self, corpus: list[str]) -> None:
        docs = [doc(f"d{i}", body) for i, body in enumerate(corpus)]
        dimensions = [dimension(f"k{i}", citation(f"d{i}", 0, max(1, len(body) // 2)))
                      for i, body in enumerate(corpus)]
        payload = {"claim": claim(*dimensions), "docs": docs}
        assert evaluate_claim(payload) == evaluate_claim(payload)


class TestTransition:
    def attestable_verdict(self) -> dict[str, object]:
        start, end = card_span("0.031")
        return evaluate_claim(
            {"claim": claim(dimension("calibration", citation("card", start, end))),
             "docs": [doc("card", CARD)]}
        )

    def test_a_legal_move_is_allowed(self) -> None:
        result = transition({"claim": claim(dimension("x"), state="unverified"),
                             "to": "evidenced"})
        assert result["ok"] is True
        assert result["fromState"] == "unverified"
        assert result["toState"] == "evidenced"

    def test_an_unlisted_move_is_refused_and_lists_the_legal_ones(self) -> None:
        result = transition({"claim": claim(dimension("x"), state="unverified"),
                             "to": "attested"})
        assert result["ok"] is False
        assert result["legal"] == ["evidenced", "withdrawn"]
        assert "not a legal transition" in result["reason"]

    def test_a_self_transition_is_refused(self) -> None:
        result = transition({"claim": claim(dimension("x"), state="evidenced"), "to": "evidenced"})
        assert result["ok"] is False
        assert "must change the state" in result["reason"]

    def test_an_unknown_target_state_is_refused(self) -> None:
        result = transition({"claim": claim(dimension("x")), "to": "vibes"})
        assert result["ok"] is False
        assert "unknown state" in result["reason"]

    def test_attested_requires_an_attestable_verdict(self) -> None:
        refused = transition({"claim": claim(dimension("x"), state="evidenced"), "to": "attested"})
        assert refused["ok"] is False
        assert "run the claim through evidence_evaluate" in refused["reason"]

        allowed = transition({"claim": claim(dimension("x"), state="evidenced"), "to": "attested",
                              "verdict": self.attestable_verdict()})
        assert allowed["ok"] is True

    def test_a_partial_verdict_cannot_be_attested_and_says_why(self) -> None:
        partial = evaluate_claim({"claim": claim(dimension("calibration"), dimension("consent")),
                                  "docs": []})
        result = transition({"claim": claim(dimension("x"), state="evidenced"), "to": "attested",
                             "verdict": partial})
        assert result["ok"] is False
        assert "not 'attestable'" in result["reason"]
        assert "unbacked" in result["reason"]

    def test_withdrawal_requires_a_note(self) -> None:
        bare = transition({"claim": claim(dimension("x"), state="evidenced"), "to": "withdrawn"})
        assert bare["ok"] is False
        assert "non-empty note" in bare["reason"]

        noted = transition({"claim": claim(dimension("x"), state="evidenced"), "to": "withdrawn",
                            "note": "superseded by the 2026 re-audit"})
        assert noted["ok"] is True

    def test_a_blank_note_does_not_count(self) -> None:
        result = transition({"claim": claim(dimension("x"), state="evidenced"),
                             "to": "withdrawn", "note": "   "})
        assert result["ok"] is False

    def test_gated_targets_are_reported(self) -> None:
        result = transition({"claim": claim(dimension("x"), state="evidenced"), "to": "challenged"})
        assert set(result["gated"]) == {"attested", "withdrawn"}

    def test_a_withdrawn_claim_can_only_be_reopened(self) -> None:
        result = transition({"claim": claim(dimension("x"), state="withdrawn"), "to": "evidenced"})
        assert result["ok"] is False
        assert result["legal"] == ["unverified"]

    def test_rejects_an_unknown_current_state(self) -> None:
        with pytest.raises(EngineError) as caught:
            transition({"claim": {"id": "a", "title": "t", "state": "vibes", "dimensions": []},
                        "to": "evidenced"})
        assert caught.value.code == "BAD_STATE"

    @settings(max_examples=200, deadline=None)
    @given(st.sampled_from(STATES), st.sampled_from(STATES + ("nonsense",)))
    def test_never_allows_an_unlisted_transition(self, source: str, target: str) -> None:
        result = transition({"claim": claim(dimension("x"), state=source), "to": target})
        legal = target in TRANSITIONS.get(source, ())
        if legal and result["ok"]:
            assert target != source
        elif not legal:
            assert result["ok"] is False


class TestLifecycle:
    def test_the_table_is_returned_as_data(self) -> None:
        table = lifecycle()
        assert table["states"] == list(STATES)
        assert table["transitions"]["unverified"] == ["evidenced", "withdrawn"]
        assert "attested" in table["gates"]

    def test_every_transition_source_is_a_known_state(self) -> None:
        for source in TRANSITIONS:
            assert source in STATES

    def test_every_transition_target_is_a_known_state(self) -> None:
        for targets in TRANSITIONS.values():
            for target in targets:
                assert target in STATES


class TestGoldenFile:
    """The anti-drift test: the shipped audit corpus must keep producing the shipped answers."""

    CORPUS = Path(__file__).resolve().parents[3] / "audit"

    def _corpus_docs(self) -> list[dict[str, object]]:
        return [
            doc(path.stem, path.read_text(encoding="utf-8"))
            for path in sorted((self.CORPUS / "evidence").glob("*.md"))
        ]

    def test_the_committed_index_still_matches_a_fresh_evaluation(self) -> None:
        golden = json.loads((self.CORPUS / "index.json").read_text(encoding="utf-8"))
        docs = self._corpus_docs()

        for claim_path in sorted((self.CORPUS / "claims").glob("*.json")):
            claim_doc = json.loads(claim_path.read_text(encoding="utf-8"))
            verdict = evaluate_claim({"claim": claim_doc, "docs": docs})
            expected = golden["claims"][claim_doc["id"]]

            assert verdict["verdict"] == expected["verdict"], claim_doc["id"]
            assert verdict["root"] == expected["root"], claim_doc["id"]
            assert verdict["citationsValid"] == expected["citationsValid"], claim_doc["id"]
            assert verdict["citationsInvalid"] == expected["citationsInvalid"], claim_doc["id"]
            assert verdict["coverage"] == expected["coverage"], claim_doc["id"]
            # Full gap objects, not just the dimension names: the *reason* a dimension is a
            # gap is the finding, and a golden file that stored only names would let a
            # regression from "no citation" to "all citations unresolvable" through.
            assert verdict["gaps"] == expected["gaps"], claim_doc["id"]

    def test_the_committed_root_still_reduces_from_the_committed_manifest(self) -> None:
        golden = json.loads((self.CORPUS / "index.json").read_text(encoding="utf-8"))
        reduced = reduce_manifest({"manifest": golden["engineManifest"]})
        assert reduced["consistent"] is True
        assert reduced["root"] == golden["root"]

    def test_the_committed_blobs_still_match_the_corpus(self) -> None:
        # The index claims specific git blob ids. If an evidence file is edited without
        # re-running the index, this fails -- which is the drift the `root` command reports.
        golden = json.loads((self.CORPUS / "index.json").read_text(encoding="utf-8"))
        for path in sorted((self.CORPUS / "evidence").glob("*.md")):
            recorded = golden["docs"][path.stem]
            assert blob_for(path.read_text(encoding="utf-8")) == recorded["blob"], path.name