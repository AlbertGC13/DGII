import type { Result } from "../../../shared/domain/result.js";
import {
  formatDecimal,
  parseNonnegativeAmount,
  parsePositiveAmount,
} from "../domain/exact-decimal.js";
import {
  createEcf31HeaderTotalsEvidence,
  isEcf31HeaderTotalsEvidence,
} from "../domain/ecf31-header-totals-evidence.js";
import type { Ecf31HeaderTotalsEvidence } from "../domain/ecf31-header-totals-evidence.js";
import type { NonnegativeAmount, PositiveAmount } from "../domain/exact-decimal.js";

export type Ecf31HeaderTotalsSnapshot = Readonly<{
  schema: "ecf31-header-totals";
  version: 1;
  montoGravadoI1?: string;
  montoGravadoI2?: string;
  montoGravadoI3?: string;
  montoGravadoTotal: string;
  montoExento?: string;
  totalItbis1?: string;
  totalItbis2?: string;
  totalItbis3?: string;
  totalItbis: string;
  montoImpuestoAdicional?: string;
  montoTotal: string;
}>;

export type Ecf31HeaderTotalsSnapshotError = Readonly<{
  code: "INVALID_ECF31_HEADER_TOTALS" | "INVALID_ECF31_HEADER_TOTALS_SNAPSHOT";
  message: string;
}>;

const MESSAGES = Object.freeze({
  INVALID_ECF31_HEADER_TOTALS: "E-CF 31 header totals evidence must be genuine.",
  INVALID_ECF31_HEADER_TOTALS_SNAPSHOT: "E-CF 31 header totals snapshot is invalid.",
} satisfies Record<Ecf31HeaderTotalsSnapshotError["code"], string>);
const REQUIRED_KEYS = ["schema", "version", "montoGravadoTotal", "totalItbis", "montoTotal"];
const OPTIONAL_KEYS = [
  "montoGravadoI1", "montoGravadoI2", "montoGravadoI3", "montoExento", "totalItbis1", "totalItbis2",
  "totalItbis3", "montoImpuestoAdicional",
];

function failure(code: Ecf31HeaderTotalsSnapshotError["code"]): Result<never, Ecf31HeaderTotalsSnapshotError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function readExactSnapshot(input: unknown): Record<string, unknown> | undefined {
  if (typeof input !== "object" || input === null) return undefined;

  try {
    if (Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    const allowedKeys = [...REQUIRED_KEYS, ...OPTIONAL_KEYS];
    const stringKeys = keys.filter((key): key is string => typeof key === "string");
    if (stringKeys.length !== keys.length || stringKeys.some((key) => !allowedKeys.includes(key))
      || REQUIRED_KEYS.some((key) => !stringKeys.includes(key))) return undefined;

    const values: Record<string, unknown> = {};
    for (const key of stringKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      values[key] = descriptor.value;
    }
    return values;
  } catch {
    return undefined;
  }
}

function parseOptionalAmount(input: unknown): Readonly<{ value: NonnegativeAmount | undefined }> | undefined {
  if (input === undefined) return { value: undefined };
  const amount = parseNonnegativeAmount(input);
  return amount.ok && formatDecimal(amount.value) === input ? { value: amount.value } : undefined;
}

function parseOptionalPositiveAmount(input: unknown): Readonly<{ value: PositiveAmount | undefined }> | undefined {
  if (input === undefined) return { value: undefined };
  const amount = parsePositiveAmount(input);
  return amount.ok && formatDecimal(amount.value) === input ? { value: amount.value } : undefined;
}

function parseCanonicalAmount(input: unknown): NonnegativeAmount | undefined {
  const amount = parseNonnegativeAmount(input);
  return amount.ok && formatDecimal(amount.value) === input ? amount.value : undefined;
}

export function serializeEcf31HeaderTotals(
  input: unknown,
): Result<Ecf31HeaderTotalsSnapshot, Ecf31HeaderTotalsSnapshotError> {
  if (!isEcf31HeaderTotalsEvidence(input)) return failure("INVALID_ECF31_HEADER_TOTALS");

  return {
    ok: true,
    value: Object.freeze({
      schema: "ecf31-header-totals" as const,
      version: 1 as const,
      ...(input.montoGravadoI1 === undefined ? {} : { montoGravadoI1: formatDecimal(input.montoGravadoI1) }),
      ...(input.montoGravadoI2 === undefined ? {} : { montoGravadoI2: formatDecimal(input.montoGravadoI2) }),
      ...(input.montoGravadoI3 === undefined ? {} : { montoGravadoI3: formatDecimal(input.montoGravadoI3) }),
      montoGravadoTotal: formatDecimal(input.montoGravadoTotal),
      ...(input.montoExento === undefined ? {} : { montoExento: formatDecimal(input.montoExento) }),
      ...(input.totalItbis1 === undefined ? {} : { totalItbis1: formatDecimal(input.totalItbis1) }),
      ...(input.totalItbis2 === undefined ? {} : { totalItbis2: formatDecimal(input.totalItbis2) }),
      ...(input.totalItbis3 === undefined ? {} : { totalItbis3: formatDecimal(input.totalItbis3) }),
      totalItbis: formatDecimal(input.totalItbis),
      ...(input.montoImpuestoAdicional === undefined
        ? {} : { montoImpuestoAdicional: formatDecimal(input.montoImpuestoAdicional) }),
      montoTotal: formatDecimal(input.montoTotal),
    }),
  };
}

export function restoreEcf31HeaderTotals(
  input: unknown,
): Result<Ecf31HeaderTotalsEvidence, Ecf31HeaderTotalsSnapshotError> {
  const snapshot = readExactSnapshot(input);
  if (snapshot === undefined || snapshot["schema"] !== "ecf31-header-totals" || snapshot["version"] !== 1) {
    return failure("INVALID_ECF31_HEADER_TOTALS_SNAPSHOT");
  }

  const montoGravadoI1 = parseOptionalAmount(snapshot["montoGravadoI1"]);
  const montoGravadoI2 = parseOptionalAmount(snapshot["montoGravadoI2"]);
  const montoGravadoI3 = parseOptionalAmount(snapshot["montoGravadoI3"]);
  const montoExento = parseOptionalAmount(snapshot["montoExento"]);
  const totalItbis1 = parseOptionalAmount(snapshot["totalItbis1"]);
  const totalItbis2 = parseOptionalAmount(snapshot["totalItbis2"]);
  const totalItbis3 = parseOptionalAmount(snapshot["totalItbis3"]);
  const adicional = parseOptionalPositiveAmount(snapshot["montoImpuestoAdicional"]);
  const montoGravadoTotal = parseCanonicalAmount(snapshot["montoGravadoTotal"]);
  const totalItbis = parseCanonicalAmount(snapshot["totalItbis"]);
  const montoTotal = parseCanonicalAmount(snapshot["montoTotal"]);
  if (!montoGravadoI1 || !montoGravadoI2 || !montoGravadoI3 || !montoExento || !totalItbis1 || !totalItbis2 || !totalItbis3
    || !adicional || montoGravadoTotal === undefined || totalItbis === undefined || montoTotal === undefined) {
    return failure("INVALID_ECF31_HEADER_TOTALS_SNAPSHOT");
  }

  const evidence = createEcf31HeaderTotalsEvidence({
    montoGravadoI1: montoGravadoI1.value,
    montoGravadoI2: montoGravadoI2.value,
    montoGravadoI3: montoGravadoI3.value,
    montoExento: montoExento.value,
    totalItbis1: totalItbis1.value,
    totalItbis2: totalItbis2.value,
    totalItbis3: totalItbis3.value,
    montoImpuestoAdicional: adicional.value,
  });
  if (!evidence.ok || formatDecimal(evidence.value.montoGravadoTotal) !== snapshot["montoGravadoTotal"]
    || formatDecimal(evidence.value.totalItbis) !== snapshot["totalItbis"]
    || formatDecimal(evidence.value.montoTotal) !== snapshot["montoTotal"]) {
    return failure("INVALID_ECF31_HEADER_TOTALS_SNAPSHOT");
  }
  return { ok: true, value: evidence.value };
}
