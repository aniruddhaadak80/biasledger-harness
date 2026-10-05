"""Deterministic engine for biasledger-harness.

The engine is deliberately dependency-free. Every operation is a pure function:
same input, same output, no clock, no network, no randomness. Time and any entropy
must be passed in by the caller.

The product's promise is that no model was asked whether the evidence supports a
claim, so the three modules that decide support are the whole point:

  * `index`   -- byte-exact spans and a Merkle root over the evidence
  * `claims`  -- span verification, coverage, and the gated claim lifecycle
  * `analysis`-- the operation registry the host dispatches through
"""

from .protocol import EngineError, dispatch
from .analysis import OPERATIONS, analyse
from .claims import STATES, TRANSITIONS, VERDICTS, evaluate_claim, transition, verify_span
from .index import blob_for, build_index, index_document, reduce_root, tokenize

__all__ = [
    "EngineError",
    "dispatch",
    "OPERATIONS",
    "analyse",
    "STATES",
    "TRANSITIONS",
    "VERDICTS",
    "evaluate_claim",
    "transition",
    "verify_span",
    "blob_for",
    "build_index",
    "index_document",
    "reduce_root",
    "tokenize",
]
__version__ = "0.1.0"