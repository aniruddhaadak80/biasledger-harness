# Calibration report — `triage-net-v3`, held-out cohort 2025-07 to 2026-03

Cohort size: 38,412 records. Ten equal-count reliability bins, binned on predicted risk.

## Expected calibration error by group

| Group | Records | ECE | Max gap |
| --- | --- | --- | --- |
| Group A | 12,004 | 0.028 | 0.019 |
| Group B | 11,388 | 0.034 | 0.021 |
| Group C | 9,771 | 0.031 | 0.018 |
| Group D | 5,249 | 0.036 | 0.023 |

The worst expected calibration error across the four groups is 0.036 and the worst
single-bin gap is 0.023, so the spread between the best and worst group is 0.008 ECE.

## Missingness

Vital-sign records were missing for 1,576 records (4.1%). Excluded records per group: Group
A 3.8%, Group B 4.2%, Group C 4.0%, Group D 4.6%. The exclusion rate is therefore highest
in the smallest group, which widens the confidence interval on that group's estimate.

## Confidence intervals

Bootstrap, 2,000 resamples, 95% interval on ECE: Group A [0.024, 0.032], Group B
[0.029, 0.039], Group C [0.026, 0.036], Group D [0.029, 0.043]. Group D's interval overlaps
Group B's, so the apparent ordering of the middle two groups is not significant.

## Groups below the reporting threshold

Two additional protected strata were present in the intake system but had fewer than 500
records in the held-out cohort. Per the pre-registered rule these are not reported. Their
record counts are 311 and 94 respectively, and no calibration figure is published for them.