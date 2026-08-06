import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";

type Code = Readonly<{ type: string; value: string }>;
type Entry = Readonly<{ source: Ecf31LineAmountEvidence; codes: readonly Code[] }>;
export type Ecf31ItemCodeMetadataEvidence = Readonly<{ draft: Ecf31CoreDraft; entries: readonly Entry[] }>;
export type Ecf31ItemCodeMetadataEvidenceError = Readonly<{
  code: "INVALID_ECF31_ITEM_CODE_METADATA_INPUT";
  message: "E-CF 31 item-code metadata input is invalid.";
}>;

const ERROR: Ecf31ItemCodeMetadataEvidenceError = Object.freeze({
  code: "INVALID_ECF31_ITEM_CODE_METADATA_INPUT", message: "E-CF 31 item-code metadata input is invalid.",
});
const evidenceValues = new WeakSet<Ecf31ItemCodeMetadataEvidence>();

function failure(): Result<never, Ecf31ItemCodeMetadataEvidenceError> { return { ok: false, error: ERROR }; }

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

function code(input: unknown): Code | undefined {
  const candidate = record(input, ["type", "value"]);
  if (candidate === undefined || typeof candidate["type"] !== "string" || typeof candidate["value"] !== "string"
    || /^\s*$/u.test(candidate["type"]) || /^\s*$/u.test(candidate["value"])
    || Array.from(candidate["type"]).length > 14 || Array.from(candidate["value"]).length > 35) return undefined;
  return Object.freeze({ type: candidate["type"], value: candidate["value"] });
}

export function createEcf31ItemCodeMetadataEvidence(
  input: unknown,
): Result<Ecf31ItemCodeMetadataEvidence, Ecf31ItemCodeMetadataEvidenceError> {
  const candidate = record(input, ["draft", "entries"]);
  if (candidate === undefined || !isEcf31CoreDraft(candidate["draft"])) return failure();
  const entries = array(candidate["entries"]);
  if (entries === undefined || entries.length !== candidate["draft"].lineAmounts.length) return failure();
  const output: Entry[] = [];
  for (const [index, inputEntry] of entries.entries()) {
    const entry = record(inputEntry, ["source", "codes"]);
    const codes = entry === undefined ? undefined : array(entry["codes"]);
    const source = candidate["draft"].lineAmounts[index] as Ecf31LineAmountEvidence;
    if (entry === undefined || codes === undefined || codes.length > 5 || entry["source"] !== source) return failure();
    const copiedCodes: Code[] = [];
    for (const inputCode of codes) {
      const parsed = code(inputCode);
      if (parsed === undefined) return failure();
      copiedCodes.push(parsed);
    }
    output.push(Object.freeze({ source, codes: Object.freeze(copiedCodes) }));
  }
  const evidence = Object.freeze({ draft: candidate["draft"], entries: Object.freeze(output) });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31ItemCodeMetadataEvidence(input: unknown): input is Ecf31ItemCodeMetadataEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31ItemCodeMetadataEvidence);
}
