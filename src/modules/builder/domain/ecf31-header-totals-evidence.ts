import type { Result } from "../../../shared/domain/result.js";
import type { DecimalErrorCode } from "./decimal-error.js";
import {
  addDecimals,
  isExactDecimal,
  parseNonnegativeAmount,
  revalidateNonnegativeAmount,
  revalidatePositiveAmount,
} from "./exact-decimal.js";
import type { ExactDecimal, NonnegativeAmount, PositiveAmount } from "./exact-decimal.js";

export type Ecf31HeaderTotalsInput = Readonly<{
  montoGravadoI1?: NonnegativeAmount;
  montoGravadoI2?: NonnegativeAmount;
  montoGravadoI3?: NonnegativeAmount;
  montoExento?: NonnegativeAmount;
  totalItbis1?: NonnegativeAmount;
  totalItbis2?: NonnegativeAmount;
  totalItbis3?: NonnegativeAmount;
  montoImpuestoAdicional?: PositiveAmount;
}>;

export type Ecf31HeaderTotalsEvidence = Readonly<{
  montoGravadoI1?: NonnegativeAmount;
  montoGravadoI2?: NonnegativeAmount;
  montoGravadoI3?: NonnegativeAmount;
  montoGravadoTotal: NonnegativeAmount;
  montoExento?: NonnegativeAmount;
  totalItbis1?: NonnegativeAmount;
  totalItbis2?: NonnegativeAmount;
  totalItbis3?: NonnegativeAmount;
  totalItbis: NonnegativeAmount;
  montoImpuestoAdicional?: PositiveAmount;
  montoTotal: NonnegativeAmount;
}>;

export type Ecf31HeaderTotalsEvidenceErrorCode =
  | "INVALID_HEADER_TOTALS_INPUT"
  | DecimalErrorCode;

export type Ecf31HeaderTotalsEvidenceError = Readonly<{
  code: Ecf31HeaderTotalsEvidenceErrorCode;
  message: string;
}>;

const MESSAGES: Readonly<Record<Ecf31HeaderTotalsEvidenceErrorCode, string>> = Object.freeze({
  INVALID_HEADER_TOTALS_INPUT: "E-CF 31 header totals input is invalid.",
  INVALID_DECIMAL: "Value must be a genuine exact decimal.",
  INVALID_TYPE: "Decimal input must be a string.",
  INVALID_LEXICAL_FORM: "Decimal input does not use the required canonical-input syntax.",
  SCALE_EXCEEDED: "Decimal input exceeds the target scale.",
  PRECISION_EXCEEDED: "Decimal input exceeds the target precision.",
  OUT_OF_RANGE: "Decimal value is outside the target range.",
});
const evidenceValues = new WeakSet<Ecf31HeaderTotalsEvidence>();
const ZERO = parseNonnegativeAmount("0") as Readonly<{ ok: true; value: NonnegativeAmount }>;

function failure(code: Ecf31HeaderTotalsEvidenceErrorCode): Result<never, Ecf31HeaderTotalsEvidenceError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null;
}

type Candidates = Readonly<Record<keyof Ecf31HeaderTotalsInput, unknown>>;

function readCandidates(input: Readonly<Record<string, unknown>>): Candidates | undefined {
  try {
    return {
      montoGravadoI1: input["montoGravadoI1"],
      montoGravadoI2: input["montoGravadoI2"],
      montoGravadoI3: input["montoGravadoI3"],
      montoExento: input["montoExento"],
      totalItbis1: input["totalItbis1"],
      totalItbis2: input["totalItbis2"],
      totalItbis3: input["totalItbis3"],
      montoImpuestoAdicional: input["montoImpuestoAdicional"],
    };
  } catch {
    return undefined;
  }
}

function revalidateOptionalAmount(input: unknown): Result<NonnegativeAmount | undefined, Ecf31HeaderTotalsEvidenceError> {
  if (input === undefined) return { ok: true, value: undefined };
  if (!isExactDecimal(input)) return failure("INVALID_DECIMAL");
  const amount = revalidateNonnegativeAmount(input);
  return amount.ok ? amount : failure(amount.error.code);
}

function revalidateOptionalPositiveAmount(input: unknown): Result<PositiveAmount | undefined, Ecf31HeaderTotalsEvidenceError> {
  if (input === undefined) return { ok: true, value: undefined };
  if (!isExactDecimal(input)) return failure("INVALID_DECIMAL");
  const amount = revalidatePositiveAmount(input);
  return amount.ok ? amount : failure(amount.error.code);
}

function sum(amounts: readonly (ExactDecimal | undefined)[]): ExactDecimal {
  return amounts.reduce<ExactDecimal>(
    (total, amount) => amount === undefined ? total : addDecimals(total, amount),
    ZERO.value,
  );
}

export function createEcf31HeaderTotalsEvidence(
  input: unknown,
): Result<Ecf31HeaderTotalsEvidence, Ecf31HeaderTotalsEvidenceError> {
  if (!isRecord(input)) return failure("INVALID_HEADER_TOTALS_INPUT");
  const candidates = readCandidates(input);
  if (candidates === undefined) return failure("INVALID_HEADER_TOTALS_INPUT");

  const montoGravadoI1 = revalidateOptionalAmount(candidates.montoGravadoI1);
  const montoGravadoI2 = revalidateOptionalAmount(candidates.montoGravadoI2);
  const montoGravadoI3 = revalidateOptionalAmount(candidates.montoGravadoI3);
  const montoExento = revalidateOptionalAmount(candidates.montoExento);
  const totalItbis1 = revalidateOptionalAmount(candidates.totalItbis1);
  const totalItbis2 = revalidateOptionalAmount(candidates.totalItbis2);
  const totalItbis3 = revalidateOptionalAmount(candidates.totalItbis3);
  const montoImpuestoAdicional = revalidateOptionalPositiveAmount(candidates.montoImpuestoAdicional);
  if (!montoGravadoI1.ok) return montoGravadoI1;
  if (!montoGravadoI2.ok) return montoGravadoI2;
  if (!montoGravadoI3.ok) return montoGravadoI3;
  if (!montoExento.ok) return montoExento;
  if (!totalItbis1.ok) return totalItbis1;
  if (!totalItbis2.ok) return totalItbis2;
  if (!totalItbis3.ok) return totalItbis3;
  if (!montoImpuestoAdicional.ok) return montoImpuestoAdicional;

  const montoGravadoTotal = revalidateNonnegativeAmount(sum([
    montoGravadoI1.value,
    montoGravadoI2.value,
    montoGravadoI3.value,
  ]));
  if (!montoGravadoTotal.ok) return failure(montoGravadoTotal.error.code);
  const totalItbis = revalidateNonnegativeAmount(sum([
    totalItbis1.value,
    totalItbis2.value,
    totalItbis3.value,
  ]));
  if (!totalItbis.ok) return failure(totalItbis.error.code);
  const montoTotal = revalidateNonnegativeAmount(sum([
    montoGravadoTotal.value,
    montoExento.value,
    totalItbis.value,
    montoImpuestoAdicional.value,
  ]));
  if (!montoTotal.ok) return failure(montoTotal.error.code);

  const evidence = Object.freeze({
    ...(montoGravadoI1.value === undefined ? {} : { montoGravadoI1: montoGravadoI1.value }),
    ...(montoGravadoI2.value === undefined ? {} : { montoGravadoI2: montoGravadoI2.value }),
    ...(montoGravadoI3.value === undefined ? {} : { montoGravadoI3: montoGravadoI3.value }),
    montoGravadoTotal: montoGravadoTotal.value,
    ...(montoExento.value === undefined ? {} : { montoExento: montoExento.value }),
    ...(totalItbis1.value === undefined ? {} : { totalItbis1: totalItbis1.value }),
    ...(totalItbis2.value === undefined ? {} : { totalItbis2: totalItbis2.value }),
    ...(totalItbis3.value === undefined ? {} : { totalItbis3: totalItbis3.value }),
    totalItbis: totalItbis.value,
    ...(montoImpuestoAdicional.value === undefined ? {} : { montoImpuestoAdicional: montoImpuestoAdicional.value }),
    montoTotal: montoTotal.value,
  });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31HeaderTotalsEvidence(input: unknown): input is Ecf31HeaderTotalsEvidence {
  return isRecord(input) && evidenceValues.has(input as Ecf31HeaderTotalsEvidence);
}
