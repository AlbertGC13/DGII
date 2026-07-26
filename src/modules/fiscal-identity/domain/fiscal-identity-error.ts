export type FiscalIdentityField = "taxpayerIdentifier" | "eNcf";

export type MalformedFiscalIdentityError = Readonly<{
  code: "ERP-VAL-002";
  kind: "MALFORMED_FORMAT";
  field: FiscalIdentityField;
  message: string;
}>;

export type UnsupportedEcfTypeError = Readonly<{
  code: "ERP-VAL-003";
  kind: "UNSUPPORTED_ECF_TYPE";
  field: "eNcf";
  classification: "KNOWN_NOT_MVP" | "UNKNOWN";
  message: string;
}>;

export type FiscalIdentityError =
  | MalformedFiscalIdentityError
  | UnsupportedEcfTypeError;
