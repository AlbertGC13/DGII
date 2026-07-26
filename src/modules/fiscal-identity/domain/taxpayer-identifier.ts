import type { MalformedFiscalIdentityError } from "./fiscal-identity-error.js";
import type { Result } from "./result.js";

declare const taxpayerIdentifierBrand: unique symbol;

export type TaxpayerIdentifier = string & {
  readonly [taxpayerIdentifierBrand]: true;
};

export type ParsedTaxpayerIdentifier = Readonly<
  | { kind: "rnc"; value: TaxpayerIdentifier }
  | { kind: "cedula"; value: TaxpayerIdentifier }
>;

const MALFORMED_TAXPAYER_IDENTIFIER = Object.freeze({
  code: "ERP-VAL-002",
  kind: "MALFORMED_FORMAT",
  field: "taxpayerIdentifier",
  message: "Taxpayer identifier must contain exactly 9 or 11 ASCII digits.",
} satisfies MalformedFiscalIdentityError);

export function parseTaxpayerIdentifier(
  input: unknown,
): Result<ParsedTaxpayerIdentifier, MalformedFiscalIdentityError> {
  if (typeof input !== "string" || !/^(?:[0-9]{9}|[0-9]{11})$/.test(input)) {
    return { ok: false, error: MALFORMED_TAXPAYER_IDENTIFIER };
  }

  const value = input as TaxpayerIdentifier;

  return {
    ok: true,
    value: input.length === 9 ? { kind: "rnc", value } : { kind: "cedula", value },
  };
}
