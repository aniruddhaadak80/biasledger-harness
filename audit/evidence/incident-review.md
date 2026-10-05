# Incident review — clinician overrides, 2026-Q1 and Q2

## What was reviewed

Every case in the 2026-04-14 production window onward in which a clinician acted on an
order that differed from the model's suggested order. Overrides are not errors by
definition; this document records them so the model's disagreements are auditable rather
than invisible.

## Counts

| Quarter | Encounters | Clinician order differed from model | Share |
| --- | --- | --- | --- |
| 2026-Q2 | 61,204 | 3,918 | 6.4% |
| 2026-Q1 (partial, from 04-14) | 27,880 | 1,536 | 5.5% |

## Categories of disagreement

Reviewers tagged each disagreement with one category from a fixed list:

- `incomplete_input` — a finding the model cannot see, most often a patient who verbally
  reports a change not captured in the structured intake record. 44% of cases.
- `clinical_override_of_protocol` — the model disagrees with a documented protocol step.
  31% of cases.
- `model_error` — on review, the model's suggested order was wrong. 17% of cases.
- `no_material_difference` — orders differed in grouping but not in urgency. 8% of cases.

## Finding

The `model_error` rate of 17% was materially higher for encounters where `pain_score` was
recorded as missing, which the model card lists among its inputs without saying how missing
values are imputed. That imputation is undocumented in this repository and is tracked as a
follow-up.

## Audit trail

Each override is written to the encounter record with the model suggestion, the clinician
order, the category, and the reviewing clinician's identifier. The record is append-only: an
override cannot be edited after sign-off, only superseded by a further entry.