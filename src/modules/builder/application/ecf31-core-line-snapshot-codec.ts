import type { Result } from "../../../shared/domain/result.js";
import {
  captureLineCalculationEvidence,
  formatLineSequence,
  parseLineSequence,
} from "../domain/line-calculation-evidence.js";
import {
  formatDecimal,
  parseNonnegativeAmount,
  parseNonnegativeQuantity,
  parseUnitPrice,
} from "../domain/exact-decimal.js";
import { createEcf31CoreLine, isEcf31CoreLine } from "../domain/ecf31-core-line.js";
import type { Ecf31CoreLine } from "../domain/ecf31-core-line.js";

export type Ecf31CoreLineSnapshot = Readonly<{
  schema: "ecf31-core-line";
  version: 1;
  sequence: string;
  quantity: string;
  unitPrice: string;
  computedAmount: string;
  declaredAmount: string;
  delta: string;
  itemName: string;
  billingIndicator: 0 | 1 | 2 | 3 | 4;
  goodOrServiceIndicator: 1 | 2;
}>;

export type Ecf31CoreLineSnapshotError = Readonly<{
  code: "INVALID_ECF31_CORE_LINE" | "INVALID_ECF31_CORE_LINE_SNAPSHOT";
  message: string;
}>;

const MESSAGES = Object.freeze({
  INVALID_ECF31_CORE_LINE: "E-CF 31 core line must be genuine.",
  INVALID_ECF31_CORE_LINE_SNAPSHOT: "E-CF 31 core line snapshot is invalid.",
} satisfies Record<Ecf31CoreLineSnapshotError["code"], string>);

const SNAPSHOT_KEYS = [
  "schema", "version", "sequence", "quantity", "unitPrice", "computedAmount", "declaredAmount", "delta",
  "itemName", "billingIndicator", "goodOrServiceIndicator",
];

function failure(
  code: Ecf31CoreLineSnapshotError["code"],
): Result<never, Ecf31CoreLineSnapshotError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function readExactRecord(input: unknown, allowedKeys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof input !== "object" || input === null) return undefined;

  try {
    if (Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== allowedKeys.length || keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) {
      return undefined;
    }

    const values: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      values[key] = descriptor.value;
    }
    return values;
  } catch {
    return undefined;
  }
}

function isBillingIndicator(input: unknown): input is 0 | 1 | 2 | 3 | 4 {
  return input === 0 || input === 1 || input === 2 || input === 3 || input === 4;
}

function isGoodOrServiceIndicator(input: unknown): input is 1 | 2 {
  return input === 1 || input === 2;
}

export function serializeEcf31CoreLine(
  input: unknown,
): Result<Ecf31CoreLineSnapshot, Ecf31CoreLineSnapshotError> {
  if (!isEcf31CoreLine(input)) return failure("INVALID_ECF31_CORE_LINE");

  const sequence = formatLineSequence(input.evidence.sequence);

  return {
    ok: true,
    value: Object.freeze({
      schema: "ecf31-core-line" as const,
      version: 1 as const,
      sequence: sequence.value,
      quantity: formatDecimal(input.evidence.quantity),
      unitPrice: formatDecimal(input.evidence.unitPrice),
      computedAmount: formatDecimal(input.evidence.computedAmount),
      declaredAmount: formatDecimal(input.evidence.declaredAmount),
      delta: formatDecimal(input.evidence.delta),
      itemName: input.itemName,
      billingIndicator: input.billingIndicator,
      goodOrServiceIndicator: input.goodOrServiceIndicator,
    }),
  };
}

export function restoreEcf31CoreLine(
  input: unknown,
): Result<Ecf31CoreLine, Ecf31CoreLineSnapshotError> {
  const snapshot = readExactRecord(input, SNAPSHOT_KEYS);
  if (
    snapshot === undefined
    || snapshot["schema"] !== "ecf31-core-line"
    || snapshot["version"] !== 1
    || typeof snapshot["sequence"] !== "string"
    || typeof snapshot["quantity"] !== "string"
    || typeof snapshot["unitPrice"] !== "string"
    || typeof snapshot["computedAmount"] !== "string"
    || typeof snapshot["declaredAmount"] !== "string"
    || typeof snapshot["delta"] !== "string"
    || typeof snapshot["itemName"] !== "string"
    || !isBillingIndicator(snapshot["billingIndicator"])
    || !isGoodOrServiceIndicator(snapshot["goodOrServiceIndicator"])
  ) {
    return failure("INVALID_ECF31_CORE_LINE_SNAPSHOT");
  }

  const sequence = parseLineSequence(snapshot["sequence"]);
  const quantity = parseNonnegativeQuantity(snapshot["quantity"]);
  const unitPrice = parseUnitPrice(snapshot["unitPrice"]);
  const declaredAmount = parseNonnegativeAmount(snapshot["declaredAmount"]);
  if (!sequence.ok || !quantity.ok || !unitPrice.ok || !declaredAmount.ok) {
    return failure("INVALID_ECF31_CORE_LINE_SNAPSHOT");
  }

  const evidence = captureLineCalculationEvidence({
    sequence: sequence.value,
    quantity: quantity.value,
    unitPrice: unitPrice.value,
    declaredAmount: declaredAmount.value,
  });

  const formattedSequence = formatLineSequence(sequence.value);
  if (
    formattedSequence.value !== snapshot["sequence"]
    || formatDecimal(quantity.value) !== snapshot["quantity"]
    || formatDecimal(unitPrice.value) !== snapshot["unitPrice"]
    || formatDecimal(declaredAmount.value) !== snapshot["declaredAmount"]
    || formatDecimal(evidence.value.computedAmount) !== snapshot["computedAmount"]
    || formatDecimal(evidence.value.delta) !== snapshot["delta"]
  ) {
    return failure("INVALID_ECF31_CORE_LINE_SNAPSHOT");
  }

  const line = createEcf31CoreLine({
    evidence: evidence.value,
    itemName: snapshot["itemName"],
    billingIndicator: snapshot["billingIndicator"],
    goodOrServiceIndicator: snapshot["goodOrServiceIndicator"],
  });
  if (!line.ok) return failure("INVALID_ECF31_CORE_LINE_SNAPSHOT");
  return { ok: true, value: line.value };
}
