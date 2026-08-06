import type { Result } from "../../../shared/domain/result.js";
import {
  isEcf31AdditionalTaxClassificationEvidence,
} from "./ecf31-additional-tax-classification-evidence.js";
import type {
  Ecf31AdditionalTaxClassificationEvidence,
  Ecf31AdditionalTaxCode,
} from "./ecf31-additional-tax-classification-evidence.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";
import {
  createEcf31MontoItemQuantizationEvidence,
} from "./ecf31-monto-item-quantization-evidence.js";
import type { Ecf31MontoItemQuantizationEvidence } from "./ecf31-monto-item-quantization-evidence.js";
import { revalidatePositiveQuantity } from "./exact-decimal.js";

const MINIMUM_ITEM_COUNT = 1;
const MAXIMUM_ITEM_COUNT = 1000;

type Entry = Readonly<{
  lineAmount: Ecf31LineAmountEvidence;
  montoItem: Ecf31MontoItemQuantizationEvidence;
  additionalTaxCodes: readonly Ecf31AdditionalTaxCode[];
}>;

/** Incomplete, non-issuable evidence boundary for e-CF 31 DetallesItems. */
export type Ecf31DetallesItemsEvidence = Readonly<{
  draft: Ecf31CoreDraft;
  entries: readonly Entry[];
}>;

export type Ecf31DetallesItemsEvidenceErrorCode =
  | "INVALID_ECF31_DETALLES_ITEMS_INPUT"
  | "INVALID_ECF31_DETALLES_ITEMS_DRAFT"
  | "INVALID_ECF31_DETALLES_ITEMS_COUNT"
  | "INVALID_ECF31_DETALLES_ITEMS_QUANTITY"
  | "INVALID_ECF31_DETALLES_ITEMS_MONTO_ITEM"
  | "INVALID_ECF31_DETALLES_ITEMS_CLASSIFICATION"
  | "MISMATCHED_ECF31_DETALLES_ITEMS_CLASSIFICATION";

export type Ecf31DetallesItemsEvidenceError = Readonly<{
  code: Ecf31DetallesItemsEvidenceErrorCode;
  message: string;
}>;

const MESSAGES: Readonly<Record<Ecf31DetallesItemsEvidenceErrorCode, string>> = Object.freeze({
  INVALID_ECF31_DETALLES_ITEMS_INPUT: "E-CF 31 DetallesItems evidence input is invalid.",
  INVALID_ECF31_DETALLES_ITEMS_DRAFT: "E-CF 31 DetallesItems evidence requires a genuine core draft.",
  INVALID_ECF31_DETALLES_ITEMS_COUNT: "E-CF 31 DetallesItems evidence requires from one through 1000 lines.",
  INVALID_ECF31_DETALLES_ITEMS_QUANTITY: "E-CF 31 DetallesItems evidence requires strictly positive line quantities.",
  INVALID_ECF31_DETALLES_ITEMS_MONTO_ITEM: "E-CF 31 DetallesItems evidence could not derive a line MontoItem.",
  INVALID_ECF31_DETALLES_ITEMS_CLASSIFICATION: "E-CF 31 DetallesItems classification evidence must be genuine.",
  MISMATCHED_ECF31_DETALLES_ITEMS_CLASSIFICATION: "E-CF 31 DetallesItems classification evidence must match draft lines in order.",
});
const evidenceValues = new WeakSet<Ecf31DetallesItemsEvidence>();

function failure(code: Ecf31DetallesItemsEvidenceErrorCode): Result<never, Ecf31DetallesItemsEvidenceError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function readInput(input: unknown): Readonly<{
  draft: unknown;
  additionalTaxClassificationEvidence: unknown;
}> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)
      || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    if (!keys.every((key) => key === "draft" || key === "additionalTaxClassificationEvidence")
      || !keys.includes("draft") || keys.length < 1 || keys.length > 2) return undefined;
    const draft = Object.getOwnPropertyDescriptor(input, "draft");
    const classification = Object.getOwnPropertyDescriptor(input, "additionalTaxClassificationEvidence");
    if (draft === undefined || !("value" in draft) || !draft.enumerable
      || (classification !== undefined && (!("value" in classification) || !classification.enumerable))) return undefined;
    return Object.freeze({
      draft: draft.value as unknown,
      additionalTaxClassificationEvidence: classification?.value as unknown,
    });
  } catch {
    return undefined;
  }
}

function classificationMatches(
  classification: Ecf31AdditionalTaxClassificationEvidence,
  draft: Ecf31CoreDraft,
): boolean {
  return classification.draft === draft
    && classification.entries.length === draft.lineAmounts.length
    && classification.entries.every((entry, index) => entry.source === draft.lineAmounts[index]);
}

export function createEcf31DetallesItemsEvidence(
  input: unknown,
): Result<Ecf31DetallesItemsEvidence, Ecf31DetallesItemsEvidenceError> {
  const candidate = readInput(input);
  if (candidate === undefined) return failure("INVALID_ECF31_DETALLES_ITEMS_INPUT");
  if (!isEcf31CoreDraft(candidate.draft)) return failure("INVALID_ECF31_DETALLES_ITEMS_DRAFT");
  const draft = candidate.draft;
  if (draft.lineAmounts.length < MINIMUM_ITEM_COUNT || draft.lineAmounts.length > MAXIMUM_ITEM_COUNT) {
    return failure("INVALID_ECF31_DETALLES_ITEMS_COUNT");
  }

  const classificationInput = candidate.additionalTaxClassificationEvidence;
  if (classificationInput !== undefined && !isEcf31AdditionalTaxClassificationEvidence(classificationInput)) {
    return failure("INVALID_ECF31_DETALLES_ITEMS_CLASSIFICATION");
  }
  if (classificationInput !== undefined && !classificationMatches(classificationInput, draft)) {
    return failure("MISMATCHED_ECF31_DETALLES_ITEMS_CLASSIFICATION");
  }

  const entries: Entry[] = [];
  for (const [index, lineAmount] of draft.lineAmounts.entries()) {
    if (!revalidatePositiveQuantity(lineAmount.coreLine.evidence.quantity).ok) {
      return failure("INVALID_ECF31_DETALLES_ITEMS_QUANTITY");
    }
    const montoItem = createEcf31MontoItemQuantizationEvidence(lineAmount);
    if (!montoItem.ok) return failure("INVALID_ECF31_DETALLES_ITEMS_MONTO_ITEM");
    const additionalTaxCodes = classificationInput === undefined
      ? Object.freeze([] as Ecf31AdditionalTaxCode[])
      : Object.freeze([...(
        classificationInput.entries[index] as Ecf31AdditionalTaxClassificationEvidence["entries"][number]
      ).codes]);
    entries.push(Object.freeze({ lineAmount, montoItem: montoItem.value, additionalTaxCodes }));
  }

  const evidence = Object.freeze({ draft, entries: Object.freeze(entries) });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31DetallesItemsEvidence(input: unknown): input is Ecf31DetallesItemsEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31DetallesItemsEvidence);
}
