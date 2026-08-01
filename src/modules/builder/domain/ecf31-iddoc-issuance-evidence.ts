import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreHeader } from "./ecf31-core-header.js";
import type { Ecf31CoreHeader } from "./ecf31-core-header.js";

export const ECF31_IDDOC_ISSUANCE_EVIDENCE_POLICY_ID = "ecf31-iddoc-issuance-evidence-v1";

export type Ecf31IdDocIssuanceEvidence = Readonly<{
  header: Ecf31CoreHeader;
  sequenceExpirationDate: string;
  paymentDueDate?: string;
  policyId: typeof ECF31_IDDOC_ISSUANCE_EVIDENCE_POLICY_ID;
}>;

export type Ecf31IdDocIssuanceEvidenceErrorCode =
  | "INVALID_ECF31_IDDOC_INPUT"
  | "INVALID_ECF31_IDDOC_HEADER"
  | "INVALID_ECF31_IDDOC_DATE"
  | "INVALID_ECF31_IDDOC_PAYMENT_DEADLINE";

export type Ecf31IdDocIssuanceEvidenceError = Readonly<{
  code: Ecf31IdDocIssuanceEvidenceErrorCode;
  message: string;
}>;

type CalendarDate = Readonly<{ day: number; month: number; year: number }>;
type Input = Readonly<{ header: unknown; sequenceExpirationDate: unknown; paymentDueDate: unknown; hasPaymentDueDate: boolean }>;

const MESSAGES: Readonly<Record<Ecf31IdDocIssuanceEvidenceErrorCode, string>> = Object.freeze({
  INVALID_ECF31_IDDOC_INPUT: "IdDoc issuance evidence input is invalid.",
  INVALID_ECF31_IDDOC_HEADER: "IdDoc issuance evidence requires a genuine E-CF 31 core header.",
  INVALID_ECF31_IDDOC_DATE: "IdDoc issuance evidence dates must use valid dd-MM-AAAA calendar dates.",
  INVALID_ECF31_IDDOC_PAYMENT_DEADLINE: "IdDoc payment deadline is required only for credit payment and cannot precede the issue date.",
});
const evidenceValues = new WeakSet<Ecf31IdDocIssuanceEvidence>();
const DATE_PATTERN = /^(?:0[1-9]|[12][0-9]|3[01])-(?:0[1-9]|1[0-2])-[0-9]{4}$/;
const MONTH_LENGTHS: Readonly<Record<number, number>> = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function failure(code: Ecf31IdDocIssuanceEvidenceErrorCode): Result<never, Ecf31IdDocIssuanceEvidenceError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function readInput(input: unknown): Input | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)
      || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) return undefined;
    const keys = Reflect.ownKeys(input);
    if ((keys.length !== 2 && keys.length !== 3) || !keys.includes("header") || !keys.includes("sequenceExpirationDate")
      || keys.some((key) => key !== "header" && key !== "sequenceExpirationDate" && key !== "paymentDueDate")) return undefined;
    const header = Object.getOwnPropertyDescriptor(input, "header");
    const sequenceExpirationDate = Object.getOwnPropertyDescriptor(input, "sequenceExpirationDate");
    const paymentDueDate = Object.getOwnPropertyDescriptor(input, "paymentDueDate");
    if (header === undefined || sequenceExpirationDate === undefined || !("value" in header) || !("value" in sequenceExpirationDate)
      || !header.enumerable || !sequenceExpirationDate.enumerable || (paymentDueDate !== undefined && (!("value" in paymentDueDate) || !paymentDueDate.enumerable))) return undefined;
    return Object.freeze({ header: header.value as unknown, sequenceExpirationDate: sequenceExpirationDate.value as unknown,
      paymentDueDate: paymentDueDate?.value as unknown, hasPaymentDueDate: paymentDueDate !== undefined });
  } catch { return undefined; }
}

function parseCalendarDate(input: unknown): CalendarDate | undefined {
  if (typeof input !== "string" || !DATE_PATTERN.test(input)) return undefined;
  const day = Number(input.slice(0, 2));
  const month = Number(input.slice(3, 5));
  const year = Number(input.slice(6, 10));
  const daysInMonth = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : MONTH_LENGTHS[month - 1] as number;
  return year > 0 && day <= daysInMonth ? Object.freeze({ day, month, year }) : undefined;
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
  return (left.year * 10_000 + left.month * 100 + left.day) - (right.year * 10_000 + right.month * 100 + right.day);
}

export function createEcf31IdDocIssuanceEvidence(
  input: unknown,
): Result<Ecf31IdDocIssuanceEvidence, Ecf31IdDocIssuanceEvidenceError> {
  const candidate = readInput(input);
  if (candidate === undefined) return failure("INVALID_ECF31_IDDOC_INPUT");
  if (!isEcf31CoreHeader(candidate.header)) return failure("INVALID_ECF31_IDDOC_HEADER");
  const sequenceExpirationDate = parseCalendarDate(candidate.sequenceExpirationDate);
  const issueDate = parseCalendarDate(candidate.header.issueDate);
  if (sequenceExpirationDate === undefined || issueDate === undefined) return failure("INVALID_ECF31_IDDOC_DATE");
  const paymentDueDate = parseCalendarDate(candidate.paymentDueDate);
  if (candidate.header.paymentType === "2") {
    if (!candidate.hasPaymentDueDate || paymentDueDate === undefined || compareCalendarDates(paymentDueDate, issueDate) < 0) {
      return failure("INVALID_ECF31_IDDOC_PAYMENT_DEADLINE");
    }
    const evidence = Object.freeze({ header: candidate.header, sequenceExpirationDate: candidate.sequenceExpirationDate as string,
      paymentDueDate: candidate.paymentDueDate as string, policyId: ECF31_IDDOC_ISSUANCE_EVIDENCE_POLICY_ID });
    evidenceValues.add(evidence);
    return { ok: true, value: evidence };
  }
  if (candidate.hasPaymentDueDate) return failure("INVALID_ECF31_IDDOC_PAYMENT_DEADLINE");
  const evidence = Object.freeze({ header: candidate.header, sequenceExpirationDate: candidate.sequenceExpirationDate as string,
    policyId: ECF31_IDDOC_ISSUANCE_EVIDENCE_POLICY_ID });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31IdDocIssuanceEvidence(input: unknown): input is Ecf31IdDocIssuanceEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31IdDocIssuanceEvidence);
}
