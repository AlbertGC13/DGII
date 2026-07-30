import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import { isEcf31HeaderTotalsEvidence } from "./ecf31-header-totals-evidence.js";
import type { Ecf31HeaderTotalsEvidence } from "./ecf31-header-totals-evidence.js";
import { isEcf31MontoItemQuantizationEvidence } from "./ecf31-monto-item-quantization-evidence.js";
import type { Ecf31MontoItemQuantizationEvidence } from "./ecf31-monto-item-quantization-evidence.js";

/** Incomplete, non-issuable evidence boundary for a future persistence snapshot. */
export type Ecf31PersistableDraftEvidence = Readonly<{
  draft: Ecf31CoreDraft;
  montoItemQuantizations: readonly Ecf31MontoItemQuantizationEvidence[];
  headerTotals: Ecf31HeaderTotalsEvidence;
}>;

export type Ecf31PersistableDraftEvidenceErrorCode =
  | "INVALID_PERSISTABLE_DRAFT_EVIDENCE_INPUT"
  | "INVALID_PERSISTABLE_DRAFT"
  | "INVALID_MONTO_ITEM_QUANTIZATION_COLLECTION"
  | "INVALID_MONTO_ITEM_QUANTIZATION_EVIDENCE"
  | "MISMATCHED_MONTO_ITEM_QUANTIZATION_EVIDENCE"
  | "INVALID_HEADER_TOTALS_EVIDENCE";

export type Ecf31PersistableDraftEvidenceError = Readonly<{
  code: Ecf31PersistableDraftEvidenceErrorCode;
  message: string;
}>;

const MESSAGES: Readonly<Record<Ecf31PersistableDraftEvidenceErrorCode, string>> = Object.freeze({
  INVALID_PERSISTABLE_DRAFT_EVIDENCE_INPUT: "Persistable E-CF 31 draft evidence input is invalid.",
  INVALID_PERSISTABLE_DRAFT: "Persistable E-CF 31 draft evidence requires a genuine core draft.",
  INVALID_MONTO_ITEM_QUANTIZATION_COLLECTION: "Persistable E-CF 31 draft evidence requires a nonempty quantization evidence collection.",
  INVALID_MONTO_ITEM_QUANTIZATION_EVIDENCE: "Persistable E-CF 31 draft evidence requires genuine quantization evidence.",
  MISMATCHED_MONTO_ITEM_QUANTIZATION_EVIDENCE: "Quantization evidence must match draft lines by identity and order.",
  INVALID_HEADER_TOTALS_EVIDENCE: "Persistable E-CF 31 draft evidence requires genuine header totals evidence.",
});
const evidenceValues = new WeakSet<Ecf31PersistableDraftEvidence>();

function failure(code: Ecf31PersistableDraftEvidenceErrorCode): Result<never, Ecf31PersistableDraftEvidenceError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null;
}

function readCandidates(input: Readonly<Record<string, unknown>>): Readonly<{
  draft: unknown;
  montoItemQuantizations: unknown;
  headerTotals: unknown;
}> | undefined {
  try {
    return {
      draft: input["draft"],
      montoItemQuantizations: input["montoItemQuantizations"],
      headerTotals: input["headerTotals"],
    };
  } catch {
    return undefined;
  }
}

function copyQuantizations(input: unknown): readonly unknown[] | undefined {
  try {
    return Array.isArray(input) && input.length > 0 ? Array.from(input) : undefined;
  } catch {
    return undefined;
  }
}

export function createEcf31PersistableDraftEvidence(
  input: unknown,
): Result<Ecf31PersistableDraftEvidence, Ecf31PersistableDraftEvidenceError> {
  if (!isRecord(input)) return failure("INVALID_PERSISTABLE_DRAFT_EVIDENCE_INPUT");
  const candidates = readCandidates(input);
  if (candidates === undefined) return failure("INVALID_PERSISTABLE_DRAFT_EVIDENCE_INPUT");
  const draft = candidates.draft;
  if (!isEcf31CoreDraft(draft)) return failure("INVALID_PERSISTABLE_DRAFT");
  const montoItemQuantizations = copyQuantizations(candidates.montoItemQuantizations);
  if (montoItemQuantizations === undefined) return failure("INVALID_MONTO_ITEM_QUANTIZATION_COLLECTION");
  if (!montoItemQuantizations.every(isEcf31MontoItemQuantizationEvidence)) {
    return failure("INVALID_MONTO_ITEM_QUANTIZATION_EVIDENCE");
  }
  if (!isEcf31HeaderTotalsEvidence(candidates.headerTotals)) return failure("INVALID_HEADER_TOTALS_EVIDENCE");
  if (montoItemQuantizations.length !== draft.lineAmounts.length) {
    return failure("MISMATCHED_MONTO_ITEM_QUANTIZATION_EVIDENCE");
  }
  if (!montoItemQuantizations.every((evidence, index) => evidence.sourceEvidence === draft.lineAmounts[index])) {
    return failure("MISMATCHED_MONTO_ITEM_QUANTIZATION_EVIDENCE");
  }

  const evidence = Object.freeze({
    draft,
    montoItemQuantizations: Object.freeze([...montoItemQuantizations]),
    headerTotals: candidates.headerTotals,
  });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31PersistableDraftEvidence(input: unknown): input is Ecf31PersistableDraftEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31PersistableDraftEvidence);
}
