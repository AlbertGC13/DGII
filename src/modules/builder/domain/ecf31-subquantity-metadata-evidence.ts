import { types } from "node:util";

import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";
import { isExactDecimal, revalidateNonnegativeSubquantity } from "./exact-decimal.js";
import type { NonnegativeSubquantity } from "./exact-decimal.js";
import { parseEcf31UnitOfMeasureCode } from "./ecf31-item-unit-metadata-evidence.js";
import type { Ecf31UnitOfMeasureCode } from "./ecf31-item-unit-metadata-evidence.js";

type Pair = Readonly<{ subquantity: NonnegativeSubquantity; unit: Ecf31UnitOfMeasureCode }>;
type Entry = Readonly<{ source: Ecf31LineAmountEvidence; subquantities: readonly Pair[] }>;
export type Ecf31SubquantityMetadataEvidence = Readonly<{ draft: Ecf31CoreDraft; entries: readonly Entry[] }>;
export type Ecf31SubquantityMetadataEvidenceError = Readonly<{
  code: "INVALID_ECF31_SUBQUANTITY_METADATA_INPUT";
  message: "E-CF 31 subquantity metadata input is invalid.";
}>;

const INPUT_ERROR: Ecf31SubquantityMetadataEvidenceError = Object.freeze({
  code: "INVALID_ECF31_SUBQUANTITY_METADATA_INPUT", message: "E-CF 31 subquantity metadata input is invalid.",
});
const evidenceValues = new WeakSet<Ecf31SubquantityMetadataEvidence>();

function failure(): Result<never, Ecf31SubquantityMetadataEvidenceError> { return { ok: false, error: INPUT_ERROR }; }

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

function pair(input: unknown): Pair | undefined {
  const candidate = record(input, ["subquantity", "unit"]);
  if (candidate === undefined || !isExactDecimal(candidate["subquantity"])) return undefined;
  const subquantity = revalidateNonnegativeSubquantity(candidate["subquantity"]);
  const unit = parseEcf31UnitOfMeasureCode(candidate["unit"]);
  return subquantity.ok && unit.ok ? Object.freeze({ subquantity: subquantity.value, unit: unit.value }) : undefined;
}

function entry(input: unknown, source: Ecf31LineAmountEvidence): Entry | undefined {
  const candidate = record(input, ["source", "subquantities"]);
  if (candidate === undefined || candidate["source"] !== source) return undefined;
  const pairs = array(candidate["subquantities"]);
  if (pairs === undefined || pairs.length > 5) return undefined;
  const copied: Pair[] = [];
  for (const inputPair of pairs) {
    const parsed = pair(inputPair);
    if (parsed === undefined) return undefined;
    copied.push(parsed);
  }
  return Object.freeze({ source, subquantities: Object.freeze(copied) });
}

export function createEcf31SubquantityMetadataEvidence(
  input: unknown,
): Result<Ecf31SubquantityMetadataEvidence, Ecf31SubquantityMetadataEvidenceError> {
  const candidate = record(input, ["draft", "entries"]);
  if (candidate === undefined || !isEcf31CoreDraft(candidate["draft"])) return failure();
  const entries = array(candidate["entries"]);
  if (entries === undefined || entries.length !== candidate["draft"].lineAmounts.length) return failure();
  const output: Entry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const parsed = entry(entries[index], candidate["draft"].lineAmounts[index] as Ecf31LineAmountEvidence);
    if (parsed === undefined) return failure();
    output.push(parsed);
  }
  const evidence = Object.freeze({ draft: candidate["draft"], entries: Object.freeze(output) });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31SubquantityMetadataEvidence(input: unknown): input is Ecf31SubquantityMetadataEvidence {
  try {
    return typeof input === "object" && input !== null && !types.isProxy(input)
      && evidenceValues.has(input as Ecf31SubquantityMetadataEvidence);
  } catch { return false; }
}
