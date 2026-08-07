import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";

declare const unitOfMeasureCode: unique symbol;
export type Ecf31UnitOfMeasureCode = string & { readonly [unitOfMeasureCode]: true };
type Entry = Readonly<{ source: Ecf31LineAmountEvidence; unit?: Ecf31UnitOfMeasureCode }>;
export type Ecf31ItemUnitMetadataEvidence = Readonly<{ draft: Ecf31CoreDraft; entries: readonly Entry[] }>;
export type Ecf31ItemUnitMetadataEvidenceError = Readonly<{
  code: "INVALID_ECF31_UNIT_OF_MEASURE_CODE" | "INVALID_ECF31_ITEM_UNIT_METADATA_INPUT";
  message: "Unit of measure code must be a canonical string from 1 through 62." | "E-CF 31 item-unit metadata input is invalid.";
}>;

const CODE_ERROR: Ecf31ItemUnitMetadataEvidenceError = Object.freeze({
  code: "INVALID_ECF31_UNIT_OF_MEASURE_CODE", message: "Unit of measure code must be a canonical string from 1 through 62.",
});
const INPUT_ERROR: Ecf31ItemUnitMetadataEvidenceError = Object.freeze({
  code: "INVALID_ECF31_ITEM_UNIT_METADATA_INPUT", message: "E-CF 31 item-unit metadata input is invalid.",
});
const evidenceValues = new WeakSet<Ecf31ItemUnitMetadataEvidence>();

function inputFailure(): Result<never, Ecf31ItemUnitMetadataEvidenceError> { return { ok: false, error: INPUT_ERROR }; }

function record(input: unknown, expected: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)
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
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return undefined;
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

export function parseEcf31UnitOfMeasureCode(input: unknown): Result<Ecf31UnitOfMeasureCode, Ecf31ItemUnitMetadataEvidenceError> {
  if (typeof input !== "string" || !/^(?:[1-9]|[1-5][0-9]|6[0-2])$/u.test(input)) return { ok: false, error: CODE_ERROR };
  return { ok: true, value: input as Ecf31UnitOfMeasureCode };
}

export function formatEcf31UnitOfMeasureCode(code: Ecf31UnitOfMeasureCode): string { return code; }

function entry(input: unknown, source: Ecf31LineAmountEvidence): Entry | undefined {
  const withoutUnit = record(input, ["source"]);
  if (withoutUnit !== undefined) return withoutUnit["source"] === source ? Object.freeze({ source }) : undefined;
  const withUnit = record(input, ["source", "unit"]);
  if (withUnit === undefined || withUnit["source"] !== source) return undefined;
  const unit = parseEcf31UnitOfMeasureCode(withUnit["unit"]);
  return unit.ok ? Object.freeze({ source, unit: unit.value }) : undefined;
}

export function createEcf31ItemUnitMetadataEvidence(
  input: unknown,
): Result<Ecf31ItemUnitMetadataEvidence, Ecf31ItemUnitMetadataEvidenceError> {
  const candidate = record(input, ["draft", "entries"]);
  if (candidate === undefined || !isEcf31CoreDraft(candidate["draft"])) return inputFailure();
  const entries = array(candidate["entries"]);
  if (entries === undefined || entries.length !== candidate["draft"].lineAmounts.length) return inputFailure();
  const output: Entry[] = [];
  for (const [index, inputEntry] of entries.entries()) {
    const parsed = entry(inputEntry, candidate["draft"].lineAmounts[index] as Ecf31LineAmountEvidence);
    if (parsed === undefined) return inputFailure();
    output.push(parsed);
  }
  const evidence = Object.freeze({ draft: candidate["draft"], entries: Object.freeze(output) });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31ItemUnitMetadataEvidence(input: unknown): input is Ecf31ItemUnitMetadataEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31ItemUnitMetadataEvidence);
}
