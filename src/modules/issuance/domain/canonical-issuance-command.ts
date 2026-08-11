import { createHash } from "node:crypto";

import {
  formatDecimal,
  formatLineSequence,
  parseLineSequence,
  parseNonnegativeAmount,
  parseNonnegativeQuantity,
  parseUnitPrice,
} from "../../builder/index.js";
import { parseENcf, parseTaxpayerIdentifier } from "../../fiscal-identity/index.js";
import type { Result } from "../../../shared/domain/result.js";

export type CanonicalIssuanceCommand = Readonly<{
  issuer: Readonly<{ tenantId: string; rnc: string }>;
  ecfType: string;
  requestedOn: string;
  buyerIdentity: Readonly<{ rnc: string | null; cedula: string | null; foreignIdentifier: string | null }>;
  declaredTotals: Readonly<{
    montoTotal: string;
    totalItbis: string;
    montoGravadoTotal: string;
    montoExento: string;
  }>;
  items: readonly Readonly<{
    numeroLinea: string;
    nombreItem: string;
    indicadorFacturacion: "0" | "1" | "2" | "3" | "4";
    indicadorBienoServicio: "1" | "2";
    cantidadItem: string;
    precioUnitarioItem: string;
    montoItem: string;
    montoDescuento: string | null;
    montoRecargo: string | null;
  }>[];
}>;

export type CanonicalIssuanceCommandError = Readonly<{
  code: "INVALID_CANONICAL_ISSUANCE_COMMAND";
  message: "Canonical issuance command input is invalid.";
}>;

const ERROR = Object.freeze({
  code: "INVALID_CANONICAL_ISSUANCE_COMMAND",
  message: "Canonical issuance command input is invalid.",
} satisfies CanonicalIssuanceCommandError);
const canonicalCommands = new WeakSet<CanonicalIssuanceCommand>();

function failure(): Result<never, CanonicalIssuanceCommandError> {
  return { ok: false, error: ERROR };
}

function record(input: unknown, required: readonly string[], optional: readonly string[] = []): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    if (!required.every((key) => keys.includes(key)) || !keys.every((key) => typeof key === "string" && [...required, ...optional].includes(key))) return undefined;
    const values: Record<string, unknown> = {};
    for (const key of [...required, ...optional]) {
      if (!keys.includes(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      values[key] = descriptor.value;
    }
    return Object.freeze(values);
  } catch { return undefined; }
}

function array(input: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || !Number.isSafeInteger(input.length)
      || Reflect.ownKeys(input).length !== input.length + 1) return undefined;
    const values: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      values.push(descriptor.value);
    }
    return Object.freeze(values);
  } catch { return undefined; }
}

function requiredString(input: unknown): string | undefined {
  return typeof input === "string" && !/^\s*$/u.test(input) ? input : undefined;
}

function indicator<T extends string>(input: unknown, values: readonly T[]): T | undefined {
  const value = requiredString(input);
  return value === undefined ? undefined : values.find((candidate) => candidate === value);
}

function normalizedOptional(input: unknown): string | null | undefined {
  if (input === undefined || input === null || (typeof input === "string" && input.trim() === "")) return null;
  return requiredString(input);
}

function normalizedBuyerIdentifier(input: unknown): string | null | undefined {
  const value = normalizedOptional(input);
  return value === null || value === undefined ? value : (value.replace(/[ -]/g, "") || null);
}

function decimal(input: unknown, parser: (value: unknown) => { ok: boolean; value?: unknown }): string | undefined {
  const parsed = parser(input);
  return parsed.ok && parsed.value !== undefined ? formatDecimal(parsed.value as never) : undefined;
}

function taxpayer(input: unknown, kind: "rnc" | "cedula"): string | undefined {
  const value = requiredString(input)?.replace(/[ -]/g, "");
  const parsed = parseTaxpayerIdentifier(value);
  return parsed.ok && parsed.value.kind === kind ? parsed.value.value : undefined;
}

function buyerIdentity(input: unknown): CanonicalIssuanceCommand["buyerIdentity"] | undefined {
  const candidate = record(input, [], ["rnc", "cedula", "foreignIdentifier"]);
  if (candidate === undefined) return undefined;
  const rnc = normalizedBuyerIdentifier(candidate["rnc"]);
  const cedula = normalizedBuyerIdentifier(candidate["cedula"]);
  const foreignIdentifier = normalizedBuyerIdentifier(candidate["foreignIdentifier"]);
  if (rnc === undefined || cedula === undefined || foreignIdentifier === undefined) return undefined;
  const values = [rnc, cedula, foreignIdentifier].filter((value) => value !== null);
  if (values.length > 1) return undefined;
  const normalizedRnc = rnc === null ? null : taxpayer(rnc, "rnc");
  const normalizedCedula = cedula === null ? null : taxpayer(cedula, "cedula");
  if (normalizedRnc === undefined || normalizedCedula === undefined) return undefined;
  const normalizedForeign = foreignIdentifier;
  return Object.freeze({ rnc: normalizedRnc, cedula: normalizedCedula, foreignIdentifier: normalizedForeign });
}

function item(input: unknown, expectedSequence: number): CanonicalIssuanceCommand["items"][number] | undefined {
  const candidate = record(input, ["numeroLinea", "nombreItem", "indicadorFacturacion", "indicadorBienoServicio", "cantidadItem", "precioUnitarioItem", "montoItem"], ["montoDescuento", "montoRecargo"]);
  if (candidate === undefined) return undefined;
  const sequence = parseLineSequence(candidate["numeroLinea"]);
  const formattedSequence = sequence.ok ? formatLineSequence(sequence.value) : sequence;
  const discount = normalizedOptional(candidate["montoDescuento"]);
  const surcharge = normalizedOptional(candidate["montoRecargo"]);
  const nombreItem = requiredString(candidate["nombreItem"]);
  const indicadorFacturacion = indicator(candidate["indicadorFacturacion"], ["0", "1", "2", "3", "4"] as const);
  const indicadorBienoServicio = indicator(candidate["indicadorBienoServicio"], ["1", "2"] as const);
  if (!formattedSequence.ok || formattedSequence.value !== String(expectedSequence) || nombreItem === undefined
    || indicadorFacturacion === undefined || indicadorBienoServicio === undefined || discount === undefined || surcharge === undefined) return undefined;
  const cantidadItem = decimal(candidate["cantidadItem"], parseNonnegativeQuantity);
  const precioUnitarioItem = decimal(candidate["precioUnitarioItem"], parseUnitPrice);
  const montoItem = decimal(candidate["montoItem"], parseNonnegativeAmount);
  const montoDescuento = discount === null ? null : decimal(discount, parseNonnegativeAmount);
  const montoRecargo = surcharge === null ? null : decimal(surcharge, parseNonnegativeAmount);
  if (cantidadItem === undefined || precioUnitarioItem === undefined || montoItem === undefined
    || montoDescuento === undefined || montoRecargo === undefined) return undefined;
  return Object.freeze({ numeroLinea: formattedSequence.value, nombreItem, indicadorFacturacion, indicadorBienoServicio,
    cantidadItem, precioUnitarioItem, montoItem, montoDescuento, montoRecargo });
}

export function canonicalizeIssuanceCommand(input: unknown): Result<CanonicalIssuanceCommand, CanonicalIssuanceCommandError> {
  try {
    const candidate = record(input, ["issuer", "ecfType", "requestedOn", "buyerIdentity", "declaredTotals", "items"]);
    const issuer = candidate === undefined ? undefined : record(candidate["issuer"], ["tenantId", "rnc"]);
    const totals = candidate === undefined ? undefined : record(candidate["declaredTotals"], ["montoTotal", "totalItbis", "montoGravadoTotal", "montoExento"]);
    const items = candidate === undefined ? undefined : array(candidate["items"]);
    const tenantId = issuer === undefined ? undefined : requiredString(issuer["tenantId"]);
    const rnc = issuer === undefined ? undefined : taxpayer(issuer["rnc"], "rnc");
    const ecfType = candidate === undefined ? undefined : requiredString(candidate["ecfType"]);
    const requestedOn = candidate === undefined ? undefined : requiredString(candidate["requestedOn"]);
    const date = requestedOn === undefined ? undefined : new Date(`${requestedOn}T00:00:00.000Z`);
    if (candidate === undefined || issuer === undefined || totals === undefined || items === undefined || items.length === 0 || tenantId === undefined || rnc === undefined
      || ecfType === undefined || requestedOn === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(requestedOn)
      || date === undefined || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== requestedOn
      || !parseENcf(`E${ecfType}0000000000`).ok) return failure();
    const buyer = buyerIdentity(candidate["buyerIdentity"]);
    const montoTotal = decimal(totals["montoTotal"], parseNonnegativeAmount);
    const totalItbis = decimal(totals["totalItbis"], parseNonnegativeAmount);
    const montoGravadoTotal = decimal(totals["montoGravadoTotal"], parseNonnegativeAmount);
    const montoExento = decimal(totals["montoExento"], parseNonnegativeAmount);
    if (buyer === undefined || montoTotal === undefined || totalItbis === undefined || montoGravadoTotal === undefined || montoExento === undefined) return failure();
    const canonicalItems: CanonicalIssuanceCommand["items"][number][] = [];
    for (const [index, inputItem] of items.entries()) {
      const canonicalItem = item(inputItem, index + 1);
      if (canonicalItem === undefined) return failure();
      canonicalItems.push(canonicalItem);
    }
    const command = Object.freeze({ issuer: Object.freeze({ tenantId, rnc }), ecfType, requestedOn, buyerIdentity: buyer,
      declaredTotals: Object.freeze({ montoTotal, totalItbis, montoGravadoTotal, montoExento }), items: Object.freeze(canonicalItems) });
    canonicalCommands.add(command);
    return { ok: true, value: command };
  } catch { return failure(); }
}

export function fingerprintCanonicalIssuanceCommand(input: unknown): Result<string, CanonicalIssuanceCommandError> {
  try {
    if (typeof input !== "object" || input === null || !canonicalCommands.has(input as CanonicalIssuanceCommand)) return failure();
    return { ok: true, value: createHash("sha256").update(`V1::${JSON.stringify(input)}`, "utf8").digest("hex") };
  } catch { return failure(); }
}
