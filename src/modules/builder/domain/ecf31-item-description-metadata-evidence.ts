import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";

type Entry = Readonly<{ source: Ecf31LineAmountEvidence; description?: string }>;
export type Ecf31ItemDescriptionMetadataEvidence = Readonly<{ draft: Ecf31CoreDraft; entries: readonly Entry[] }>;
export type Ecf31ItemDescriptionMetadataEvidenceError = Readonly<{
  code: "INVALID_ECF31_ITEM_DESCRIPTION_METADATA_INPUT";
  message: "E-CF 31 item-description metadata input is invalid.";
}>;

const ERROR: Ecf31ItemDescriptionMetadataEvidenceError = Object.freeze({
  code: "INVALID_ECF31_ITEM_DESCRIPTION_METADATA_INPUT", message: "E-CF 31 item-description metadata input is invalid.",
});
const evidenceValues = new WeakSet<Ecf31ItemDescriptionMetadataEvidence>();

function failure(): Result<never, Ecf31ItemDescriptionMetadataEvidenceError> { return { ok: false, error: ERROR }; }

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

function entry(input: unknown, source: Ecf31LineAmountEvidence): Entry | undefined {
  const withoutDescription = record(input, ["source"]);
  if (withoutDescription !== undefined) return withoutDescription["source"] === source ? Object.freeze({ source }) : undefined;
  const withDescription = record(input, ["source", "description"]);
  if (withDescription === undefined || withDescription["source"] !== source || typeof withDescription["description"] !== "string"
    || /^\s*$/u.test(withDescription["description"]) || Array.from(withDescription["description"]).length > 1000) return undefined;
  return Object.freeze({ source, description: withDescription["description"] });
}

export function createEcf31ItemDescriptionMetadataEvidence(
  input: unknown,
): Result<Ecf31ItemDescriptionMetadataEvidence, Ecf31ItemDescriptionMetadataEvidenceError> {
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

export function isEcf31ItemDescriptionMetadataEvidence(input: unknown): input is Ecf31ItemDescriptionMetadataEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31ItemDescriptionMetadataEvidence);
}
