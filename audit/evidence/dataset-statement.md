# Dataset statement — intake records, cohort `intake-2025H2`

## Provenance

412,000 structured intake records exported from the emergency department intake system at 14
participating sites between 2024-01 and 2026-03. Each record carries the eleven intake
features listed in the model card, the 30-day admission outcome used as the training label,
and a set of protected strata captured for fairness measurement only.

## Collection and purpose

Collected for the purpose of developing and evaluating `triage-net-v3`. No secondary use was
approved. The export excludes free-text notes, names, addresses, and any direct identifier;
the remaining fields were reviewed against the field-level schema before export.

## Withdrawal and deletion

Every participant in the cohort has a withdrawal channel in the intake system. A withdrawal
request sets `withdrawn_at` on the participant record, which removes the participant from any
future training cohort and from any evaluation cohort assembled after that timestamp.

Deletion is handled by the participant-identity service rather than by the research team.
When a withdrawal request is received, the identity service issues a deletion job covering
the participant's rows in the research warehouse. Deletion requests received before 14:00
local time are completed the same working day.

## Retention

Evaluation cohorts are retained for 24 months from cohort close, after which the derived
features are dropped. The raw intake export is retained for 24 months. Training snapshots
are retained indefinitely because they are derived from data that has already been lawfully
collected, but a snapshot is not re-usable to re-identify a withdrawn participant.

## Known gaps

The export does not record which participants were ever asked for consent in a form the
identity service can reconcile. For 2,204 cohort members the consent artefact is present in
the intake system but absent from the research warehouse, so it cannot be confirmed from
this dataset whether those members were inside the consent window.