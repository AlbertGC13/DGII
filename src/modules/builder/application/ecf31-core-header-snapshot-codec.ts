import { parseENcf, parseTaxpayerIdentifier } from "../../fiscal-identity/index.js";
import type { Result } from "../../../shared/domain/result.js";
import { createEcf31CoreHeader, isEcf31CoreHeader } from "../domain/ecf31-core-header.js";
import type { Ecf31CoreHeader } from "../domain/ecf31-core-header.js";

export type Ecf31CoreHeaderSnapshot = Readonly<{
  schema: "ecf31-core-header";
  version: 1;
  eNcf: string;
  issuer: Readonly<{
    taxpayerIdentifier: string;
    legalName: string;
    address: string;
  }>;
  buyer: Readonly<{
    taxpayerIdentifier: string;
    legalName: string;
  }>;
  issueDate: string;
  incomeType: string;
  paymentType: string;
}>;

export type Ecf31CoreHeaderSnapshotError = Readonly<{
  code: "INVALID_ECF31_CORE_HEADER" | "INVALID_ECF31_CORE_HEADER_SNAPSHOT";
  message: string;
}>;

const MESSAGES = Object.freeze({
  INVALID_ECF31_CORE_HEADER: "E-CF 31 core header must be genuine.",
  INVALID_ECF31_CORE_HEADER_SNAPSHOT: "E-CF 31 core header snapshot is invalid.",
} satisfies Record<Ecf31CoreHeaderSnapshotError["code"], string>);

const SNAPSHOT_KEYS = [
  "schema", "version", "eNcf", "issuer", "buyer", "issueDate", "incomeType", "paymentType",
];
const ISSUER_KEYS = ["taxpayerIdentifier", "legalName", "address"];
const BUYER_KEYS = ["taxpayerIdentifier", "legalName"];

function failure(
  code: Ecf31CoreHeaderSnapshotError["code"],
): Result<never, Ecf31CoreHeaderSnapshotError> {
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

export function serializeEcf31CoreHeader(
  input: unknown,
): Result<Ecf31CoreHeaderSnapshot, Ecf31CoreHeaderSnapshotError> {
  if (!isEcf31CoreHeader(input)) return failure("INVALID_ECF31_CORE_HEADER");

  const snapshot = Object.freeze({
    schema: "ecf31-core-header" as const,
    version: 1 as const,
    eNcf: input.eNcf.value,
    issuer: Object.freeze({
      taxpayerIdentifier: input.issuer.taxpayerIdentifier.value,
      legalName: input.issuer.legalName,
      address: input.issuer.address,
    }),
    buyer: Object.freeze({
      taxpayerIdentifier: input.buyer.taxpayerIdentifier.value,
      legalName: input.buyer.legalName,
    }),
    issueDate: input.issueDate,
    incomeType: input.incomeType,
    paymentType: input.paymentType,
  });
  return { ok: true, value: snapshot };
}

export function restoreEcf31CoreHeader(
  input: unknown,
): Result<Ecf31CoreHeader, Ecf31CoreHeaderSnapshotError> {
  const snapshot = readExactRecord(input, SNAPSHOT_KEYS);
  if (
    snapshot === undefined
    || snapshot["schema"] !== "ecf31-core-header"
    || snapshot["version"] !== 1
    || typeof snapshot["eNcf"] !== "string"
    || typeof snapshot["issueDate"] !== "string"
    || typeof snapshot["incomeType"] !== "string"
    || typeof snapshot["paymentType"] !== "string"
  ) {
    return failure("INVALID_ECF31_CORE_HEADER_SNAPSHOT");
  }

  const issuer = readExactRecord(snapshot["issuer"], ISSUER_KEYS);
  const buyer = readExactRecord(snapshot["buyer"], BUYER_KEYS);
  if (
    issuer === undefined
    || buyer === undefined
    || typeof issuer["taxpayerIdentifier"] !== "string"
    || typeof issuer["legalName"] !== "string"
    || typeof issuer["address"] !== "string"
    || typeof buyer["taxpayerIdentifier"] !== "string"
    || typeof buyer["legalName"] !== "string"
  ) {
    return failure("INVALID_ECF31_CORE_HEADER_SNAPSHOT");
  }

  const eNcf = parseENcf(snapshot["eNcf"]);
  const issuerIdentifier = parseTaxpayerIdentifier(issuer["taxpayerIdentifier"]);
  const buyerIdentifier = parseTaxpayerIdentifier(buyer["taxpayerIdentifier"]);
  if (!eNcf.ok || !issuerIdentifier.ok || !buyerIdentifier.ok) {
    return failure("INVALID_ECF31_CORE_HEADER_SNAPSHOT");
  }

  const header = createEcf31CoreHeader({
    eNcf: eNcf.value,
    issuer: {
      taxpayerIdentifier: issuerIdentifier.value,
      legalName: issuer["legalName"],
      address: issuer["address"],
    },
    buyer: {
      taxpayerIdentifier: buyerIdentifier.value,
      legalName: buyer["legalName"],
    },
    issueDate: snapshot["issueDate"],
    incomeType: snapshot["incomeType"],
    paymentType: snapshot["paymentType"],
  });
  if (!header.ok) return failure("INVALID_ECF31_CORE_HEADER_SNAPSHOT");
  return { ok: true, value: header.value };
}
