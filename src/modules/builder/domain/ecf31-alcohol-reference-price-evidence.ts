import { types } from "node:util";

import type { Result } from "../../../shared/domain/result.js";
import { isEcf31AdditionalTaxClassificationEvidence } from "./ecf31-additional-tax-classification-evidence.js";
import type { Ecf31AdditionalTaxClassificationEvidence } from "./ecf31-additional-tax-classification-evidence.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";
import { isExactDecimal, revalidateEcf31AlcoholDegrees, revalidatePositiveAmount } from "./exact-decimal.js";
import type { Ecf31AlcoholDegrees, PositiveAmount } from "./exact-decimal.js";

type Entry = Readonly<{
  source: Ecf31LineAmountEvidence;
  alcoholDegrees?: Ecf31AlcoholDegrees;
  referenceUnitPrice?: PositiveAmount;
}>;
export type Ecf31AlcoholReferencePriceEvidence = Readonly<{
  draft: Ecf31CoreDraft;
  classification: Ecf31AdditionalTaxClassificationEvidence;
  entries: readonly Entry[];
}>;
export type Ecf31AlcoholReferencePriceEvidenceError = Readonly<{
  code: "INVALID_ECF31_ALCOHOL_REFERENCE_PRICE_INPUT";
  message: "E-CF 31 alcohol and reference-price evidence input is invalid.";
}>;

const INPUT_ERROR: Ecf31AlcoholReferencePriceEvidenceError = Object.freeze({
  code: "INVALID_ECF31_ALCOHOL_REFERENCE_PRICE_INPUT",
  message: "E-CF 31 alcohol and reference-price evidence input is invalid.",
});
const evidenceValues = new WeakSet<Ecf31AlcoholReferencePriceEvidence>();

function failure(): Result<never, Ecf31AlcoholReferencePriceEvidenceError> { return { ok: false, error: INPUT_ERROR }; }

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
    if (!Number.isSafeInteger(length) || Reflect.ownKeys(input).length !== length + 1) return undefined;
    const copied: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      copied.push(descriptor.value);
    }
    return Object.freeze(copied);
  } catch { return undefined; }
}

function entry(input: unknown, source: Ecf31LineAmountEvidence, requiresAlcohol: boolean, requiresPrice: boolean): Entry | undefined {
  const keys = ["source", ...(requiresAlcohol ? ["alcoholDegrees"] : []), ...(requiresPrice ? ["referenceUnitPrice"] : [])];
  const candidate = record(input, keys);
  if (candidate === undefined || candidate["source"] !== source) return undefined;
  const alcoholDegrees = candidate["alcoholDegrees"];
  const referenceUnitPrice = candidate["referenceUnitPrice"];
  if ((requiresAlcohol && !isExactDecimal(alcoholDegrees)) || (requiresPrice && !isExactDecimal(referenceUnitPrice))) return undefined;
  const alcohol = requiresAlcohol ? revalidateEcf31AlcoholDegrees(alcoholDegrees as Ecf31AlcoholDegrees) : undefined;
  const price = requiresPrice ? revalidatePositiveAmount(referenceUnitPrice as PositiveAmount) : undefined;
  if ((alcohol !== undefined && !alcohol.ok) || (price !== undefined && !price.ok)) return undefined;
  return Object.freeze({ source, ...(alcohol?.ok ? { alcoholDegrees: alcohol.value } : {}), ...(price?.ok ? { referenceUnitPrice: price.value } : {}) });
}

export function createEcf31AlcoholReferencePriceEvidence(
  input: unknown,
): Result<Ecf31AlcoholReferencePriceEvidence, Ecf31AlcoholReferencePriceEvidenceError> {
  const candidate = record(input, ["draft", "classification", "entries"]);
  if (candidate === undefined || !isEcf31CoreDraft(candidate["draft"])
    || !isEcf31AdditionalTaxClassificationEvidence(candidate["classification"])
    || candidate["classification"].draft !== candidate["draft"]) return failure();
  const entries = array(candidate["entries"]);
  if (entries === undefined || entries.length !== candidate["draft"].lineAmounts.length) return failure();
  const output: Entry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const codes = candidate["classification"].entries[index]?.codes;
    const parsed = codes === undefined ? undefined : entry(entries[index], candidate["draft"].lineAmounts[index] as Ecf31LineAmountEvidence,
      codes.some((code) => code >= "006" && code <= "018"), codes.some((code) => code >= "023" && code <= "039"));
    if (parsed === undefined) return failure();
    output.push(parsed);
  }
  const evidence = Object.freeze({ draft: candidate["draft"], classification: candidate["classification"], entries: Object.freeze(output) });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31AlcoholReferencePriceEvidence(input: unknown): input is Ecf31AlcoholReferencePriceEvidence {
  try { return typeof input === "object" && input !== null && !types.isProxy(input) && evidenceValues.has(input as Ecf31AlcoholReferencePriceEvidence); }
  catch { return false; }
}
