from __future__ import annotations

import hashlib

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from biasledger_harness.index import (
    EMPTY_ROOT,
    blob_for,
    build_index,
    index_document,
    line_of,
    line_starts,
    merge,
    reduce_root,
    tokenize,
)
from biasledger_harness.protocol import EngineError

TEXT = "Calibration by group.\nEqualized odds hold.\nSecond line here.\n"
DATA = TEXT.encode("utf-8")
#: Byte offsets of each line start, for the fixture above.
LINE_STARTS = [0, 22, 43, 61]


def doc(doc_id: str, text: str, blob: str | None = None) -> dict[str, object]:
    return {"docId": doc_id, "blob": blob if blob is not None else blob_for(text), "text": text}


class TestBlob:
    def test_matches_the_git_blob_id(self) -> None:
        # Independently constructed: "blob <byte length>\0" followed by the raw bytes.
        expected = hashlib.sha1(f"blob {len(DATA)}\0".encode("ascii") + DATA).hexdigest()
        assert blob_for(TEXT) == expected

    def test_changes_when_the_text_changes(self) -> None:
        assert blob_for("a") != blob_for("b")

    def test_is_multibyte_aware(self) -> None:
        text = "café"
        expected = hashlib.sha1(b"blob 5\x00" + "café".encode()).hexdigest()
        assert blob_for(text) == expected


class TestTokenizer:
    def test_spans_are_byte_exact(self) -> None:
        tokens = tokenize(DATA)
        assert [(raw.decode(), start, end) for raw, start, end in tokens][:3] == [
            ("Calibration", 0, 11),
            ("by", 12, 14),
            ("group", 15, 20),
        ]
        for raw, start, end in tokens:
            assert DATA[start:end] == raw

    def test_splits_on_punctuation_and_newlines(self) -> None:
        assert [raw.decode() for raw, _, _ in tokenize(b"a.b,c\nd")] == ["a", "b", "c", "d"]

    def test_empty_input_yields_no_tokens(self) -> None:
        assert tokenize(b"") == []

    def test_a_trailing_word_is_not_dropped(self) -> None:
        assert [raw.decode() for raw, _, _ in tokenize(b"end")] == ["end"]

    def test_underscore_is_part_of_a_word(self) -> None:
        assert [raw.decode() for raw, _, _ in tokenize(b"snake_case")] == ["snake_case"]

    def test_non_ascii_bytes_are_boundaries(self) -> None:
        # A multi-byte character must not be sliced into the middle of a span.
        tokens = tokenize("café bar".encode())
        assert [raw.decode() for raw, _, _ in tokens] == ["caf", "bar"]

    @settings(max_examples=50, deadline=None)
    @given(st.binary(max_size=200))
    def test_every_span_round_trips_to_its_source(self, data: bytes) -> None:
        for raw, start, end in tokenize(data):
            assert data[start:end] == raw
            assert start < end <= len(data)


class TestLines:
    def test_line_starts_are_derived_from_newlines(self) -> None:
        assert line_starts(DATA) == LINE_STARTS

    def test_first_line_is_one(self) -> None:
        assert line_of(line_starts(DATA), 0) == 1

    def test_offset_on_the_next_line(self) -> None:
        assert line_of(line_starts(DATA), 22) == 2

    def test_offset_on_the_third_line(self) -> None:
        assert line_of(line_starts(DATA), 45) == 3


class TestIndexDocument:
    def test_lowercases_terms_but_keeps_original_spans(self) -> None:
        indexed = index_document("a", "b" * 40, TEXT)
        assert "calibration" in indexed["terms"]
        posting = indexed["terms"]["calibration"][0]
        assert DATA[posting["start"] : posting["end"]] == b"Calibration"

    def test_byte_length_is_of_the_utf8_encoding(self) -> None:
        assert index_document("a", "b" * 40, "café")["bytes"] == 5

    def test_terms_are_sorted(self) -> None:
        indexed = index_document("a", "b" * 40, "zebra apple")
        assert list(indexed["terms"]) == ["apple", "zebra"]

    def test_repeated_terms_get_one_posting_each(self) -> None:
        indexed = index_document("a", "b" * 40, "gap gap")
        assert len(indexed["terms"]["gap"]) == 2

    def test_rejects_an_empty_doc_id(self) -> None:
        with pytest.raises(EngineError) as caught:
            index_document("", "b" * 40, "text")
        assert caught.value.code == "BAD_SHAPE"

    @settings(max_examples=25, deadline=None)
    @given(st.text(max_size=120))
    def test_is_deterministic(self, text: str) -> None:
        assert index_document("a", "b" * 40, text) == index_document("a", "b" * 40, text)


class TestMergeAndRoot:
    def test_merge_joins_documents_sorted_by_doc_then_offset(self) -> None:
        merged = merge(
            {
                "b": index_document("b", "b" * 40, "gap gap"),
                "a": index_document("a", "a" * 40, "gap"),
            }
        )
        assert [(row["docId"], row["start"]) for row in merged["terms"]["gap"]] == [
            ("a", 0),
            ("b", 0),
            ("b", 4),
        ]

    def test_merge_does_not_depend_on_document_order(self) -> None:
        a = index_document("a", "a" * 40, "alpha beta")
        b = index_document("b", "b" * 40, "beta gamma")
        assert merge({"a": a, "b": b}) == merge({"b": b, "a": a})

    def test_empty_index_reduces_to_the_empty_root(self) -> None:
        assert reduce_root({"version": 1, "terms": {}, "docBytes": {}}) == EMPTY_ROOT

    def test_root_changes_when_a_byte_offset_changes(self) -> None:
        before = reduce_root(merge({"a": index_document("a", "a" * 40, "gap gap")}))
        after = reduce_root(merge({"a": index_document("a", "a" * 40, "gap  gap")}))
        assert before != after

    def test_root_is_insensitive_to_posting_order(self) -> None:
        index = merge({"a": index_document("a", "a" * 40, "gap gap")})
        rows = list(index["terms"]["gap"])
        shuffled = dict(index)
        shuffled["terms"] = {**index["terms"], "gap": list(reversed(rows))}
        assert reduce_root(index) == reduce_root(shuffled)  # type: ignore[arg-type]

    @settings(max_examples=25, deadline=None)
    @given(st.lists(st.text(alphabet="abcdefgh ", max_size=40), min_size=1, max_size=4,
                    unique=True))
    def test_root_is_order_independent_across_the_corpus(self, corpus: list[str]) -> None:
        docs = [doc(f"d{i}", body) for i, body in enumerate(corpus)]
        forward = build_index({"docs": docs})["root"]
        backward = build_index({"docs": list(reversed(docs))})["root"]
        assert forward == backward


class TestBuildIndex:
    def test_reports_a_rebuild_when_there_is_no_manifest(self) -> None:
        result = build_index({"docs": [doc("a", TEXT)]})
        assert (result["rebuilt"], result["reused"], result["dropped"]) == (1, 0, [])

    def test_resuming_reuses_every_unchanged_document(self) -> None:
        docs = [doc("a", TEXT), doc("b", "other evidence")]
        first = build_index({"docs": docs})
        second = build_index({"docs": docs, "manifest": first["manifest"]})
        assert second["reused"] == 2
        assert second["rebuilt"] == 0
        assert second["root"] == first["root"]

    def test_resuming_is_idempotent(self) -> None:
        docs = [doc("a", TEXT)]
        first = build_index({"docs": docs})
        second = build_index({"docs": docs, "manifest": first["manifest"]})
        third = build_index({"docs": docs, "manifest": second["manifest"]})
        # The counters legitimately differ -- a resume reuses instead of rebuilding. What
        # must not change is the evidence: the index, the manifest, and above all the root.
        assert first["root"] == second["root"] == third["root"]
        assert first["index"] == second["index"] == third["index"]
        assert first["manifest"] == second["manifest"] == third["manifest"]

    def test_a_changed_blob_is_re_tokenized(self) -> None:
        docs = [doc("a", TEXT)]
        first = build_index({"docs": docs})
        changed = [doc("a", TEXT + "one more byte")]
        second = build_index({"docs": changed, "manifest": first["manifest"]})
        assert second["rebuilt"] == 1
        assert second["reused"] == 0
        assert second["root"] != first["root"]

    def test_a_stale_cache_entry_is_dropped(self) -> None:
        first = build_index({"docs": [doc("a", TEXT), doc("b", "gone")]})
        second = build_index({"docs": [doc("a", TEXT)], "manifest": first["manifest"]})
        assert second["dropped"] == ["b"]

    def test_a_corrupt_cache_entry_is_ignored_not_trusted(self) -> None:
        # A hand-edited manifest claims a doc was indexed, but the terms are junk. The
        # rebuild path must win on the next build because the blob no longer matches.
        manifest = {"version": 1, "docs": {"a": {"blob": "stale", "bytes": 1, "terms": {}}},
                    "root": "deadbeef"}
        result = build_index({"docs": [doc("a", TEXT)], "manifest": manifest})
        assert result["rebuilt"] == 1

    def test_rejects_a_duplicate_doc_id(self) -> None:
        with pytest.raises(EngineError) as caught:
            build_index({"docs": [doc("a", "one"), doc("a", "two")]})
        assert caught.value.code == "DUPLICATE_DOC"

    def test_rejects_a_blob_that_does_not_hash_the_text(self) -> None:
        # A stale blob with edited text would otherwise yield a self-consistent index over
        # the wrong bytes -- the exact failure the blob id exists to prevent.
        with pytest.raises(EngineError) as caught:
            build_index({"docs": [{"docId": "a", "blob": "0" * 40, "text": TEXT}]})
        assert caught.value.code == "BLOB_MISMATCH"
        assert "re-read the artifact" in caught.value.message

    def test_rejects_a_non_list(self) -> None:
        with pytest.raises(EngineError) as caught:
            build_index({"docs": "nope"})
        assert caught.value.code == "BAD_SHAPE"

    def test_rejects_a_missing_field(self) -> None:
        with pytest.raises(EngineError) as caught:
            build_index({"docs": [{"docId": "a", "blob": "b" * 40}]})
        assert caught.value.code == "MISSING_FIELD"

    def test_empty_corpus_has_the_empty_root(self) -> None:
        assert build_index({"docs": []})["root"] == EMPTY_ROOT

    @settings(max_examples=25, deadline=None)
    @given(st.lists(st.text(alphabet="abcdef ", max_size=40), min_size=1, max_size=4,
                    unique=True))
    def test_resume_never_changes_the_root(self, corpus: list[str]) -> None:
        docs = [doc(f"d{i}", body) for i, body in enumerate(corpus)]
        first = build_index({"docs": docs})
        resumed = build_index({"docs": docs, "manifest": first["manifest"]})
        assert first["root"] == resumed["root"]
