from __future__ import annotations

import hashlib
import io
import json
import subprocess
import sys
from pathlib import Path

import pytest

from biasledger_harness.__main__ import handle
from biasledger_harness.protocol import EngineError, dispatch, read_request, write_response


class TestReadRequest:
    def test_parses_a_valid_request(self) -> None:
        op, payload = read_request(io.StringIO('{"op":"summarize","input":{"records":[]}}'))
        assert op == "summarize"
        assert payload == {"records": []}

    @pytest.mark.parametrize(
        ("raw", "code"),
        [
            ("", "EMPTY_INPUT"),
            ("{not json", "BAD_JSON"),
            ("[1,2,3]", "BAD_SHAPE"),
            ('{"input":1}', "MISSING_OP"),
            ('{"op":"","input":1}', "MISSING_OP"),
        ],
    )
    def test_rejects_malformed_input_with_a_stable_code(self, raw: str, code: str) -> None:
        with pytest.raises(EngineError) as caught:
            read_request(io.StringIO(raw))
        assert caught.value.code == code


class TestWriteResponse:
    def test_writes_exactly_one_line_of_json(self) -> None:
        buffer = io.StringIO()
        write_response({"ok": True, "value": {"a": 1}, "durationMs": 2}, stream=buffer)
        lines = buffer.getvalue().strip().split("\n")
        assert len(lines) == 1
        assert json.loads(lines[0]) == {"ok": True, "value": {"a": 1}, "durationMs": 2}

    def test_writes_an_error_response_without_raising(self) -> None:
        buffer = io.StringIO()
        write_response(
            {"ok": False, "error": {"code": "X", "message": "y"}, "durationMs": 0},
            stream=buffer,
        )
        assert json.loads(buffer.getvalue())["ok"] is False


class TestDispatch:
    def test_routes_to_a_handler(self) -> None:
        assert dispatch({"echo": lambda payload: payload}, "echo", 7) == 7

    def test_unknown_op_names_the_available_ones(self) -> None:
        with pytest.raises(EngineError) as caught:
            dispatch({}, "nope", None)
        assert caught.value.code == "UNKNOWN_OP"
        assert "available" in caught.value.message


class TestHandle:
    def test_handle_routes_to_the_real_operations(self) -> None:
        assert handle("summarize", {"records": []})["total"] == 0

    def test_unknown_operation_is_an_error_not_a_crash(self) -> None:
        with pytest.raises(EngineError) as caught:
            handle("nope", None)
        assert caught.value.code == "UNKNOWN_OP"

    def test_a_failing_handler_propagates_its_code(self) -> None:
        with pytest.raises(EngineError) as caught:
            handle("diff", {"before": "not-a-list", "after": []})
        assert caught.value.code == "BAD_SHAPE"


class TestSubprocessBoundary:
    """The transport itself, exercised the way the TypeScript host exercises it.

    This class exists because of a real bug. `sys.stdin` decodes with the platform locale
    (cp1252 on Windows), so a three-byte UTF-8 character became three characters and then six
    bytes on re-encode -- shifting every byte offset after it, silently, for the rest of the
    document. The unit tests all passed, because they inject a StringIO and never touch the
    locale. Only a real subprocess reproduces it.
    """

    @staticmethod
    def _run(payload: dict[str, object]) -> dict[str, object]:
        completed = subprocess.run(
            [sys.executable, "-m", "biasledger_harness"],
            input=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            capture_output=True,
            check=False,
            cwd=str(Path(__file__).resolve().parents[1] / "src"),
        )
        assert completed.stdout, completed.stderr.decode("utf-8", "replace")
        parsed: dict[str, object] = json.loads(completed.stdout.decode("utf-8"))
        assert parsed["ok"] is True, parsed
        value: dict[str, object] = parsed["value"]  # type: ignore[assignment]
        return value

    def test_byte_offsets_survive_a_multibyte_character(self) -> None:
        # An em dash sits before the cited range. Under a locale codec the offset shifts.
        text = "title — dash\nthen the cited phrase\n"
        needle = "the cited phrase"
        start = text.encode("utf-8").index(needle.encode("utf-8"))
        result = self._run(
            {
                "op": "verify_span",
                "input": {
                    "doc": {"docId": "d", "text": text},
                    "byteStart": start,
                    "byteEnd": start + len(needle.encode("utf-8")),
                    "expects": needle,
                },
            }
        )
        assert result["valid"] is True, result
        assert result["text"] == needle
        assert result["docBytes"] == len(text.encode("utf-8"))

    def test_the_response_carries_non_ascii_back_unchanged(self) -> None:
        result = self._run(
            {
                "op": "evaluate_claim",
                "input": {
                    "claim": {
                        "id": "c",
                        "title": "em — dash, naïve, 日本語",
                        "state": "evidenced",
                        "dimensions": [],
                    },
                    "docs": [],
                },
            }
        )
        assert result["claimId"] == "c"

    def test_a_blob_id_matches_the_one_computed_in_process(self) -> None:
        text = "Calibration — 0.031\n"
        result = self._run(
            {"op": "verify_span", "input": {"doc": {"docId": "d", "text": text},
                                            "byteStart": 0, "byteEnd": 13}}
        )
        expected = hashlib.sha1(
            f"blob {len(text.encode('utf-8'))}\0".encode("ascii") + text.encode("utf-8")
        ).hexdigest()
        assert result["blob"] == expected

    def test_invalid_utf8_is_rejected_rather_than_mangled(self) -> None:
        completed = subprocess.run(
            [sys.executable, "-m", "biasledger_harness"],
            input=b'{"op":"summarize","input":{"records":[],"x":"\xff\xfe"}}',
            capture_output=True,
            check=False,
            cwd=str(Path(__file__).resolve().parents[1] / "src"),
        )
        parsed = json.loads(completed.stdout.decode("utf-8"))
        assert parsed["ok"] is False
        assert parsed["error"]["code"] == "BAD_JSON"
