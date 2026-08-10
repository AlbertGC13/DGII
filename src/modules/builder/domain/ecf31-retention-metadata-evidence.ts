import { types } from "node:util";

import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";
import { parseNonnegativeAmount } from "./exact-decimal.js";
import type { NonnegativeAmount } from "./exact-decimal.js";

declare const ecf31RetentionIndicatorBrand: unique symbol;
export type Ecf31RetentionIndicator = (1 | 2) & Readonly<{ readonly [ecf31RetentionIndicatorBrand]: true }>;

type Entry = Readonly<{
  source: Ecf31LineAmountEvidence;
  indicator?: Ecf31RetentionIndicator;
  itbisRetainedAmount?: NonnegativeAmount;
  isrRetainedAmount?: NonnegativeAmount;
}>;
export type Ecf31RetentionMetadataEvidence = Readonly<{ draft: Ecf31CoreDraft; entries: readonly Entry[] }>;
export type Ecf31RetentionMetadataEvidenceErrorCode =
  | "INVALID_ECF31_RETENTION_METADATA_INPUT"
  | "INVALID_ECF31_RETENTION_INDICATOR"
  | "INVALID_ECF31_RETENTION_AMOUNT";
export type Ecf31RetentionMetadataEvidenceError = Readonly<{
  code: Ecf31RetentionMetadataEvidenceErrorCode;
  message: string;
}>;

const MESSAGES: Readonly<Record<Ecf31RetentionMetadataEvidenceErrorCode, string>> = Object.freeze({
  INVALID_ECF31_RETENTION_METADATA_INPUT: "E-CF 31 retention metadata input is invalid.",
  INVALID_ECF31_RETENTION_INDICATOR: "Retention indicator must be 1 (retention) or 2 (perception).",
  INVALID_ECF31_RETENTION_AMOUNT: "Retention amount must be a nonnegative decimal with max scale 2.",
});
const evidenceValues = new WeakSet<Ecf31RetentionMetadataEvidence>();
const OPTIONAL_ENTRY_KEYS = ["indicator", "itbisRetainedAmount", "isrRetainedAmount"] as const;

function failure(code: Ecf31RetentionMetadataEvidenceErrorCode): Result<never, Ecf31RetentionMetadataEvidenceError> {
  return { ok: false, error: Object.freeze({ code, message: MESSAGES[code] }) };
}

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

export function parseEcf31RetentionIndicator(input: unknown): Result<Ecf31RetentionIndicator, Ecf31RetentionMetadataEvidenceError> {
  if (input !== 1 && input !== 2) return failure("INVALID_ECF31_RETENTION_INDICATOR");
  return { ok: true, value: input as Ecf31RetentionIndicator };
}

export function formatEcf31RetentionIndicator(indicator: Ecf31RetentionIndicator): string {
  return indicator === 1 ? "1" : "2";
}

function entry(input: unknown, source: Ecf31LineAmountEvidence): Result<Entry, Ecf31RetentionMetadataEvidenceError> {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || types.isProxy(input)) return failure("INVALID_ECF31_RETENTION_METADATA_INPUT");
    const present = OPTIONAL_ENTRY_KEYS.filter((key) => key in (input as Record<string, unknown>));
    const candidate = record(input, ["source", ...present]);
    if (candidate === undefined || candidate["source"] !== source) return failure("INVALID_ECF31_RETENTION_METADATA_INPUT");
    const output: { source: Ecf31LineAmountEvidence; indicator?: Ecf31RetentionIndicator; itbisRetainedAmount?: NonnegativeAmount; isrRetainedAmount?: NonnegativeAmount } = { source };
    if ("indicator" in candidate) {
      if (candidate["indicator"] === undefined) return failure("INVALID_ECF31_RETENTION_METADATA_INPUT");
      const indicator = parseEcf31RetentionIndicator(candidate["indicator"]);
      if (!indicator.ok) return indicator;
      output.indicator = indicator.value;
    }
    if ("itbisRetainedAmount" in candidate) {
      if (candidate["itbisRetainedAmount"] === undefined) return failure("INVALID_ECF31_RETENTION_METADATA_INPUT");
      const amount = parseNonnegativeAmount(candidate["itbisRetainedAmount"]);
      if (!amount.ok) return failure("INVALID_ECF31_RETENTION_AMOUNT");
      output.itbisRetainedAmount = amount.value;
    }
    if ("isrRetainedAmount" in candidate) {
      if (candidate["isrRetainedAmount"] === undefined) return failure("INVALID_ECF31_RETENTION_METADATA_INPUT");
      const amount = parseNonnegativeAmount(candidate["isrRetainedAmount"]);
      if (!amount.ok) return failure("INVALID_ECF31_RETENTION_AMOUNT");
      output.isrRetainedAmount = amount.value;
    }
    return { ok: true, value: Object.freeze(output) };
  } catch {
    return failure("INVALID_ECF31_RETENTION_METADATA_INPUT");
  }
}

export function createEcf31RetentionMetadataEvidence(
  input: unknown,
): Result<Ecf31RetentionMetadataEvidence, Ecf31RetentionMetadataEvidenceError> {
  const candidate = record(input, ["draft", "entries"]);
  if (candidate === undefined || !isEcf31CoreDraft(candidate["draft"])) return failure("INVALID_ECF31_RETENTION_METADATA_INPUT");
  const entries = array(candidate["entries"]);
  if (entries === undefined || entries.length !== candidate["draft"].lineAmounts.length) return failure("INVALID_ECF31_RETENTION_METADATA_INPUT");
  const output: Entry[] = [];
  for (const [index, inputEntry] of entries.entries()) {
    const parsed = entry(inputEntry, candidate["draft"].lineAmounts[index] as Ecf31LineAmountEvidence);
    if (!parsed.ok) return parsed;
    output.push(parsed.value);
  }
  const evidence = Object.freeze({ draft: candidate["draft"], entries: Object.freeze(output) });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31RetentionMetadataEvidence(input: unknown): input is Ecf31RetentionMetadataEvidence {
  return typeof input === "object" && input !== null && !types.isProxy(input) && evidenceValues.has(input as Ecf31RetentionMetadataEvidence);
}
