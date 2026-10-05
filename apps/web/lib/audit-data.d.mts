/**
 * GENERATED FILE -- do not edit. Types for ./audit-data.mjs.
 *
 * TypeScript resolves "./audit-data.mjs" to this declaration, so the snapshot stays typed
 * without the generator having to emit TypeScript.
 */

export interface SnapshotDoc {
  readonly docId: string
  readonly blob: string
  readonly bytes: number
}

export interface SnapshotCitation {
  readonly docId: string
  readonly byteStart: number
  readonly byteEnd: number
  readonly expects?: string
}

export interface SnapshotDimension {
  readonly key: string
  readonly required: boolean
  readonly citations: readonly SnapshotCitation[]
}

export interface SnapshotClaim {
  readonly id: string
  readonly title: string
  readonly system: string
  readonly state: string
  readonly note: string
  readonly dimensions: readonly SnapshotDimension[]
}

export interface SnapshotVerdict {
  readonly claimId: string
  /** The lifecycle state the claim was in when the index was published. */
  readonly state: string
  readonly verdict: string
  readonly dimensionsTotal: number
  readonly dimensionsRequired: number
  readonly dimensionsCovered: number
  readonly coverage: number
  readonly citationsChecked: number
  readonly citationsValid: number
  readonly citationsInvalid: number
  readonly attestedOver: readonly string[]
  readonly root: string
  readonly gaps: readonly { readonly dimension: string; readonly reason: string }[]
  readonly spans: readonly {
    readonly dimension: string
    readonly docId: string
    readonly blob: string
    readonly byteStart: number
    readonly byteEnd: number
    readonly line: number
    readonly valid: boolean
    readonly reason: string
    readonly text: string
  }[]
}

export interface AuditSnapshot {
  readonly root: string
  readonly version: number
  readonly merkleRoot: string
  readonly commit: string | null
  readonly docs: readonly SnapshotDoc[]
  readonly claims: readonly SnapshotClaim[]
}

export declare const AUDIT_SNAPSHOT: AuditSnapshot
export declare const AUDIT_VERDICTS: Readonly<Record<string, SnapshotVerdict>>
