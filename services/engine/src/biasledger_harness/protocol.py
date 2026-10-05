"""The wire protocol between the TypeScript host and this engine.

One JSON object in on stdin, one JSON object out on stdout:

    {"op": "<operation>", "input": <any JSON value>}

    {"ok": true,  "value": <result>, "durationMs": 3}
    {"ok": false, "error": {"code": "<CODE>", "message": "<human readable>"}, "durationMs": 3}

Nothing else is ever written to stdout. Diagnostics go to stderr, so a caller can parse
stdout unconditionally.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from typing import Any, Final, TypedDict

MAX_INPUT_BYTES: Final[int] = 8 * 1024 * 1024


class EngineError(Exception):
    """An error with a stable code, so the host can map it to an exit code or HTTP status."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class SuccessResponse(TypedDict):
    ok: bool
    value: Any
    durationMs: int


class ErrorBody(TypedDict):
    code: str
    message: str


class ErrorResponse(TypedDict):
    ok: bool
    error: ErrorBody
    durationMs: int


Handler = Callable[[Any], Any]


def read_request(stream: Any = None) -> tuple[str, Any]:
    """Read and parse exactly one request. Raises EngineError on anything malformed.

    The real stdio path reads *bytes* and decodes UTF-8 explicitly. `sys.stdin`'s own text
    codec is the platform locale — cp1252 on Windows — which decodes a three-byte UTF-8
    character as three separate characters and then re-encodes them as six bytes. Every byte
    offset after the first non-ASCII character would then be wrong, silently, for the whole
    document. A byte-exact product cannot inherit the locale's opinion about encoding.
    """
    stream = sys.stdin if stream is None else stream
    buffer = getattr(stream, "buffer", None)

    if buffer is not None:
        raw_bytes = buffer.read(MAX_INPUT_BYTES + 1)
        if len(raw_bytes) > MAX_INPUT_BYTES:
            raise EngineError("INPUT_TOO_LARGE", f"request exceeds {MAX_INPUT_BYTES} bytes")
        if not raw_bytes.strip():
            raise EngineError("EMPTY_INPUT", "expected one JSON object on stdin")
        try:
            text = raw_bytes.decode("utf-8")
        except UnicodeDecodeError as cause:
            raise EngineError("BAD_JSON", f"stdin is not valid UTF-8: {cause}") from cause
    else:
        raw = stream.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            raise EngineError("INPUT_TOO_LARGE", f"request exceeds {MAX_INPUT_BYTES} bytes")
        if not raw.strip():
            raise EngineError("EMPTY_INPUT", "expected one JSON object on stdin")
        text = raw

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as cause:
        raise EngineError("BAD_JSON", f"stdin is not valid JSON: {cause}") from cause
    if not isinstance(parsed, dict):
        raise EngineError("BAD_SHAPE", "request must be a JSON object")
    op = parsed.get("op")
    if not isinstance(op, str) or not op:
        raise EngineError("MISSING_OP", "request is missing a string \"op\"")
    return op, parsed.get("input")


def write_response(response: SuccessResponse | ErrorResponse, stream: Any = None) -> None:
    """Write one line of JSON as UTF-8 bytes.

    Symmetric with the read path: a response carrying a non-ASCII claim title must not be
    mangled or rejected by the console codec on the way out either.
    """
    text = json.dumps(response, separators=(",", ":"), default=str) + "\n"
    stream = sys.stdout if stream is None else stream
    buffer = getattr(stream, "buffer", None)
    if buffer is not None:
        buffer.write(text.encode("utf-8"))
        buffer.flush()
        return
    stream.write(text)
    stream.flush()


def dispatch(handlers: dict[str, Handler], op: str, payload: Any) -> Any:
    """Route to a handler, converting any exception into a stable error code."""
    handler = handlers.get(op)
    if handler is None:
        known = ", ".join(sorted(handlers))
        raise EngineError("UNKNOWN_OP", f"unknown op {op!r}; available: {known}")
    return handler(payload)
