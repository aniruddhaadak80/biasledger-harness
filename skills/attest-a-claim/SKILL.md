---
name: attest-a-claim
description: Use when a claim's verdict is attestable and you need to move it to attested or withdraw it, because the lifecycle refuses moves the evidence does not support and you need to know which.
metadata:
  version: 1.0.0
---

# Moving a claim through the lifecycle

## When to use this

You have evaluated a claim and want to change its state. The state machine will refuse moves
the evidence forbids, and it refuses _before_ anything is written.

## The five states

| State        | Means                                                           |
| ------------ | --------------------------------------------------------------- |
| `unverified` | Registered, nothing checked.                                    |
| `evidenced`  | Citations exist and resolve.                                    |
| `challenged` | A reviewer disputed it.                                         |
| `attested`   | Every required dimension is backed by a citation that resolves. |
| `withdrawn`  | Retracted, with a recorded reason.                              |

## The only legal moves

```
unverified -> evidenced | withdrawn
evidenced  -> challenged | attested | withdrawn
challenged -> evidenced | attested | withdrawn
attested   -> challenged | withdrawn
withdrawn  -> unverified
```

There is no `unverified -> attested`. A claim must be evidenced before anyone can attest it,
and every transition is checked against this table rather than trusted.

## Two gated moves

**`attested` is gated on the verdict.** The engine re-evaluates the claim against the corpus
and refuses unless the verdict is `attestable`. A partial claim is refused and the refusal
names the unbacked dimensions:

```
refused: verdict is 'partial', not 'attestable' (unbacked: deletion-sla)
```

This is the rule that makes the tool an audit instrument rather than a database. Nobody can
promote a claim past its evidence, because promotion is a checked transition rather than a
field edit.

**`withdrawn` is gated on a reason.** A withdrawal without a non-empty `--note` is refused.
A retraction that does not say why is indistinguishable from a deletion.

## Steps

1. See what is currently allowed:

   ```
   biasledger claims
   ```

   The second line under each claim lists its legal moves, derived from its live verdict.

2. Make the move:

   ```
   biasledger move <claimId> attested
   biasledger move <claimId> withdrawn --note "superseded by the 2026 re-audit"
   ```

3. Read the result. `refused: …` with exit code 1 means nothing was written. The claim is
   exactly as it was.

4. Re-publish the index so the attestation covers the new state:

   ```
   biasledger index --write
   ```

## Notes

- `biasledger move` is also exposed as the MCP tool `claim_move`, so an agent working over MCP
  goes through the same gate. There is no path that bypasses it.
- `challenged` and `attested` are mutually reachable. That is deliberate: an attestation is
  reversible by challenge, because evidence gets rewritten.

## Verify

```
biasledger show <claimId>
```

The state line must show the state you moved to, and `biasledger root` must still report
`consistent yes` after `biasledger index --write`.
