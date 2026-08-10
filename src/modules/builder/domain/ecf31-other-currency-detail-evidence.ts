import { types } from "node:util";

import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";
import { parseNonnegativeAmount, parseUnitPrice } from "./exact-decimal.js";
import type { NonnegativeAmount, UnitPrice } from "./exact-decimal.js";

type Entry = Readonly<{
  source: Ecf31LineAmountEvidence;
  precioOtraMoneda?: UnitPrice;
  descuento?: NonnegativeAmount;
  recargo?: NonnegativeAmount;
  montoItemOtraMoneda?: NonnegativeAmount;
}>;
export type Ecf31OtherCurrencyDetailEvidence = Readonly<{
  draft: Ecf31CoreDraft;
  entries: readonly Entry[];
}>;
export type Ecf31OtherCurrencyDetailEvidenceErrorCode =
  | "INVALID_ECF31_OTHER_CURRENCY_DETAIL_INPUT"
  | "EMPTY_ECF31_OTHER_CURRENCY_DETAIL"
  | "INVALID_ECF31_OTHER_CURRENCY_PRICE"
  | "INVALID_ECF31_OTHER_CURRENCY_AMOUNT";
export type Ecf31OtherCurrencyDetailEvidenceError = Readonly<{
  code: Ecf31OtherCurrencyDetailEvidenceErrorCode;
  message: string;
}>;

const MESSAGES: Readonly<Record<Ecf31OtherCurrencyDetailEvidenceErrorCode, string>> = Object.freeze({
  INVALID_ECF31_OTHER_CURRENCY_DETAIL_INPUT: "E-CF 31 other-currency detail input is invalid.",
  EMPTY_ECF31_OTHER_CURRENCY_DETAIL: "E-CF 31 other-currency detail must contain at least one supplied value.",
  INVALID_ECF31_OTHER_CURRENCY_PRICE: "Other-currency price must be a nonnegative decimal with at most 20 digits and scale 4.",
  INVALID_ECF31_OTHER_CURRENCY_AMOUNT: "Other-currency amount must be a nonnegative decimal with at most 18 digits and scale 2.",
});
const OPTIONAL_KEYS = ["precioOtraMoneda", "descuento", "recargo", "montoItemOtraMoneda"] as const;
const evidenceValues = new WeakSet<Ecf31OtherCurrencyDetailEvidence>();

function failure(code: Ecf31OtherCurrencyDetailEvidenceErrorCode): Result<never, Ecf31OtherCurrencyDetailEvidenceError> {
  return { ok: false, error: Object.freeze({ code, message: MESSAGES[code] }) };
}

function record(input: unknown, expected: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || types.isProxy(input)
      || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== expected.length || !keys.every((key) => typeof key === "string" && expected.includes(key))) return undefined;
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
    if (!Number.isSafeInteger(length)) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== length + 1) return undefined;
    const copied: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      copied.push(descriptor.value);
    }
    return Object.freeze(copied);
  } catch { return undefined; }
}

function entry(input: unknown, source: Ecf31LineAmountEvidence): Result<Entry, Ecf31OtherCurrencyDetailEvidenceError> {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || types.isProxy(input)) return failure("INVALID_ECF31_OTHER_CURRENCY_DETAIL_INPUT");
    const keys = Reflect.ownKeys(input);
    if (!keys.every((key) => typeof key === "string") || !keys.includes("source")
      || !keys.every((key) => key === "source" || OPTIONAL_KEYS.includes(key as typeof OPTIONAL_KEYS[number]))) return failure("INVALID_ECF31_OTHER_CURRENCY_DETAIL_INPUT");
    const candidate = record(input, keys);
    if (candidate === undefined || candidate["source"] !== source) return failure("INVALID_ECF31_OTHER_CURRENCY_DETAIL_INPUT");
    const output: { source: Ecf31LineAmountEvidence; precioOtraMoneda?: UnitPrice; descuento?: NonnegativeAmount; recargo?: NonnegativeAmount; montoItemOtraMoneda?: NonnegativeAmount } = { source };
    if ("precioOtraMoneda" in candidate) {
      if (candidate["precioOtraMoneda"] === undefined) return failure("INVALID_ECF31_OTHER_CURRENCY_DETAIL_INPUT");
      const price = parseUnitPrice(candidate["precioOtraMoneda"]);
      if (!price.ok) return failure("INVALID_ECF31_OTHER_CURRENCY_PRICE");
      output.precioOtraMoneda = price.value;
    }
    for (const key of ["descuento", "recargo", "montoItemOtraMoneda"] as const) {
      if (!(key in candidate)) continue;
      if (candidate[key] === undefined) return failure("INVALID_ECF31_OTHER_CURRENCY_DETAIL_INPUT");
      const amount = parseNonnegativeAmount(candidate[key]);
      if (!amount.ok) return failure("INVALID_ECF31_OTHER_CURRENCY_AMOUNT");
      output[key] = amount.value;
    }
    return { ok: true, value: Object.freeze(output) };
  } catch { return failure("INVALID_ECF31_OTHER_CURRENCY_DETAIL_INPUT"); }
}

export function createEcf31OtherCurrencyDetailEvidence(
  input: unknown,
): Result<Ecf31OtherCurrencyDetailEvidence, Ecf31OtherCurrencyDetailEvidenceError> {
  const candidate = record(input, ["draft", "entries"]);
  if (candidate === undefined || !isEcf31CoreDraft(candidate["draft"])) return failure("INVALID_ECF31_OTHER_CURRENCY_DETAIL_INPUT");
  const entries = array(candidate["entries"]);
  if (entries === undefined || entries.length !== candidate["draft"].lineAmounts.length) return failure("INVALID_ECF31_OTHER_CURRENCY_DETAIL_INPUT");
  const output: Entry[] = [];
  let hasSuppliedValue = false;
  for (const [index, inputEntry] of entries.entries()) {
    const parsed = entry(inputEntry, candidate["draft"].lineAmounts[index] as Ecf31LineAmountEvidence);
    if (!parsed.ok) return parsed;
    hasSuppliedValue ||= OPTIONAL_KEYS.some((key) => key in parsed.value);
    output.push(parsed.value);
  }
  if (!hasSuppliedValue) return failure("EMPTY_ECF31_OTHER_CURRENCY_DETAIL");
  const evidence = Object.freeze({ draft: candidate["draft"], entries: Object.freeze(output) });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31OtherCurrencyDetailEvidence(input: unknown): input is Ecf31OtherCurrencyDetailEvidence {
  return typeof input === "object" && input !== null && !types.isProxy(input) && evidenceValues.has(input as Ecf31OtherCurrencyDetailEvidence);
}
