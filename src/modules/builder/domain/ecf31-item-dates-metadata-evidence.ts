import { types } from "node:util";

import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";

declare const itemDate: unique symbol;
export type Ecf31ItemDate = string & { readonly [itemDate]: true };
type Entry = Readonly<{ source: Ecf31LineAmountEvidence; elaborationDate?: Ecf31ItemDate; itemExpirationDate?: Ecf31ItemDate }>;
export type Ecf31ItemDatesMetadataEvidence = Readonly<{ draft: Ecf31CoreDraft; entries: readonly Entry[] }>;
export type Ecf31ItemDatesMetadataEvidenceError = Readonly<{
  code: "INVALID_ECF31_ITEM_DATE" | "INVALID_ECF31_ITEM_DATES_METADATA_INPUT";
  message: "Item date must be a real Gregorian DD-MM-YYYY date from 1900 through 2099." | "E-CF 31 item-dates metadata input is invalid.";
}>;

const DATE_ERROR: Ecf31ItemDatesMetadataEvidenceError = Object.freeze({
  code: "INVALID_ECF31_ITEM_DATE", message: "Item date must be a real Gregorian DD-MM-YYYY date from 1900 through 2099.",
});
const INPUT_ERROR: Ecf31ItemDatesMetadataEvidenceError = Object.freeze({
  code: "INVALID_ECF31_ITEM_DATES_METADATA_INPUT", message: "E-CF 31 item-dates metadata input is invalid.",
});
const evidenceValues = new WeakSet<Ecf31ItemDatesMetadataEvidence>();

function inputFailure(): Result<never, Ecf31ItemDatesMetadataEvidenceError> { return { ok: false, error: INPUT_ERROR }; }

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

export function parseEcf31ItemDate(input: unknown): Result<Ecf31ItemDate, Ecf31ItemDatesMetadataEvidenceError> {
  if (typeof input !== "string") return { ok: false, error: DATE_ERROR };
  const match = /^(\d{2})-(\d{2})-(\d{4})$/u.exec(input);
  if (match === null) return { ok: false, error: DATE_ERROR };
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const days = month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (year < 1900 || year > 2099 || month < 1 || month > 12 || day < 1 || day > days) return { ok: false, error: DATE_ERROR };
  return { ok: true, value: input as Ecf31ItemDate };
}

export function formatEcf31ItemDate(date: Ecf31ItemDate): string { return date; }

function entry(input: unknown, source: Ecf31LineAmountEvidence): Result<Entry, Ecf31ItemDatesMetadataEvidenceError> {
  const withoutDates = record(input, ["source"]);
  if (withoutDates !== undefined) return withoutDates["source"] === source ? { ok: true, value: Object.freeze({ source }) } : inputFailure();
  const candidate = record(input, ["source", "elaborationDate", "itemExpirationDate"])
    ?? record(input, ["source", "elaborationDate"])
    ?? record(input, ["source", "itemExpirationDate"]);
  if (candidate === undefined || candidate["source"] !== source) return inputFailure();
  const output: { source: Ecf31LineAmountEvidence; elaborationDate?: Ecf31ItemDate; itemExpirationDate?: Ecf31ItemDate } = { source };
  for (const [key, outputKey] of [["elaborationDate", "elaborationDate"], ["itemExpirationDate", "itemExpirationDate"]] as const) {
    if (!(key in candidate)) continue;
    if (candidate[key] === undefined) return inputFailure();
    const date = parseEcf31ItemDate(candidate[key]);
    if (!date.ok) return date;
    output[outputKey] = date.value;
  }
  return { ok: true, value: Object.freeze(output) };
}

export function createEcf31ItemDatesMetadataEvidence(
  input: unknown,
): Result<Ecf31ItemDatesMetadataEvidence, Ecf31ItemDatesMetadataEvidenceError> {
  const candidate = record(input, ["draft", "entries"]);
  if (candidate === undefined || !isEcf31CoreDraft(candidate["draft"])) return inputFailure();
  const entries = array(candidate["entries"]);
  if (entries === undefined || entries.length !== candidate["draft"].lineAmounts.length) return inputFailure();
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

export function isEcf31ItemDatesMetadataEvidence(input: unknown): input is Ecf31ItemDatesMetadataEvidence {
  return typeof input === "object" && input !== null && !types.isProxy(input) && evidenceValues.has(input as Ecf31ItemDatesMetadataEvidence);
}
