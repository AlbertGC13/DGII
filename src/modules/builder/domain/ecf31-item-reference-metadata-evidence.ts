import { types } from "node:util";

import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";
import { formatDecimal, parseNonnegativeAmount } from "./exact-decimal.js";
import type { NonnegativeAmount } from "./exact-decimal.js";
import { parseEcf31UnitOfMeasureCode } from "./ecf31-item-unit-metadata-evidence.js";
import type { Ecf31UnitOfMeasureCode } from "./ecf31-item-unit-metadata-evidence.js";

export type Ecf31ReferenceQuantity = NonnegativeAmount;
type Entry = Readonly<{ source: Ecf31LineAmountEvidence; quantity?: Ecf31ReferenceQuantity; unit?: Ecf31UnitOfMeasureCode }>;
export type Ecf31ItemReferenceMetadataEvidence = Readonly<{ draft: Ecf31CoreDraft; entries: readonly Entry[] }>;
export type Ecf31ItemReferenceMetadataEvidenceError = Readonly<{
  code: "INVALID_ECF31_ITEM_REFERENCE_METADATA_INPUT";
  message: "E-CF 31 item-reference metadata input is invalid.";
}>;

const INPUT_ERROR: Ecf31ItemReferenceMetadataEvidenceError = Object.freeze({
  code: "INVALID_ECF31_ITEM_REFERENCE_METADATA_INPUT", message: "E-CF 31 item-reference metadata input is invalid.",
});
const evidenceValues = new WeakSet<Ecf31ItemReferenceMetadataEvidence>();

function failure(): Result<never, Ecf31ItemReferenceMetadataEvidenceError> { return { ok: false, error: INPUT_ERROR }; }

function record(input: unknown, expected: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || types.isProxy(input)
      || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) return undefined;
    const copied: Record<string, unknown> = {};
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      copied[key] = descriptor.value;
    }
    return Object.freeze(copied);
  } catch { return undefined; }
}

function array(input: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype) return undefined;
    const length = input.length;
    const keys = Reflect.ownKeys(input);
    if (!Number.isSafeInteger(length) || keys.length !== length + 1) return undefined;
    const copied: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      copied.push(descriptor.value);
    }
    return Object.freeze(copied);
  } catch { return undefined; }
}

function entry(input: unknown, source: Ecf31LineAmountEvidence): Entry | undefined {
  const absent = record(input, ["source"]);
  if (absent !== undefined) return absent["source"] === source ? Object.freeze({ source }) : undefined;
  const paired = record(input, ["source", "quantity", "unit"]);
  if (paired === undefined || paired["source"] !== source || paired["quantity"] === undefined || paired["unit"] === undefined) return undefined;
  const quantity = parseNonnegativeAmount(paired["quantity"]);
  const unit = parseEcf31UnitOfMeasureCode(paired["unit"]);
  return quantity.ok && unit.ok ? Object.freeze({ source, quantity: quantity.value, unit: unit.value }) : undefined;
}

export function createEcf31ItemReferenceMetadataEvidence(
  input: unknown,
): Result<Ecf31ItemReferenceMetadataEvidence, Ecf31ItemReferenceMetadataEvidenceError> {
  const candidate = record(input, ["draft", "entries"]);
  if (candidate === undefined || !isEcf31CoreDraft(candidate["draft"])) return failure();
  const entries = array(candidate["entries"]);
  if (entries === undefined || entries.length !== candidate["draft"].lineAmounts.length) return failure();
  const output: Entry[] = [];
  for (const [index, inputEntry] of entries.entries()) {
    const parsed = entry(inputEntry, candidate["draft"].lineAmounts[index] as Ecf31LineAmountEvidence);
    if (parsed === undefined) return failure();
    output.push(parsed);
  }
  const evidence = Object.freeze({ draft: candidate["draft"], entries: Object.freeze(output) });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function formatEcf31ReferenceQuantity(quantity: Ecf31ReferenceQuantity): string { return formatDecimal(quantity); }

export function isEcf31ItemReferenceMetadataEvidence(input: unknown): input is Ecf31ItemReferenceMetadataEvidence {
  try { return typeof input === "object" && input !== null && !types.isProxy(input) && evidenceValues.has(input as Ecf31ItemReferenceMetadataEvidence); }
  catch { return false; }
}
