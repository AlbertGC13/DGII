export type DecimalErrorCode =
  | "INVALID_DECIMAL"
  | "INVALID_TYPE"
  | "INVALID_LEXICAL_FORM"
  | "SCALE_EXCEEDED"
  | "PRECISION_EXCEEDED"
  | "OUT_OF_RANGE";

export type DecimalError = Readonly<{
  code: DecimalErrorCode;
  message: string;
}>;
