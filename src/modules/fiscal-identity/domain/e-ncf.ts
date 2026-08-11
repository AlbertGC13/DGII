import type {
  MalformedFiscalIdentityError,
  UnsupportedEcfTypeError,
} from "./fiscal-identity-error.js";
import type { Result } from "../../../shared/domain/result.js";

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

const parsedENcfs = new WeakSet<ParsedENcf>();

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

  const parsed = Object.freeze({ value: input as ENcf, type, sequence: input.slice(3) });
  parsedENcfs.add(parsed);
  return { ok: true, value: parsed };
}

export function formatEcf31ENcf(
  allocatedSequence: unknown,
): Result<ParsedENcf, MalformedFiscalIdentityError | UnsupportedEcfTypeError> {
  if (
    typeof allocatedSequence !== "bigint"
    || allocatedSequence < 0n
    || allocatedSequence > 9999999999n
  ) {
    return parseENcf(allocatedSequence);
  }

  return parseENcf(`E31${allocatedSequence.toString().padStart(10, "0")}`);
}

export function isENcf(input: unknown): input is ParsedENcf {
  return typeof input === "object" && input !== null && parsedENcfs.has(input as ParsedENcf);
}
