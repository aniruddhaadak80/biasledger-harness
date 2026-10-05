# Triage model card — `triage-net-v3`

**Owner:** Clinical Operations ML
**Status:** in production since 2026-04-14
**Review cadence:** quarterly, next review 2026-12

## Purpose

`triage-net-v3` estimates the acuity of a patient from a short structured intake record so
that an emergency department can order patients by expected need for care. It ranks; it
does not diagnose, and it does not allocate treatment.

## Inputs

The model consumes exactly eleven features, all recorded at triage intake:

1. `age_band`
2. `arrival_transport`
3. `chief_complaint_code`
4. `vitals_systolic`
5. `vitals_diastolic`
6. `vitals_heart_rate`
7. `vitals_respiratory_rate`
8. `pain_score`
9. `anticoagulant_flag`
10. `recent_procedure_flag`
11. `escalation_code`

Protected attributes are not features. Sex, ethnicity, insurance status, interpreter
requirement, and disability accommodation flags are recorded in the intake system but are
never passed to the scoring function. This is enforced at the serving boundary by an
allow-list: the serving adapter rejects any payload containing a key outside the eleven
above, so an accidental feature addition fails closed rather than silently scoring on it.

## Proxy analysis

`age_band` and `arrival_transport` are the two features most likely to act as proxies for
socioeconomic status. On the 2026-Q1 audit both were tested against the two protected
strata with the largest cohort difference (ethnicity and insurance status) using the
conditional-independence test described in `proxy-analysis.md`. Neither feature reached
the pre-registered significance threshold after controlling for clinical severity. The
pre-registered threshold and the raw p-values are recorded in that document.

## Model architecture

A gradient-boosted tree ensemble of 300 trees, maximum depth 6, trained on 412,000 intake
records from 14 sites. The loss is binary cross-entropy against a 30-day admission outcome.

## Evaluation cohort

The reported figures come from a held-out cohort of 38,412 intake records collected between
2025-07-01 and 2026-03-31, stratified by site. Records with missing vital signs were
excluded, which removed 4.1% of the cohort; the exclusion count per group is published in
the calibration report so the reader can see whether missingness was differential.

## Human oversight

No triage output is ever acted on without a clinician sign-off. The ordering is advisory:
the nursing dashboard shows the model's suggested order in one column and the clinician's
working order in another, and the record stores which of the two the clinician acted on.
The `incident-review.md` document lists every case in the last two quarters where the
clinician overrode the model.

## Known limitations

- The model was not trained on paediatric intake records and is not validated for them.
- Site 9 changed its intake form in 2026-02; records after that date are under-represented.
- Calibration is reported only for the four demographic groups listed in the calibration
  report. Groups with fewer than 500 records in the held-out cohort are not reported at all,
  which is itself a limit on what this card can be used to conclude.