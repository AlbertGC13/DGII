import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreHeader } from "./ecf31-core-header.js";
import type { Ecf31CoreHeader } from "./ecf31-core-header.js";
import { createEcf31CoreLineCollection } from "./ecf31-core-line.js";
import type { Ecf31CoreLineErrorCode } from "./ecf31-core-line.js";
import { isEcf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";

/** Incomplete, non-issuable composition of genuine e-CF 31 core evidence. */
export type Ecf31CoreDraft = Readonly<{
  header: Ecf31CoreHeader;
  lineAmounts: readonly Ecf31LineAmountEvidence[];
}>;

export type Ecf31CoreDraftErrorCode =
  | "INVALID_CORE_DRAFT_INPUT"
  | "INVALID_CORE_DRAFT_HEADER"
  | "INVALID_CORE_DRAFT_LINE_AMOUNTS"
  | Ecf31CoreLineErrorCode;

export type Ecf31CoreDraftError = Readonly<{ code: Ecf31CoreDraftErrorCode; message: string }>;

const MESSAGES: Readonly<Record<Ecf31CoreDraftErrorCode, string>> = Object.freeze({
  INVALID_CORE_DRAFT_INPUT: "E-CF 31 core draft input is invalid.",
  INVALID_CORE_DRAFT_HEADER: "E-CF 31 core draft requires a genuine core header.",
  INVALID_CORE_DRAFT_LINE_AMOUNTS: "E-CF 31 core draft requires genuine line amount evidence.",
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
const drafts = new WeakSet<Ecf31CoreDraft>();

function failure(code: Ecf31CoreDraftErrorCode): Result<never, Ecf31CoreDraftError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null;
}

function readCandidates(input: Readonly<Record<string, unknown>>): Readonly<{ header: unknown; lineAmounts: unknown }> | undefined {
  try {
    return { header: input["header"], lineAmounts: input["lineAmounts"] };
  } catch {
    return undefined;
  }
}

function copyLineAmounts(input: unknown): readonly unknown[] | undefined {
  try {
    return Array.isArray(input) && input.length > 0 ? Array.from(input) : undefined;
  } catch {
    return undefined;
  }
}

export function createEcf31CoreDraft(input: unknown): Result<Ecf31CoreDraft, Ecf31CoreDraftError> {
  if (!isRecord(input)) return failure("INVALID_CORE_DRAFT_INPUT");
  const candidates = readCandidates(input);
  if (candidates === undefined) return failure("INVALID_CORE_DRAFT_INPUT");
  if (!isEcf31CoreHeader(candidates.header)) return failure("INVALID_CORE_DRAFT_HEADER");
  const lineAmounts = copyLineAmounts(candidates.lineAmounts);
  if (lineAmounts === undefined || !lineAmounts.every(isEcf31LineAmountEvidence)) return failure("INVALID_CORE_DRAFT_LINE_AMOUNTS");
  const lines = createEcf31CoreLineCollection(lineAmounts.map((lineAmount) => lineAmount.coreLine));
  if (!lines.ok) return failure(lines.error.code);
  const draft = Object.freeze({ header: candidates.header, lineAmounts: Object.freeze([...lineAmounts]) });
  drafts.add(draft);
  return { ok: true, value: draft };
}

export function isEcf31CoreDraft(input: unknown): input is Ecf31CoreDraft {
  return typeof input === "object" && input !== null && drafts.has(input as Ecf31CoreDraft);
}
