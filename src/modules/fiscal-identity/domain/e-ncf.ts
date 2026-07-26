import type {
  MalformedFiscalIdentityError,
  UnsupportedEcfTypeError,
} from "./fiscal-identity-error.js";
import type { Result } from "./result.js";

declare const eNcfBrand: unique symbol;

export type ENcf = string & { readonly [eNcfBrand]: true };
export type SupportedEcfType = "31" | "32" | "33" | "34";

export type ParsedENcf = Readonly<{
  value: ENcf;
  type: SupportedEcfType;
  sequence: string;
}>;

const SUPPORTED_ECF_TYPES: ReadonlySet<string> = new Set(["31", "32", "33", "34"]);
const KNOWN_NON_MVP_ECF_TYPES: ReadonlySet<string> = new Set([
  "41",
  "43",
  "44",
  "45",
  "46",
  "47",
]);

const MALFORMED_E_NCF = Object.freeze({
  code: "ERP-VAL-002",
  kind: "MALFORMED_FORMAT",
  field: "eNcf",
  message: "e-NCF must contain exactly 13 characters: E, a two-digit type, and 10 digits.",
} satisfies MalformedFiscalIdentityError);

function isSupportedEcfType(value: string): value is SupportedEcfType {
  return SUPPORTED_ECF_TYPES.has(value);
}

export function parseENcf(
  input: unknown,
): Result<ParsedENcf, MalformedFiscalIdentityError | UnsupportedEcfTypeError> {
  if (typeof input !== "string" || !/^E[0-9]{12}$/.test(input)) {
    return { ok: false, error: MALFORMED_E_NCF };
  }

  const type = input.slice(1, 3);

  if (!isSupportedEcfType(type)) {
    return {
      ok: false,
      error: {
        code: "ERP-VAL-003",
        kind: "UNSUPPORTED_ECF_TYPE",
        field: "eNcf",
        classification: KNOWN_NON_MVP_ECF_TYPES.has(type) ? "KNOWN_NOT_MVP" : "UNKNOWN",
        message: "e-CF type is not supported by the MVP.",
      },
    };
  }

  return {
    ok: true,
    value: {
      value: input as ENcf,
      type,
      sequence: input.slice(3),
    },
  };
}
