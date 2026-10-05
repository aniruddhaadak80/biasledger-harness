# ADR 0006 — Attestation is a gated state transition, not a field

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

A claim board needs to track claims across five states: `unverified`, `evidenced`, `challenged`,
`attested`, `withdrawn`. The tempting implementation is a `state` string on the claim record that
a reviewer edits.

That implementation is worthless for this product. The moment attestation is a field anyone can
set, "attested" means "somebody clicked", and the Merkle root beside it proves nothing. The board
would report `attested` for a claim whose citations had all rotted, and nothing in the system
would object.

## Decision

Attestation is a **checked transition in the Python engine**, not a mutable field.

```
unverified -> evidenced | withdrawn
evidenced  -> challenged | attested | withdrawn
challenged -> evidenced | attested | withdrawn
attested   -> challenged | withdrawn
withdrawn  -> unverified
```

Two transitions are gated:

- **`attested` requires a verdict of `attestable`.** The engine re-evaluates the claim against
  the corpus at the moment of the move. A partial claim is refused, and the refusal names the
  unbacked dimensions.
- **`withdrawn` requires a non-empty reason.** A retraction that does not say why is
  indistinguishable from a deletion.

There is no `unverified -> attested`. A claim must be evidenced before anyone can attest it.

`packages/core` contains a TypeScript mirror of the table, used only to grey out an illegal move
in the board before anyone presses it. The engine is the authority; the client-side check is a
courtesy.

## Consequences

**Good**

- The board cannot show `attested` for a claim whose required dimensions are unbacked, because
  there is no path that produces that combination.
- Attestation and revocation are symmetric: `attested -> challenged` exists, so an attestation is
  reversible by a reviewer when evidence is rewritten. That is not an oversight — evidence does
  get rewritten, and the Q2 incident review in `audit/` exists because of one such rewrite.
- The refusal is the deliverable. `refused: verdict is 'partial', not 'attestable' (unbacked:
deletion-sla)` tells a reviewer exactly what is missing, which is more useful than a rejection.
- The lifecycle is queryable as data (`claim_lifecycle`), so no interface hardcodes it.

**Bad**

- A claim whose evidence is genuinely fine but whose _stated_ dimensions are too strict cannot be
  attested until the taxonomy is changed — which is a plugin edit, reviewed like anything else.
  This is intended friction, but it will feel like obstruction to someone in a hurry.
- Every move re-reads the corpus and re-evaluates, so transitions are not free. At six claims
  this is milliseconds; at thousands it would need the manifest cache, and the gate would need a
  staleness bound. Not built.
- An agent with `claim_move` can still attempt moves. It just cannot get an illegal one applied,
  and the attempt is visible in the decision.

## Alternatives rejected

**A mutable `state` field with a UI-only check.** Rejected: the whole product's credibility rests
on the gate being in code, and a client-side check is bypassed by anyone reading the JSON.

**Attestation as a signature over the claim.** Rejected as premature: it needs a key management
story, a revocation story and an identity story, none of which answer the question the product is
actually asking — _do these bytes say what the claim says_.

**Allowing attestation with a recorded override.** Rejected: an override flag that bypasses the
gate is a gate with a door in it. If a claim should be attested on judgement rather than
evidence, the honest state for it is `challenged`.
