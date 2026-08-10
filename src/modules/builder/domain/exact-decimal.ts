import type { Result } from "../../../shared/domain/result.js";
import type { DecimalError, DecimalErrorCode } from "./decimal-error.js";

declare const exactDecimalBrand: unique symbol;
declare const nonnegativeAmountBrand: unique symbol;
declare const positiveAmountBrand: unique symbol;
declare const positivePercentageBrand: unique symbol;
declare const nonnegativeQuantityBrand: unique symbol;
declare const nonnegativeSubquantityBrand: unique symbol;
declare const positiveQuantityBrand: unique symbol;
declare const unitPriceBrand: unique symbol;

export type ExactDecimal = Readonly<{
  readonly [exactDecimalBrand]: "ExactDecimal";
}>;

export type NonnegativeAmount = ExactDecimal &
  Readonly<{ readonly [nonnegativeAmountBrand]: "NonnegativeAmount" }>;
export type PositiveAmount = ExactDecimal &
  Readonly<{ readonly [positiveAmountBrand]: "PositiveAmount" }>;
export type PositivePercentage = ExactDecimal &
  Readonly<{ readonly [positivePercentageBrand]: "PositivePercentage" }>;
export type NonnegativeQuantity = ExactDecimal &
  Readonly<{ readonly [nonnegativeQuantityBrand]: "NonnegativeQuantity" }>;
export type NonnegativeSubquantity = ExactDecimal &
  Readonly<{ readonly [nonnegativeSubquantityBrand]: "NonnegativeSubquantity" }>;
export type PositiveQuantity = ExactDecimal &
  Readonly<{ readonly [positiveQuantityBrand]: "PositiveQuantity" }>;
export type UnitPrice = ExactDecimal &
  Readonly<{ readonly [unitPriceBrand]: "UnitPrice" }>;

type DecimalParts = Readonly<{
  coefficient: bigint;
  scale: number;
}>;

type DecimalProfile = Readonly<{
  maxScale: number;
  totalDigits: number;
  positive: boolean;
  maxIntegerDigits?: number;
}>;

const AMOUNT_PROFILE = Object.freeze({
  maxScale: 2,
  totalDigits: 18,
  positive: false,
} satisfies DecimalProfile);

const POSITIVE_AMOUNT_PROFILE = Object.freeze({
  ...AMOUNT_PROFILE,
  positive: true,
} satisfies DecimalProfile);

const POSITIVE_PERCENTAGE_PROFILE = Object.freeze({
  maxScale: 2,
  totalDigits: 5,
  positive: true,
  maxIntegerDigits: 3,
} satisfies DecimalProfile);

const UNIT_PRICE_PROFILE = Object.freeze({
  maxScale: 4,
  totalDigits: 20,
  positive: false,
} satisfies DecimalProfile);

const NONNEGATIVE_SUBQUANTITY_PROFILE = Object.freeze({
  maxScale: 3,
  totalDigits: 19,
  positive: false,
  maxIntegerDigits: 16,
} satisfies DecimalProfile);

const ERROR_MESSAGES: Readonly<Record<DecimalErrorCode, string>> = Object.freeze({
  INVALID_DECIMAL: "Value must be a genuine exact decimal.",
  INVALID_TYPE: "Decimal input must be a string.",
  INVALID_LEXICAL_FORM: "Decimal input does not use the required canonical-input syntax.",
  SCALE_EXCEEDED: "Decimal input exceeds the target scale.",
  PRECISION_EXCEEDED: "Decimal input exceeds the target precision.",
  OUT_OF_RANGE: "Decimal value is outside the target range.",
});

const partsByDecimal = new WeakMap<ExactDecimal, DecimalParts>();

function failure(code: DecimalErrorCode): Result<never, DecimalError> {
  return { ok: false, error: { code, message: ERROR_MESSAGES[code] } };
}

function createDecimal(coefficient: bigint, scale: number): ExactDecimal {
  let normalizedCoefficient = coefficient;
  let normalizedScale = scale;

  if (normalizedCoefficient === 0n) {
    normalizedScale = 0;
  } else {
    while (normalizedScale > 0 && normalizedCoefficient % 10n === 0n) {
      normalizedCoefficient /= 10n;
      normalizedScale -= 1;
    }
  }

  const decimal = Object.freeze({}) as unknown as ExactDecimal;
  partsByDecimal.set(
    decimal,
    Object.freeze({ coefficient: normalizedCoefficient, scale: normalizedScale }),
  );
  return decimal;
}

function getParts(decimal: ExactDecimal): DecimalParts {
  const parts = partsByDecimal.get(decimal);

  if (parts === undefined) {
    throw new TypeError("Value is not an ExactDecimal.");
  }

  return parts;
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function parseProfile<T extends ExactDecimal>(
  input: unknown,
  profile: DecimalProfile,
): Result<T, DecimalError> {
  if (typeof input !== "string") {
    return failure("INVALID_TYPE");
  }

  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(input);

  if (match === null) {
    return failure("INVALID_LEXICAL_FORM");
  }

  const integral = match[1] as string;
  const fractional = match[2] ?? "";

  if (profile.maxIntegerDigits !== undefined && integral.length > profile.maxIntegerDigits) {
    return failure("PRECISION_EXCEEDED");
  }

  if (fractional.length > profile.maxScale) {
    return failure("SCALE_EXCEEDED");
  }

  if (integral.length + fractional.length > profile.totalDigits) {
    return failure("PRECISION_EXCEEDED");
  }

  const decimal = createDecimal(BigInt(`${integral}${fractional}`), fractional.length);
  return revalidateProfile<T>(decimal, profile);
}

function revalidateProfile<T extends ExactDecimal>(
  decimal: ExactDecimal,
  profile: DecimalProfile,
): Result<T, DecimalError> {
  const { coefficient, scale } = getParts(decimal);

  if (coefficient < 0n || (profile.positive && coefficient === 0n)) {
    return failure("OUT_OF_RANGE");
  }

  if (scale > profile.maxScale) {
    return failure("SCALE_EXCEEDED");
  }

  const digitCount = coefficient === 0n ? 1 : coefficient.toString().length;
  if (digitCount > profile.totalDigits) {
    return failure("PRECISION_EXCEEDED");
  }

  const integerDigits = Math.max(1, digitCount - scale);
  if (profile.maxIntegerDigits !== undefined && integerDigits > profile.maxIntegerDigits) {
    return failure("PRECISION_EXCEEDED");
  }

  return { ok: true, value: decimal as T };
}

function alignScales(
  left: DecimalParts,
  right: DecimalParts,
): Readonly<{ leftCoefficient: bigint; rightCoefficient: bigint; scale: number }> {
  const scale = Math.max(left.scale, right.scale);
  return {
    leftCoefficient: left.coefficient * powerOfTen(scale - left.scale),
    rightCoefficient: right.coefficient * powerOfTen(scale - right.scale),
    scale,
  };
}

export function parseNonnegativeAmount(input: unknown): Result<NonnegativeAmount, DecimalError> {
  return parseProfile<NonnegativeAmount>(input, AMOUNT_PROFILE);
}

export function parsePositiveAmount(input: unknown): Result<PositiveAmount, DecimalError> {
  return parseProfile<PositiveAmount>(input, POSITIVE_AMOUNT_PROFILE);
}

export function parsePositivePercentage(
  input: unknown,
): Result<PositivePercentage, DecimalError> {
  return parseProfile<PositivePercentage>(input, POSITIVE_PERCENTAGE_PROFILE);
}

export function parseNonnegativeQuantity(
  input: unknown,
): Result<NonnegativeQuantity, DecimalError> {
  return parseProfile<NonnegativeQuantity>(input, AMOUNT_PROFILE);
}

export function parseNonnegativeSubquantity(
  input: unknown,
): Result<NonnegativeSubquantity, DecimalError> {
  return parseProfile<NonnegativeSubquantity>(input, NONNEGATIVE_SUBQUANTITY_PROFILE);
}

export function parsePositiveQuantity(input: unknown): Result<PositiveQuantity, DecimalError> {
  return parseProfile<PositiveQuantity>(input, POSITIVE_AMOUNT_PROFILE);
}

export function parseUnitPrice(input: unknown): Result<UnitPrice, DecimalError> {
  return parseProfile<UnitPrice>(input, UNIT_PRICE_PROFILE);
}

export function revalidateNonnegativeAmount(
  decimal: ExactDecimal,
): Result<NonnegativeAmount, DecimalError> {
  return revalidateProfile<NonnegativeAmount>(decimal, AMOUNT_PROFILE);
}
export function quantizeNonnegativeAmountHalfUp(decimal: unknown): Result<NonnegativeAmount, DecimalError> {
  if (!isExactDecimal(decimal)) return failure("INVALID_DECIMAL");
  const { coefficient, scale } = getParts(decimal);
  if (coefficient < 0n) return failure("OUT_OF_RANGE");
  if (scale <= AMOUNT_PROFILE.maxScale) return revalidateNonnegativeAmount(decimal);
  const divisor = powerOfTen(scale - AMOUNT_PROFILE.maxScale);
  const quotient = coefficient / divisor;
  const remainder = coefficient % divisor;
  const roundedCoefficient = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return revalidateNonnegativeAmount(createDecimal(roundedCoefficient, AMOUNT_PROFILE.maxScale));
}

function normalizeAmountToCents(decimal: ExactDecimal): bigint {
  const { coefficient, scale } = getParts(decimal);
  return coefficient * powerOfTen(AMOUNT_PROFILE.maxScale - scale);
}

export function allocateProportionalAmountHalfUp(
  totalAmount: NonnegativeAmount,
  weight: NonnegativeAmount,
  totalWeight: PositiveAmount,
): Readonly<{ ok: true; value: NonnegativeAmount }>;
export function allocateProportionalAmountHalfUp(
  totalAmount: unknown,
  weight: unknown,
  totalWeight: unknown,
): Result<NonnegativeAmount, DecimalError>;
export function allocateProportionalAmountHalfUp(
  totalAmount: unknown,
  weight: unknown,
  totalWeight: unknown,
): Result<NonnegativeAmount, DecimalError> {
  if (!isExactDecimal(totalAmount) || !isExactDecimal(weight) || !isExactDecimal(totalWeight)) {
    return failure("INVALID_DECIMAL");
  }

  const validTotalAmount = revalidateNonnegativeAmount(totalAmount);
  if (!validTotalAmount.ok) return validTotalAmount;
  const validWeight = revalidateNonnegativeAmount(weight);
  if (!validWeight.ok) return validWeight;
  const validTotalWeight = revalidatePositiveAmount(totalWeight);
  if (!validTotalWeight.ok) return validTotalWeight;

  const numerator = normalizeAmountToCents(validTotalAmount.value)
    * normalizeAmountToCents(validWeight.value);
  const denominator = normalizeAmountToCents(validTotalWeight.value);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const roundedCents = remainder * 2n >= denominator ? quotient + 1n : quotient;

  return revalidateNonnegativeAmount(createDecimal(roundedCents, AMOUNT_PROFILE.maxScale));
}


export function revalidatePositiveAmount(
  decimal: ExactDecimal,
): Result<PositiveAmount, DecimalError> {
  return revalidateProfile<PositiveAmount>(decimal, POSITIVE_AMOUNT_PROFILE);
}

export function revalidatePositivePercentage(
  decimal: ExactDecimal,
): Result<PositivePercentage, DecimalError> {
  return revalidateProfile<PositivePercentage>(decimal, POSITIVE_PERCENTAGE_PROFILE);
}

export function revalidateNonnegativeQuantity(
  decimal: ExactDecimal,
): Result<NonnegativeQuantity, DecimalError> {
  return revalidateProfile<NonnegativeQuantity>(decimal, AMOUNT_PROFILE);
}

export function revalidateNonnegativeSubquantity(
  decimal: ExactDecimal,
): Result<NonnegativeSubquantity, DecimalError> {
  if (!isExactDecimal(decimal)) return failure("INVALID_DECIMAL");
  return revalidateProfile<NonnegativeSubquantity>(decimal, NONNEGATIVE_SUBQUANTITY_PROFILE);
}

export function revalidatePositiveQuantity(
  decimal: ExactDecimal,
): Result<PositiveQuantity, DecimalError> {
  return revalidateProfile<PositiveQuantity>(decimal, POSITIVE_AMOUNT_PROFILE);
}

export function revalidateUnitPrice(decimal: ExactDecimal): Result<UnitPrice, DecimalError> {
  return revalidateProfile<UnitPrice>(decimal, UNIT_PRICE_PROFILE);
}

export function isExactDecimal(input: unknown): input is ExactDecimal {
  return typeof input === "object" && input !== null && partsByDecimal.has(input as ExactDecimal);
}

export function formatDecimal(decimal: ExactDecimal): string {
  const { coefficient, scale } = getParts(decimal);
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString();
  const sign = negative ? "-" : "";

  if (scale === 0) {
    return `${sign}${digits}`;
  }

  if (digits.length <= scale) {
    return `${sign}0.${"0".repeat(scale - digits.length)}${digits}`;
  }

  const decimalPoint = digits.length - scale;
  return `${sign}${digits.slice(0, decimalPoint)}.${digits.slice(decimalPoint)}`;
}

export function addDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const aligned = alignScales(getParts(left), getParts(right));
  return createDecimal(
    aligned.leftCoefficient + aligned.rightCoefficient,
    aligned.scale,
  );
}

export function subtractDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const aligned = alignScales(getParts(left), getParts(right));
  return createDecimal(
    aligned.leftCoefficient - aligned.rightCoefficient,
    aligned.scale,
  );
}

export function multiplyDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const leftParts = getParts(left);
  const rightParts = getParts(right);
  return createDecimal(
    leftParts.coefficient * rightParts.coefficient,
    leftParts.scale + rightParts.scale,
  );
}

export function absoluteDecimal(decimal: ExactDecimal): Readonly<{ ok: true; value: ExactDecimal }>;
export function absoluteDecimal(decimal: unknown): Result<ExactDecimal, DecimalError>;
export function absoluteDecimal(decimal: unknown): Result<ExactDecimal, DecimalError> {
  if (!isExactDecimal(decimal)) return failure("INVALID_DECIMAL");
  const { coefficient, scale } = getParts(decimal);
  return { ok: true, value: createDecimal(coefficient < 0n ? -coefficient : coefficient, scale) };
}

export function multiplyDecimalByCount(
  decimal: ExactDecimal,
  count: number,
): Readonly<{ ok: true; value: ExactDecimal }>;
export function multiplyDecimalByCount(
  decimal: unknown,
  count: unknown,
): Result<ExactDecimal, DecimalError>;
export function multiplyDecimalByCount(
  decimal: unknown,
  count: unknown,
): Result<ExactDecimal, DecimalError> {
  if (!isExactDecimal(decimal)) return failure("INVALID_DECIMAL");
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    return failure("OUT_OF_RANGE");
  }
  const { coefficient, scale } = getParts(decimal);
  return { ok: true, value: createDecimal(coefficient * BigInt(count), scale) };
}

export function compareDecimals(left: ExactDecimal, right: ExactDecimal): -1 | 0 | 1 {
  const aligned = alignScales(getParts(left), getParts(right));

  if (aligned.leftCoefficient < aligned.rightCoefficient) {
    return -1;
  }

  if (aligned.leftCoefficient > aligned.rightCoefficient) {
    return 1;
  }

  return 0;
}
