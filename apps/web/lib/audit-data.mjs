/**
 * GENERATED FILE -- do not edit.
 *
 * Produced by apps/web/scripts/generate-audit-data.mjs from the git-backed audit corpus.
 * Regenerate with: npm run generate:web-data
 *
 * Committed on purpose: a serverless bundle is not the repository, so the deployed board must
 * not read the filesystem at request time. Committing it also means a reviewer sees what the
 * web app serves in the diff that changes it.
 *
 * apps/web/tests/board.test.mjs fails if this drifts from audit/.
 */

export const AUDIT_SNAPSHOT = {
  "root": "C:\\Users\\ANIRUDDHA\\Desktop\\Projects\\biasledger-harness\\audit",
  "version": 1,
  "merkleRoot": "252aa61853ae3f6469c87e34089128b9d6041f53ea931036fc5bbd6d4aac1cb4",
  "commit": null,
  "docs": [
    {
      "docId": "calibration-report",
      "blob": "7a5314145d97726b18deaffc8865459a73f2957a",
      "bytes": 1463
    },
    {
      "docId": "dataset-statement",
      "blob": "1370d899f146e4077eb20ec4b910c3dd9936452f",
      "bytes": 2055
    },
    {
      "docId": "incident-review",
      "blob": "23ad81d7e464cfcb2170bfc83441b5a74b957bce",
      "bytes": 1690
    },
    {
      "docId": "triage-model-card",
      "blob": "2bddc4c6c369272e3e79228dc82c9d5de4ab0d75",
      "bytes": 3162
    }
  ],
  "claims": [
    {
      "id": "consent-withdrawal",
      "title": "Subjects can withdraw consent and have their data deleted promptly",
      "system": "intake-2025H2",
      "state": "evidenced",
      "note": "",
      "dimensions": [
        {
          "key": "withdrawal-mechanism",
          "required": true,
          "citations": [
            {
              "docId": "dataset-statement",
              "byteStart": 823,
              "byteEnd": 863
            }
          ]
        },
        {
          "key": "deletion-sla",
          "required": true,
          "citations": [
            {
              "docId": "dataset-statement",
              "byteStart": 1146,
              "byteEnd": 1197,
              "expects": "Deleting a withdrawn participant's rows is completed within 30 days"
            }
          ]
        },
        {
          "key": "retention-policy",
          "required": true,
          "citations": [
            {
              "docId": "dataset-statement",
              "byteStart": 1350,
              "byteEnd": 1395
            }
          ]
        }
      ]
    },
    {
      "id": "human-oversight",
      "title": "Every triage decision is reviewed by a clinician before it is acted on",
      "system": "triage-net-v3",
      "state": "attested",
      "note": "Attested 2026-08-19 against the Q2 incident review.",
      "dimensions": [
        {
          "key": "workflow-mandate",
          "required": true,
          "citations": [
            {
              "docId": "triage-model-card",
              "byteStart": 2324,
              "byteEnd": 2387
            }
          ]
        },
        {
          "key": "audit-trail",
          "required": true,
          "citations": [
            {
              "docId": "incident-review",
              "byteStart": 1610,
              "byteEnd": 1670
            }
          ]
        }
      ]
    },
    {
      "id": "pain-score-imputation",
      "title": "Missing pain_score values are imputed by a documented, reviewed method",
      "system": "triage-net-v3",
      "state": "unverified",
      "note": "Raised 2026-09-30 from the Q2 incident review finding.",
      "dimensions": [
        {
          "key": "imputation-method",
          "required": true,
          "citations": []
        },
        {
          "key": "imputation-review",
          "required": true,
          "citations": []
        }
      ]
    },
    {
      "id": "pediatric-validation",
      "title": "The model is validated for paediatric intake records",
      "system": "triage-net-v3",
      "state": "withdrawn",
      "note": "Withdrawn 2026-07-02: the model card states the model was not trained on paediatric records, so the claim was never supported.",
      "dimensions": [
        {
          "key": "paediatric-cohort",
          "required": true,
          "citations": []
        },
        {
          "key": "paediatric-report",
          "required": true,
          "citations": []
        }
      ]
    },
    {
      "id": "protected-attributes",
      "title": "No protected attribute is used as a model feature",
      "system": "triage-net-v3",
      "state": "challenged",
      "note": "Disputed 2026-09-02: reviewer questions whether allow-list enforcement covers batch scoring.",
      "dimensions": [
        {
          "key": "feature-list",
          "required": true,
          "citations": [
            {
              "docId": "triage-model-card",
              "byteStart": 753,
              "byteEnd": 791
            },
            {
              "docId": "triage-model-card",
              "byteStart": 1025,
              "byteEnd": 1100
            }
          ]
        },
        {
          "key": "proxy-analysis",
          "required": true,
          "citations": [
            {
              "docId": "triage-model-card",
              "byteStart": 1536,
              "byteEnd": 1601
            }
          ]
        }
      ]
    },
    {
      "id": "triage-calibration",
      "title": "Triage scores are calibrated within 0.04 ECE across all four reported groups",
      "system": "triage-net-v3",
      "state": "evidenced",
      "note": "",
      "dimensions": [
        {
          "key": "calibration-spread",
          "required": true,
          "citations": [
            {
              "docId": "calibration-report",
              "byteStart": 417,
              "byteEnd": 485
            },
            {
              "docId": "calibration-report",
              "byteStart": 528,
              "byteEnd": 584,
              "expects": "0.008 ECE"
            }
          ]
        },
        {
          "key": "missingness",
          "required": true,
          "citations": [
            {
              "docId": "calibration-report",
              "byteStart": 689,
              "byteEnd": 744
            }
          ]
        },
        {
          "key": "subgroup-coverage",
          "required": true,
          "citations": [
            {
              "docId": "calibration-report",
              "byteStart": 1314,
              "byteEnd": 1364
            }
          ]
        },
        {
          "key": "confidence-intervals",
          "required": true,
          "citations": [
            {
              "docId": "calibration-report",
              "byteStart": 1018,
              "byteEnd": 1040
            }
          ]
        }
      ]
    }
  ]
}

export const AUDIT_VERDICTS = {
  "consent-withdrawal": {
    "claimId": "consent-withdrawal",
    "verdict": "partial",
    "dimensionsTotal": 3,
    "dimensionsRequired": 3,
    "dimensionsCovered": 2,
    "coverage": 0.666667,
    "citationsChecked": 3,
    "citationsValid": 2,
    "citationsInvalid": 1,
    "attestedOver": [
      "dataset-statement"
    ],
    "root": "10df64b9a45f30dcd440593f54457f389da451be7a6fb2749bc3fb3b1d185eaa",
    "gaps": [
      {
        "dimension": "deletion-sla",
        "reason": "all-citations-unresolvable"
      }
    ],
    "spans": [
      {
        "dimension": "withdrawal-mechanism",
        "docId": "dataset-statement",
        "blob": "1370d899f146e4077eb20ec4b910c3dd9936452f",
        "byteStart": 823,
        "byteEnd": 863,
        "line": 18,
        "valid": true,
        "reason": "ok",
        "text": "A withdrawal\nrequest sets `withdrawn_at`"
      },
      {
        "dimension": "deletion-sla",
        "docId": "dataset-statement",
        "blob": "1370d899f146e4077eb20ec4b910c3dd9936452f",
        "byteStart": 1146,
        "byteEnd": 1197,
        "line": 23,
        "valid": false,
        "reason": "text-mismatch",
        "text": "the identity service issues a deletion job covering"
      },
      {
        "dimension": "retention-policy",
        "docId": "dataset-statement",
        "blob": "1370d899f146e4077eb20ec4b910c3dd9936452f",
        "byteStart": 1350,
        "byteEnd": 1395,
        "line": 29,
        "valid": true,
        "reason": "ok",
        "text": "Evaluation cohorts are retained for 24 months"
      }
    ],
    "state": "evidenced"
  },
  "human-oversight": {
    "claimId": "human-oversight",
    "verdict": "attestable",
    "dimensionsTotal": 2,
    "dimensionsRequired": 2,
    "dimensionsCovered": 2,
    "coverage": 1,
    "citationsChecked": 2,
    "citationsValid": 2,
    "citationsInvalid": 0,
    "attestedOver": [
      "incident-review",
      "triage-model-card"
    ],
    "root": "3351b67a84000ff74f740858f4a2668c7e1668adab9e252b78935969472a6c74",
    "gaps": [],
    "spans": [
      {
        "dimension": "workflow-mandate",
        "docId": "triage-model-card",
        "blob": "2bddc4c6c369272e3e79228dc82c9d5de4ab0d75",
        "byteStart": 2324,
        "byteEnd": 2387,
        "line": 58,
        "valid": true,
        "reason": "ok",
        "text": "No triage output is ever acted on without a clinician sign-off."
      },
      {
        "dimension": "audit-trail",
        "docId": "incident-review",
        "blob": "23ad81d7e464cfcb2170bfc83441b5a74b957bce",
        "byteStart": 1610,
        "byteEnd": 1670,
        "line": 38,
        "valid": true,
        "reason": "ok",
        "text": "an\noverride cannot be edited after sign-off, only superseded"
      }
    ],
    "state": "attested"
  },
  "pain-score-imputation": {
    "claimId": "pain-score-imputation",
    "verdict": "unsubstantiated",
    "dimensionsTotal": 2,
    "dimensionsRequired": 2,
    "dimensionsCovered": 0,
    "coverage": 0,
    "citationsChecked": 0,
    "citationsValid": 0,
    "citationsInvalid": 0,
    "attestedOver": [],
    "root": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "gaps": [
      {
        "dimension": "imputation-method",
        "reason": "no-citation"
      },
      {
        "dimension": "imputation-review",
        "reason": "no-citation"
      }
    ],
    "spans": [],
    "state": "unverified"
  },
  "pediatric-validation": {
    "claimId": "pediatric-validation",
    "verdict": "unsubstantiated",
    "dimensionsTotal": 2,
    "dimensionsRequired": 2,
    "dimensionsCovered": 0,
    "coverage": 0,
    "citationsChecked": 0,
    "citationsValid": 0,
    "citationsInvalid": 0,
    "attestedOver": [],
    "root": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "gaps": [
      {
        "dimension": "paediatric-cohort",
        "reason": "no-citation"
      },
      {
        "dimension": "paediatric-report",
        "reason": "no-citation"
      }
    ],
    "spans": [],
    "state": "withdrawn"
  },
  "protected-attributes": {
    "claimId": "protected-attributes",
    "verdict": "attestable",
    "dimensionsTotal": 2,
    "dimensionsRequired": 2,
    "dimensionsCovered": 2,
    "coverage": 1,
    "citationsChecked": 3,
    "citationsValid": 3,
    "citationsInvalid": 0,
    "attestedOver": [
      "triage-model-card"
    ],
    "root": "f8666829a6efbb18ee9c7960b821a3d6646fccdd34cd942a05527f6d256e5dcc",
    "gaps": [],
    "spans": [
      {
        "dimension": "feature-list",
        "docId": "triage-model-card",
        "blob": "2bddc4c6c369272e3e79228dc82c9d5de4ab0d75",
        "byteStart": 753,
        "byteEnd": 791,
        "line": 29,
        "valid": true,
        "reason": "ok",
        "text": "Protected attributes are not features."
      },
      {
        "dimension": "feature-list",
        "docId": "triage-model-card",
        "blob": "2bddc4c6c369272e3e79228dc82c9d5de4ab0d75",
        "byteStart": 1025,
        "byteEnd": 1100,
        "line": 32,
        "valid": true,
        "reason": "ok",
        "text": "the serving adapter rejects any payload containing a key outside the eleven"
      },
      {
        "dimension": "proxy-analysis",
        "docId": "triage-model-card",
        "blob": "2bddc4c6c369272e3e79228dc82c9d5de4ab0d75",
        "byteStart": 1536,
        "byteEnd": 1601,
        "line": 40,
        "valid": true,
        "reason": "ok",
        "text": "Neither feature reached\nthe pre-registered significance threshold"
      }
    ],
    "state": "challenged"
  },
  "triage-calibration": {
    "claimId": "triage-calibration",
    "verdict": "attestable",
    "dimensionsTotal": 4,
    "dimensionsRequired": 4,
    "dimensionsCovered": 4,
    "coverage": 1,
    "citationsChecked": 5,
    "citationsValid": 5,
    "citationsInvalid": 0,
    "attestedOver": [
      "calibration-report"
    ],
    "root": "87a21c7f8d02b2ed50892bc1325fad93825f4682e944e5dfaebe76d4ca7b6199",
    "gaps": [],
    "spans": [
      {
        "dimension": "calibration-spread",
        "docId": "calibration-report",
        "blob": "7a5314145d97726b18deaffc8865459a73f2957a",
        "byteStart": 417,
        "byteEnd": 485,
        "line": 14,
        "valid": true,
        "reason": "ok",
        "text": "The worst expected calibration error across the four groups is 0.036"
      },
      {
        "dimension": "calibration-spread",
        "docId": "calibration-report",
        "blob": "7a5314145d97726b18deaffc8865459a73f2957a",
        "byteStart": 528,
        "byteEnd": 584,
        "line": 15,
        "valid": true,
        "reason": "ok",
        "text": "the spread between the best and worst group is 0.008 ECE"
      },
      {
        "dimension": "missingness",
        "docId": "calibration-report",
        "blob": "7a5314145d97726b18deaffc8865459a73f2957a",
        "byteStart": 689,
        "byteEnd": 744,
        "line": 19,
        "valid": true,
        "reason": "ok",
        "text": "Group\nA 3.8%, Group B 4.2%, Group C 4.0%, Group D 4.6%."
      },
      {
        "dimension": "subgroup-coverage",
        "docId": "calibration-report",
        "blob": "7a5314145d97726b18deaffc8865459a73f2957a",
        "byteStart": 1314,
        "byteEnd": 1364,
        "line": 32,
        "valid": true,
        "reason": "ok",
        "text": "Per the pre-registered rule these are not reported"
      },
      {
        "dimension": "confidence-intervals",
        "docId": "calibration-report",
        "blob": "7a5314145d97726b18deaffc8865459a73f2957a",
        "byteStart": 1018,
        "byteEnd": 1040,
        "line": 26,
        "valid": true,
        "reason": "ok",
        "text": "Group D [0.029, 0.043]"
      }
    ],
    "state": "evidenced"
  }
}
