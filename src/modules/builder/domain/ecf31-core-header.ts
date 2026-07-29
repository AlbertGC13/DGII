import { isENcf, isTaxpayerIdentifier } from "../../fiscal-identity/index.js";
import type { ParsedENcf, ParsedTaxpayerIdentifier } from "../../fiscal-identity/index.js";
import type { Result } from "../../../shared/domain/result.js";

export type Ecf31CoreHeader = Readonly<{
  eNcf: ParsedENcf;
  issuer: Readonly<{
    taxpayerIdentifier: ParsedTaxpayerIdentifier;
    legalName: string;
    address: string;
  }>;
  buyer: Readonly<{
    taxpayerIdentifier: ParsedTaxpayerIdentifier;
    legalName: string;
  }>;
  issueDate: string;
  incomeType: "01" | "02" | "03" | "04" | "05" | "06";
  paymentType: "1" | "2" | "3";
}>;

export type Ecf31CoreHeaderErrorCode =
  | "INVALID_HEADER_INPUT"
  | "INVALID_E_NCF"
  | "E_NCF_TYPE_NOT_31"
  | "INVALID_ISSUER_IDENTIFIER"
  | "ISSUER_IDENTIFIER_NOT_RNC"
  | "INVALID_BUYER_IDENTIFIER"
  | "INVALID_ISSUER_LEGAL_NAME"
  | "INVALID_ISSUER_ADDRESS"
  | "INVALID_BUYER_LEGAL_NAME"
  | "INVALID_ISSUE_DATE"
  | "INVALID_INCOME_TYPE"
  | "INVALID_PAYMENT_TYPE";

export type Ecf31CoreHeaderError = Readonly<{
  code: Ecf31CoreHeaderErrorCode;
  message: string;
}>;

const MESSAGES: Readonly<Record<Ecf31CoreHeaderErrorCode, string>> = Object.freeze({
  INVALID_HEADER_INPUT: "E-CF 31 core header input is invalid.",
  INVALID_E_NCF: "e-NCF must be a parsed fiscal identity.",
  E_NCF_TYPE_NOT_31: "e-NCF must be type 31.",
  INVALID_ISSUER_IDENTIFIER: "Issuer taxpayer identifier must be a parsed fiscal identity.",
  ISSUER_IDENTIFIER_NOT_RNC: "Issuer taxpayer identifier must be an RNC.",
  INVALID_BUYER_IDENTIFIER: "Buyer taxpayer identifier must be a parsed fiscal identity.",
  INVALID_ISSUER_LEGAL_NAME: "Issuer legal name must be nonblank and at most 150 code points.",
  INVALID_ISSUER_ADDRESS: "Issuer address must be nonblank and at most 100 code points.",
  INVALID_BUYER_LEGAL_NAME: "Buyer legal name must be nonblank and at most 150 code points.",
  INVALID_ISSUE_DATE: "Issue date must use dd-MM-AAAA lexical form.",
  INVALID_INCOME_TYPE: "Income type must be a supported type.",
  INVALID_PAYMENT_TYPE: "Payment type must be a supported type.",
});

const headers = new WeakSet<Ecf31CoreHeader>();
const INCOME_TYPES = ["01", "02", "03", "04", "05", "06"] as const;
const PAYMENT_TYPES = ["1", "2", "3"] as const;

function failure(code: Ecf31CoreHeaderErrorCode): Result<never, Ecf31CoreHeaderError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null;
}

function isNonblankText(input: unknown, maximumCodePoints: number): input is string {
  return typeof input === "string"
    && input.trim().length > 0
    && Array.from(input).length <= maximumCodePoints;
}

function isIssueDate(input: unknown): input is string {
  return typeof input === "string"
    && /^(?:0[1-9]|[12][0-9]|3[01])-(?:0[1-9]|1[0-2])-[0-9]{4}$/.test(input);
}

type HeaderCandidates = Readonly<{
  eNcf: unknown;
  issuer: unknown;
  buyer: unknown;
  issueDate: unknown;
  incomeType: unknown;
  paymentType: unknown;
}>;

type IssuerCandidates = Readonly<{
  taxpayerIdentifier: unknown;
  legalName: unknown;
  address: unknown;
}>;

type BuyerCandidates = Readonly<{
  taxpayerIdentifier: unknown;
  legalName: unknown;
}>;

function readHeaderCandidates(input: Readonly<Record<string, unknown>>): HeaderCandidates | undefined {
  try {
    return {
      eNcf: input["eNcf"],
      issuer: input["issuer"],
      buyer: input["buyer"],
      issueDate: input["issueDate"],
      incomeType: input["incomeType"],
      paymentType: input["paymentType"],
    };
  } catch {
    return undefined;
  }
}

function readIssuerCandidates(input: Readonly<Record<string, unknown>>): IssuerCandidates | undefined {
  try {
    return {
      taxpayerIdentifier: input["taxpayerIdentifier"],
      legalName: input["legalName"],
      address: input["address"],
    };
  } catch {
    return undefined;
  }
}

function readBuyerCandidates(input: Readonly<Record<string, unknown>>): BuyerCandidates | undefined {
  try {
    return {
      taxpayerIdentifier: input["taxpayerIdentifier"],
      legalName: input["legalName"],
    };
  } catch {
    return undefined;
  }
}

export function createEcf31CoreHeader(
  input: unknown,
): Result<Ecf31CoreHeader, Ecf31CoreHeaderError> {
  if (!isRecord(input)) return failure("INVALID_HEADER_INPUT");

  const headerCandidates = readHeaderCandidates(input);
  if (headerCandidates === undefined) return failure("INVALID_HEADER_INPUT");

  const { eNcf, issuer, buyer, issueDate, incomeType, paymentType } = headerCandidates;
  if (!isENcf(eNcf)) return failure("INVALID_E_NCF");
  if (eNcf.type !== "31") return failure("E_NCF_TYPE_NOT_31");

  if (!isRecord(issuer)) return failure("INVALID_ISSUER_IDENTIFIER");
  const issuerCandidates = readIssuerCandidates(issuer);
  if (issuerCandidates === undefined) return failure("INVALID_HEADER_INPUT");
  const { taxpayerIdentifier: issuerIdentifier, legalName: issuerLegalName, address: issuerAddress } = issuerCandidates;
  if (!isTaxpayerIdentifier(issuerIdentifier)) return failure("INVALID_ISSUER_IDENTIFIER");
  if (issuerIdentifier.kind !== "rnc") return failure("ISSUER_IDENTIFIER_NOT_RNC");
  if (!isNonblankText(issuerLegalName, 150)) return failure("INVALID_ISSUER_LEGAL_NAME");
  if (!isNonblankText(issuerAddress, 100)) return failure("INVALID_ISSUER_ADDRESS");

  if (!isRecord(buyer)) return failure("INVALID_BUYER_IDENTIFIER");
  const buyerCandidates = readBuyerCandidates(buyer);
  if (buyerCandidates === undefined) return failure("INVALID_HEADER_INPUT");
  const { taxpayerIdentifier: buyerIdentifier, legalName: buyerLegalName } = buyerCandidates;
  if (!isTaxpayerIdentifier(buyerIdentifier)) return failure("INVALID_BUYER_IDENTIFIER");
  if (!isNonblankText(buyerLegalName, 150)) return failure("INVALID_BUYER_LEGAL_NAME");

  if (!isIssueDate(issueDate)) return failure("INVALID_ISSUE_DATE");
  if (!INCOME_TYPES.includes(incomeType as never)) return failure("INVALID_INCOME_TYPE");
  if (!PAYMENT_TYPES.includes(paymentType as never)) return failure("INVALID_PAYMENT_TYPE");

  const header = Object.freeze({
    eNcf,
    issuer: Object.freeze({
      taxpayerIdentifier: issuerIdentifier,
      legalName: issuerLegalName,
      address: issuerAddress,
    }),
    buyer: Object.freeze({
      taxpayerIdentifier: buyerIdentifier,
      legalName: buyerLegalName,
    }),
    issueDate,
    incomeType: incomeType as Ecf31CoreHeader["incomeType"],
    paymentType: paymentType as Ecf31CoreHeader["paymentType"],
  });
  headers.add(header);
  return { ok: true, value: header };
}

export function isEcf31CoreHeader(input: unknown): input is Ecf31CoreHeader {
  return typeof input === "object" && input !== null && headers.has(input as Ecf31CoreHeader);
}
