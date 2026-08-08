import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";
import { addDecimals, compareDecimals, isExactDecimal, parseNonnegativeAmount, revalidateNonnegativeAmount, revalidatePositivePercentage } from "./exact-decimal.js";
import type { NonnegativeAmount, PositivePercentage } from "./exact-decimal.js";

type Subadjustment = Readonly<{ type: "$" | "%"; amount: NonnegativeAmount; percentage?: PositivePercentage }>;
type Entry = Readonly<{ source: Ecf31LineAmountEvidence; discounts: readonly Subadjustment[]; surcharges: readonly Subadjustment[] }>;
export type Ecf31LineSubadjustmentEvidence = Readonly<{ draft: Ecf31CoreDraft; entries: readonly Entry[] }>;
export type Ecf31LineSubadjustmentEvidenceError = Readonly<{
  code: "INVALID_ECF31_LINE_SUBADJUSTMENT_INPUT";
  message: "E-CF 31 line subadjustment input is invalid.";
}>;

const ERROR: Ecf31LineSubadjustmentEvidenceError = Object.freeze({
  code: "INVALID_ECF31_LINE_SUBADJUSTMENT_INPUT", message: "E-CF 31 line subadjustment input is invalid.",
});
const MAX_SUBADJUSTMENTS = 12;
const zero = (parseNonnegativeAmount("0") as Readonly<{ ok: true; value: NonnegativeAmount }>).value;
const evidenceValues = new WeakSet<Ecf31LineSubadjustmentEvidence>();

function failure(): Result<never, Ecf31LineSubadjustmentEvidenceError> { return { ok: false, error: ERROR }; }

function record(input: unknown, expected: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) return undefined;
    const values: Record<string, unknown> = {};
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      values[key] = descriptor.value;
    }
    return Object.freeze(values);
  } catch { return undefined; }
}

function array(input: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || !Number.isSafeInteger(input.length)) return undefined;
    if (Reflect.ownKeys(input).length !== input.length + 1) return undefined;
    const values: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      values.push(descriptor.value);
    }
    return Object.freeze(values);
  } catch { return undefined; }
}

function subadjustment(input: unknown): Subadjustment | undefined {
  const candidate = record(input, ["type", "amount"])
    ?? record(input, ["type", "amount", "percentage"]);
  if (candidate === undefined || (candidate["type"] !== "$" && candidate["type"] !== "%") || !isExactDecimal(candidate["amount"])) return undefined;
  const amount = revalidateNonnegativeAmount(candidate["amount"]);
  if (!amount.ok) return undefined;
  if (candidate["type"] === "$") return Object.keys(candidate).length === 2 ? Object.freeze({ type: "$" as const, amount: amount.value }) : undefined;
  if (!isExactDecimal(candidate["percentage"])) return undefined;
  const percentage = revalidatePositivePercentage(candidate["percentage"]);
  return percentage.ok ? Object.freeze({ type: "%" as const, amount: amount.value, percentage: percentage.value }) : undefined;
}

function subadjustments(input: unknown, expected: NonnegativeAmount): readonly Subadjustment[] | undefined {
  const candidates = array(input);
  if (candidates === undefined || candidates.length > MAX_SUBADJUSTMENTS) return undefined;
  if (candidates.length > 0 && compareDecimals(expected, zero) === 0) return undefined;
  const values: Subadjustment[] = [];
  let total = zero;
  for (const candidate of candidates) {
    const value = subadjustment(candidate);
    if (value === undefined) return undefined;
    values.push(value); total = addDecimals(total, value.amount) as NonnegativeAmount;
  }
  return compareDecimals(total, expected) === 0 ? Object.freeze(values) : undefined;
}

export function createEcf31LineSubadjustmentEvidence(input: unknown): Result<Ecf31LineSubadjustmentEvidence, Ecf31LineSubadjustmentEvidenceError> {
  const candidate = record(input, ["draft", "entries"]);
  if (candidate === undefined || !isEcf31CoreDraft(candidate["draft"])) return failure();
  const entries = array(candidate["entries"]);
  if (entries === undefined || entries.length !== candidate["draft"].lineAmounts.length) return failure();
  const output: Entry[] = [];
  for (const [index, inputEntry] of entries.entries()) {
    const entry = record(inputEntry, ["source", "discounts", "surcharges"]);
    const source = candidate["draft"].lineAmounts[index];
    if (entry === undefined || source === undefined || entry["source"] !== source) return failure();
    const discounts = subadjustments(entry["discounts"], source.discountAmount);
    const surcharges = subadjustments(entry["surcharges"], source.surchargeAmount);
    if (discounts === undefined || surcharges === undefined) return failure();
    output.push(Object.freeze({ source, discounts, surcharges }));
  }
  const evidence = Object.freeze({ draft: candidate["draft"], entries: Object.freeze(output) });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31LineSubadjustmentEvidence(input: unknown): input is Ecf31LineSubadjustmentEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31LineSubadjustmentEvidence);
}
