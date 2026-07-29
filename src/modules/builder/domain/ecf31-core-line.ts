import type { Result } from "../../../shared/domain/result.js";
import {
  isLineCalculationEvidence,
  validateLineCalculationEvidenceCollection,
} from "./line-calculation-evidence.js";
import type {
  LineCalculationEvidence,
  LineCalculationEvidenceErrorCode,
} from "./line-calculation-evidence.js";

export type Ecf31CoreLine = Readonly<{
  evidence: LineCalculationEvidence;
  itemName: string;
  billingIndicator: 0 | 1 | 2 | 3 | 4;
  goodOrServiceIndicator: 1 | 2;
}>;

export type Ecf31CoreLineCollection = readonly Ecf31CoreLine[];

export type Ecf31CoreLineErrorCode =
  | "INVALID_CORE_LINE_INPUT"
  | "INVALID_CORE_LINE_EVIDENCE"
  | "INVALID_ITEM_NAME"
  | "INVALID_BILLING_INDICATOR"
  | "INVALID_GOOD_OR_SERVICE_INDICATOR"
  | "INVALID_CORE_LINE_COLLECTION"
  | LineCalculationEvidenceErrorCode;

export type Ecf31CoreLineError = Readonly<{
  code: Ecf31CoreLineErrorCode;
  message: string;
}>;

const MESSAGES: Readonly<Record<Ecf31CoreLineErrorCode, string>> = Object.freeze({
  INVALID_CORE_LINE_INPUT: "E-CF 31 core line input is invalid.",
  INVALID_CORE_LINE_EVIDENCE: "E-CF 31 core line evidence must be genuine.",
  INVALID_ITEM_NAME: "Item name must be nonblank and at most 80 code points.",
  INVALID_BILLING_INDICATOR: "Billing indicator must be a supported value.",
  INVALID_GOOD_OR_SERVICE_INDICATOR: "Good or service indicator must be a supported value.",
  INVALID_CORE_LINE_COLLECTION: "E-CF 31 core line collection is invalid.",
  INVALID_SEQUENCE_TYPE: "Line sequence input must be a string.",
  INVALID_SEQUENCE_LEXICAL_FORM: "Line sequence input must be an unsigned integer string.",
  INVALID_SEQUENCE_RANGE: "Line sequence must be a positive safe integer.",
  COLLECTION_STARTS_AFTER_ONE: "Line collection must start at sequence one.",
  COLLECTION_GAP: "Line collection must use contiguous sequences.",
  COLLECTION_DUPLICATE: "Line collection must not repeat a sequence.",
  COLLECTION_OUT_OF_ORDER: "Line collection must be ordered by sequence.",
  INVALID_LINE_EVIDENCE_INPUT: "Line evidence input is invalid.",
  INVALID_LINE_EVIDENCE_SEQUENCE: "Line evidence sequence is invalid.",
  INVALID_LINE_EVIDENCE_DECIMAL: "Line evidence decimal operand is invalid.",
  INVALID_LINE_EVIDENCE_COLLECTION: "Line evidence collection is invalid.",
  INVALID_TOLERANCE_POLICY: "Tolerance policy is invalid.",
  EMPTY_TOLERANCE_POLICY_ID: "Tolerance policy identifier must not be empty.",
  NEGATIVE_TOLERANCE_LIMIT: "Tolerance limit must be nonnegative.",
});

const coreLines = new WeakSet<Ecf31CoreLine>();
const BILLING_INDICATORS = [0, 1, 2, 3, 4] as const;
const GOOD_OR_SERVICE_INDICATORS = [1, 2] as const;

function failure(code: Ecf31CoreLineErrorCode): Result<never, Ecf31CoreLineError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null;
}

function isItemName(input: unknown): input is string {
  return typeof input === "string"
    && input.trim().length > 0
    && Array.from(input).length <= 80;
}

type CoreLineCandidates = Readonly<{
  evidence: unknown;
  itemName: unknown;
  billingIndicator: unknown;
  goodOrServiceIndicator: unknown;
}>;

function readCoreLineCandidates(input: Readonly<Record<string, unknown>>): CoreLineCandidates | undefined {
  try {
    return {
      evidence: input["evidence"],
      itemName: input["itemName"],
      billingIndicator: input["billingIndicator"],
      goodOrServiceIndicator: input["goodOrServiceIndicator"],
    };
  } catch {
    return undefined;
  }
}

function readCoreLines(input: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(input)) return undefined;
    const arrayInput: readonly unknown[] = input;
    return arrayInput.length === 0 ? undefined : [...arrayInput];
  } catch {
    return undefined;
  }
}

export function createEcf31CoreLine(input: unknown): Result<Ecf31CoreLine, Ecf31CoreLineError> {
  if (!isRecord(input)) return failure("INVALID_CORE_LINE_INPUT");

  const candidates = readCoreLineCandidates(input);
  if (candidates === undefined) return failure("INVALID_CORE_LINE_INPUT");

  const { evidence, itemName, billingIndicator, goodOrServiceIndicator } = candidates;
  if (!isLineCalculationEvidence(evidence)) return failure("INVALID_CORE_LINE_EVIDENCE");
  if (!isItemName(itemName)) return failure("INVALID_ITEM_NAME");
  if (!BILLING_INDICATORS.includes(billingIndicator as never)) return failure("INVALID_BILLING_INDICATOR");
  if (!GOOD_OR_SERVICE_INDICATORS.includes(goodOrServiceIndicator as never)) {
    return failure("INVALID_GOOD_OR_SERVICE_INDICATOR");
  }

  const line = Object.freeze({
    evidence,
    itemName,
    billingIndicator: billingIndicator as Ecf31CoreLine["billingIndicator"],
    goodOrServiceIndicator: goodOrServiceIndicator as Ecf31CoreLine["goodOrServiceIndicator"],
  });
  coreLines.add(line);
  return { ok: true, value: line };
}

export function isEcf31CoreLine(input: unknown): input is Ecf31CoreLine {
  return isRecord(input) && coreLines.has(input as Ecf31CoreLine);
}

export function createEcf31CoreLineCollection(
  input: unknown,
): Result<Ecf31CoreLineCollection, Ecf31CoreLineError> {
  const lines = readCoreLines(input);
  if (lines === undefined) return failure("INVALID_CORE_LINE_COLLECTION");
  if (!lines.every(isEcf31CoreLine)) return failure("INVALID_CORE_LINE_COLLECTION");

  const coreLinesInput = lines;
  const evidenceResult = validateLineCalculationEvidenceCollection(
    coreLinesInput.map((line) => line.evidence),
  );
  if (!evidenceResult.ok) return failure(evidenceResult.error.code);

  return { ok: true, value: Object.freeze([...coreLinesInput]) };
}
