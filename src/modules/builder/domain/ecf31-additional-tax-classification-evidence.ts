import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import { isEcf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";

declare const additionalTaxCode: unique symbol;
export type Ecf31AdditionalTaxCode = string & { readonly [additionalTaxCode]: true };
export const ECF31_ADDITIONAL_TAX_CLASSIFICATION_POLICY_ID = "ecf31-additional-tax-classification-v1";

type Entry = Readonly<{ source: Ecf31LineAmountEvidence; codes: readonly Ecf31AdditionalTaxCode[] }>;
export type Ecf31AdditionalTaxClassificationEvidence = Readonly<{
  draft: Ecf31CoreDraft;
  entries: readonly Entry[];
  qualifyingIscAbsent: boolean;
  policyId: typeof ECF31_ADDITIONAL_TAX_CLASSIFICATION_POLICY_ID;
}>;
export type Ecf31AdditionalTaxClassificationEvidenceErrorCode =
  | "INVALID_ECF31_ADDITIONAL_TAX_CODE"
  | "INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_INPUT"
  | "INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_DRAFT"
  | "INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_COLLECTION"
  | "INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_ENTRY"
  | "INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_LINE"
  | "INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_CODE"
  | "DUPLICATE_ECF31_ADDITIONAL_TAX_CLASSIFICATION_CODE"
  | "ECF31_ADDITIONAL_TAX_CLASSIFICATION_LINE_MISMATCH";
export type Ecf31AdditionalTaxClassificationEvidenceError = Readonly<{
  code: Ecf31AdditionalTaxClassificationEvidenceErrorCode;
  message: string;
}>;

const MESSAGES: Readonly<Record<Ecf31AdditionalTaxClassificationEvidenceErrorCode, string>> = Object.freeze({
  INVALID_ECF31_ADDITIONAL_TAX_CODE: "Additional-tax code must be a canonical code from 001 through 039.",
  INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_INPUT: "Additional-tax classification input is invalid.",
  INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_DRAFT: "Additional-tax classification requires a genuine E-CF 31 core draft.",
  INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_COLLECTION: "Additional-tax classification requires dense code and entry collections.",
  INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_ENTRY: "Additional-tax classification entries are invalid.",
  INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_LINE: "Additional-tax classification requires genuine line amount evidence.",
  INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_CODE: "Additional-tax classification contains an invalid code.",
  DUPLICATE_ECF31_ADDITIONAL_TAX_CLASSIFICATION_CODE: "Additional-tax classification entries must not repeat a code.",
  ECF31_ADDITIONAL_TAX_CLASSIFICATION_LINE_MISMATCH: "Additional-tax classification entries must match draft lines in order.",
});
const evidenceValues = new WeakSet<Ecf31AdditionalTaxClassificationEvidence>();

function failure(code: Ecf31AdditionalTaxClassificationEvidenceErrorCode): Result<never, Ecf31AdditionalTaxClassificationEvidenceError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function readDenseArray(input: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    const length = Object.getOwnPropertyDescriptor(input, "length");
    if (keys.length !== input.length + 1 || length === undefined || !("value" in length) || length.value !== input.length) return undefined;
    const values: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      values.push(descriptor.value);
    }
    return Object.freeze(values);
  } catch { return undefined; }
}

function readRecord(input: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)
      || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) return undefined;
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.length !== keys.length || !keys.every((key) => ownKeys.includes(key))) return undefined;
    const values: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      values[key] = descriptor.value;
    }
    return Object.freeze(values);
  } catch { return undefined; }
}

export function parseEcf31AdditionalTaxCode(input: unknown): Result<Ecf31AdditionalTaxCode, Ecf31AdditionalTaxClassificationEvidenceError> {
  if (typeof input !== "string" || !/^(00[1-9]|0[12][0-9]|03[0-9])$/.test(input)) return failure("INVALID_ECF31_ADDITIONAL_TAX_CODE");
  return { ok: true, value: input as Ecf31AdditionalTaxCode };
}

export function formatEcf31AdditionalTaxCode(code: Ecf31AdditionalTaxCode): string { return code; }

export function isEcf31QualifyingIscCode(code: Ecf31AdditionalTaxCode): boolean { return code >= "006"; }

export function createEcf31AdditionalTaxClassificationEvidence(input: unknown): Result<Ecf31AdditionalTaxClassificationEvidence, Ecf31AdditionalTaxClassificationEvidenceError> {
  const candidate = readRecord(input, ["draft", "entries"]);
  if (candidate === undefined) return failure("INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_INPUT");
  const draft = candidate["draft"];
  if (!isEcf31CoreDraft(draft)) return failure("INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_DRAFT");
  const entries = readDenseArray(candidate["entries"]);
  if (entries === undefined) return failure("INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_COLLECTION");
  const output: Entry[] = [];
  for (const entryInput of entries) {
    const entry = readRecord(entryInput, ["source", "codes"]);
    if (entry === undefined) return failure("INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_ENTRY");
    const source = entry["source"];
    if (!isEcf31LineAmountEvidence(source)) return failure("INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_LINE");
    const codes = readDenseArray(entry["codes"]);
    if (codes === undefined || codes.length > 2) return failure("INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_COLLECTION");
    const parsed: Ecf31AdditionalTaxCode[] = [];
    for (const code of codes) {
      const result = parseEcf31AdditionalTaxCode(code);
      if (!result.ok) return failure("INVALID_ECF31_ADDITIONAL_TAX_CLASSIFICATION_CODE");
      if (parsed.includes(result.value)) return failure("DUPLICATE_ECF31_ADDITIONAL_TAX_CLASSIFICATION_CODE");
      parsed.push(result.value);
    }
    output.push(Object.freeze({ source, codes: Object.freeze(parsed) }));
  }
  if (output.length !== draft.lineAmounts.length || output.some((entry, index) => entry.source !== draft.lineAmounts[index])) {
    return failure("ECF31_ADDITIONAL_TAX_CLASSIFICATION_LINE_MISMATCH");
  }
  const evidence = Object.freeze({ draft, entries: Object.freeze(output),
    qualifyingIscAbsent: !output.some((entry) => entry.codes.some(isEcf31QualifyingIscCode)), policyId: ECF31_ADDITIONAL_TAX_CLASSIFICATION_POLICY_ID });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31AdditionalTaxClassificationEvidence(input: unknown): input is Ecf31AdditionalTaxClassificationEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31AdditionalTaxClassificationEvidence);
}
