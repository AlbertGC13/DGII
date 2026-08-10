import type { Result } from "../../../shared/domain/result.js";
import { createEcf31CoreDraft } from "../domain/ecf31-core-draft.js";
import {
  isEcf31PersistableDraftEvidence,
  restoreEcf31PersistableDraftEvidenceFromSnapshot,
} from "../domain/ecf31-persistable-draft-evidence.js";
import type { Ecf31PersistableDraftEvidence } from "../domain/ecf31-persistable-draft-evidence.js";
import {
  restoreEcf31CoreHeader,
  serializeEcf31CoreHeader,
} from "./ecf31-core-header-snapshot-codec.js";
import type { Ecf31CoreHeaderSnapshot } from "./ecf31-core-header-snapshot-codec.js";
import {
  restoreEcf31HeaderTotals,
  serializeEcf31HeaderTotals,
} from "./ecf31-header-totals-snapshot-codec.js";
import type { Ecf31HeaderTotalsSnapshot } from "./ecf31-header-totals-snapshot-codec.js";
import {
  restoreEcf31LineAdjustment,
  serializeEcf31LineAdjustment,
} from "./ecf31-line-adjustment-snapshot-codec.js";
import type {
  Ecf31LineAdjustmentEvidence,
  Ecf31LineAdjustmentSnapshot,
} from "./ecf31-line-adjustment-snapshot-codec.js";

type Ecf31PersistableDraftEvidenceSnapshotV1 = Readonly<{
  schema: "ecf31-draft-evidence-v1";
  header: Ecf31CoreHeaderSnapshot;
  lineAdjustments: readonly Ecf31LineAdjustmentSnapshot[];
  headerTotals: Ecf31HeaderTotalsSnapshot;
}>;
type Ecf31PersistableDraftEvidenceSnapshotV2 = Readonly<{
  schema: "ecf31-draft-evidence";
  version: 2;
  header: Ecf31CoreHeaderSnapshot;
  lineAdjustments: readonly Ecf31LineAdjustmentSnapshot[];
  headerTotals: Ecf31HeaderTotalsSnapshot;
  headerTotalsPolicyId: "ecf31-derived-header-totals-v1";
}>;
export type Ecf31PersistableDraftEvidenceSnapshot = Ecf31PersistableDraftEvidenceSnapshotV1 | Ecf31PersistableDraftEvidenceSnapshotV2;

export type Ecf31PersistableDraftEvidenceSnapshotError = Readonly<{
  code: "INVALID_ECF31_PERSISTABLE_DRAFT_EVIDENCE" | "INVALID_ECF31_PERSISTABLE_DRAFT_EVIDENCE_SNAPSHOT";
  message: string;
}>;

const MESSAGES = Object.freeze({
  INVALID_ECF31_PERSISTABLE_DRAFT_EVIDENCE: "E-CF 31 persistable draft evidence must be genuine.",
  INVALID_ECF31_PERSISTABLE_DRAFT_EVIDENCE_SNAPSHOT: "E-CF 31 persistable draft evidence snapshot is invalid.",
} satisfies Record<Ecf31PersistableDraftEvidenceSnapshotError["code"], string>);
const V1_KEYS = ["schema", "header", "lineAdjustments", "headerTotals"];
const V2_KEYS = ["schema", "version", "header", "lineAdjustments", "headerTotals", "headerTotalsPolicyId"];

function failure(
  code: Ecf31PersistableDraftEvidenceSnapshotError["code"],
): Result<never, Ecf31PersistableDraftEvidenceSnapshotError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function readExactRecord(input: unknown, snapshotKeys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof input !== "object" || input === null) return undefined;

  try {
    if (Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== snapshotKeys.length || keys.some((key) => typeof key !== "string" || !snapshotKeys.includes(key))) {
      return undefined;
    }
    const values: Record<string, unknown> = {};
    for (const key of snapshotKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      values[key] = descriptor.value;
    }
    return values;
  } catch {
    return undefined;
  }
}

function copySnapshots(input: unknown): readonly unknown[] | undefined {
  try {
    return Array.isArray(input) && input.length > 0 ? Array.from(input) : undefined;
  } catch {
    return undefined;
  }
}

export function serializeEcf31PersistableDraftEvidence(
  input: unknown,
): Result<Ecf31PersistableDraftEvidenceSnapshot, Ecf31PersistableDraftEvidenceSnapshotError> {
  if (!isEcf31PersistableDraftEvidence(input)) return failure("INVALID_ECF31_PERSISTABLE_DRAFT_EVIDENCE");

  const header = serializeEcf31CoreHeader(input.draft.header) as { readonly ok: true; readonly value: Ecf31CoreHeaderSnapshot };
  const headerTotals = serializeEcf31HeaderTotals(input.headerTotals) as { readonly ok: true; readonly value: Ecf31HeaderTotalsSnapshot };
  const lineAdjustments: Ecf31LineAdjustmentSnapshot[] = [];
  for (const quantization of input.montoItemQuantizations) {
    lineAdjustments.push((serializeEcf31LineAdjustment({
      lineAmount: quantization.sourceEvidence, quantization,
    }) as { readonly ok: true; readonly value: Ecf31LineAdjustmentSnapshot }).value);
  }

  const common = { header: header.value, lineAdjustments: Object.freeze(lineAdjustments), headerTotals: headerTotals.value };
  return { ok: true, value: Object.freeze(input.snapshotVersion === 1
    ? { schema: "ecf31-draft-evidence-v1" as const, ...common }
    : { schema: "ecf31-draft-evidence" as const, version: 2 as const, ...common, headerTotalsPolicyId: "ecf31-derived-header-totals-v1" as const }) };
}

export function restoreEcf31PersistableDraftEvidence(
  input: unknown,
): Result<Ecf31PersistableDraftEvidence, Ecf31PersistableDraftEvidenceSnapshotError> {
  const v1 = readExactRecord(input, V1_KEYS);
  const v2 = v1 === undefined ? readExactRecord(input, V2_KEYS) : undefined;
  const snapshot = v1 ?? v2;
  const snapshotVersion = v1 === undefined ? 2 : 1;
  if (snapshot === undefined || (v1 !== undefined
    ? snapshot["schema"] !== "ecf31-draft-evidence-v1"
    : snapshot["schema"] !== "ecf31-draft-evidence" || snapshot["version"] !== 2 || snapshot["headerTotalsPolicyId"] !== "ecf31-derived-header-totals-v1")) {
    return failure("INVALID_ECF31_PERSISTABLE_DRAFT_EVIDENCE_SNAPSHOT");
  }
  const lineSnapshots = copySnapshots(snapshot["lineAdjustments"]);
  if (lineSnapshots === undefined) return failure("INVALID_ECF31_PERSISTABLE_DRAFT_EVIDENCE_SNAPSHOT");

  const header = restoreEcf31CoreHeader(snapshot["header"]);
  const headerTotals = restoreEcf31HeaderTotals(snapshot["headerTotals"]);
  const lineAdjustments: Ecf31LineAdjustmentEvidence[] = [];
  for (const lineSnapshot of lineSnapshots) {
    const adjustment = restoreEcf31LineAdjustment(lineSnapshot);
    if (!adjustment.ok) return failure("INVALID_ECF31_PERSISTABLE_DRAFT_EVIDENCE_SNAPSHOT");
    lineAdjustments.push(adjustment.value);
  }
  if (!header.ok || !headerTotals.ok) return failure("INVALID_ECF31_PERSISTABLE_DRAFT_EVIDENCE_SNAPSHOT");
  const draft = createEcf31CoreDraft({
    header: header.value,
    lineAmounts: lineAdjustments.map((adjustment) => adjustment.lineAmount),
  });
  if (!draft.ok) return failure("INVALID_ECF31_PERSISTABLE_DRAFT_EVIDENCE_SNAPSHOT");

  const evidence = restoreEcf31PersistableDraftEvidenceFromSnapshot({
    draft: draft.value,
    montoItemQuantizations: lineAdjustments.map((adjustment) => adjustment.quantization),
    headerTotals: headerTotals.value,
  }, snapshotVersion);
  return { ok: true, value: evidence };
}
