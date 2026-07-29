import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";

const { assessLineTolerance, captureLineCalculationEvidence, formatDecimal, formatLineSequence, parseLineSequence, parseNonnegativeAmount, parseNonnegativeQuantity, parseUnitPrice, subtractDecimals, validateLineCalculationEvidenceCollection } = rootApi;

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function line(sequence: string, declaredAmount = "3.75") {
  return value(captureLineCalculationEvidence({
    sequence: value(parseLineSequence(sequence)),
    quantity: value(parseNonnegativeQuantity("1.5")),
    unitPrice: value(parseUnitPrice("2.5")),
    declaredAmount: value(parseNonnegativeAmount(declaredAmount)),
  }));
}

describe("line calculation evidence", () => {
  it("captures immutable operands from profile-compatible exact brands, multiplication, and delta", () => {
    const quantity = value(parseNonnegativeAmount("001.20"));
    const unitPrice = value(parseNonnegativeAmount("2.5"));
    const declaredAmount = value(parseUnitPrice("3.01"));
    const input = { sequence: value(parseLineSequence("0001")), quantity, unitPrice, declaredAmount };
    const evidence = value(captureLineCalculationEvidence(input as never));

    expect({ sequence: value(formatLineSequence(evidence.sequence)), quantity: formatDecimal(evidence.quantity), unitPrice: formatDecimal(evidence.unitPrice), computed: formatDecimal(evidence.computedAmount), declared: formatDecimal(evidence.declaredAmount), delta: formatDecimal(evidence.delta) }).toEqual({ sequence: "1", quantity: "1.2", unitPrice: "2.5", computed: "3", declared: "3.01", delta: "0.01" });
    expect(evidence.quantity).toBe(quantity);
    expect(evidence.unitPrice).toBe(unitPrice);
    expect(evidence.declaredAmount).toBe(declaredAmount);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(input).toEqual({ sequence: input.sequence, quantity, unitPrice, declaredAmount });
  });

  it("preserves positive, negative, and zero declared-minus-computed deltas", () => {
    expect(formatDecimal(line("1", "3.76").delta)).toBe("0.01");
    expect(formatDecimal(line("1", "3.74").delta)).toBe("-0.01");
    expect(formatDecimal(line("1").delta)).toBe("0");
  });

  it("uses a strict string parser for positive safe-integer sequences, matching decimal leading-zero normalization", () => {
    expect(value(formatLineSequence(value(parseLineSequence("00042"))))).toBe("42");
    expect(parseLineSequence(1)).toMatchObject({ ok: false, error: { code: "INVALID_SEQUENCE_TYPE" } });
    expect(parseLineSequence("0")).toMatchObject({ ok: false, error: { code: "INVALID_SEQUENCE_RANGE" } });
    expect(parseLineSequence("-1")).toMatchObject({ ok: false, error: { code: "INVALID_SEQUENCE_LEXICAL_FORM" } });
    expect(parseLineSequence("1.0")).toMatchObject({ ok: false, error: { code: "INVALID_SEQUENCE_LEXICAL_FORM" } });
    expect(parseLineSequence("9007199254740992")).toMatchObject({ ok: false, error: { code: "INVALID_SEQUENCE_RANGE" } });
  });

  it("accepts a neutral empty collection and valid contiguous lines without mutation", () => {
    const empty = value(validateLineCalculationEvidenceCollection([]));
    const lines = [line("1"), line("2"), line("3")];
    const collection = value(validateLineCalculationEvidenceCollection(lines));

    expect(empty).toEqual([]);
    expect(Object.isFrozen(empty)).toBe(true);
    expect(collection).toEqual(lines);
    expect(collection).not.toBe(lines);
    expect(Object.isFrozen(collection)).toBe(true);
  });

  it.each([
    ["starts above one", [line("2")], "COLLECTION_STARTS_AFTER_ONE"],
    ["has a gap", [line("1"), line("3")], "COLLECTION_GAP"],
    ["duplicates a sequence", [line("1"), line("1")], "COLLECTION_DUPLICATE"],
    ["is out of order", [line("1"), line("3"), line("2")], "COLLECTION_OUT_OF_ORDER"],
  ] as const)("rejects a collection that %s with a safe catalog error", (_case, lines, code) => {
    const result = validateLineCalculationEvidenceCollection(lines);
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(result)).not.toContain("3.75");
  });

  it("assesses exact deltas inclusively against a caller-supplied versioned policy", () => {
    const evidence = line("1", "3.76");
    const assessment = value(assessLineTolerance(evidence, { policyId: "synthetic-tolerance-v1", limit: value(parseNonnegativeAmount("0.01")) }));

    expect({ outcome: assessment.outcome, policyId: assessment.policyId, delta: formatDecimal(assessment.delta), absoluteDelta: formatDecimal(assessment.absoluteDelta), limit: formatDecimal(assessment.limit) }).toEqual({ outcome: "within_tolerance", policyId: "synthetic-tolerance-v1", delta: "0.01", absoluteDelta: "0.01", limit: "0.01" });
    expect(Object.isFrozen(assessment)).toBe(true);
  });

  it("reports a just-over tolerance outcome without changing evidence", () => {
    const evidence = line("1", "3.74");
    const assessment = value(assessLineTolerance(evidence, { policyId: "synthetic-tolerance-v1", limit: value(parseUnitPrice("0.009")) }));

    expect(assessment.outcome).toBe("outside_tolerance");
    expect(formatDecimal(assessment.delta)).toBe("-0.01");
    expect(formatDecimal(assessment.absoluteDelta)).toBe("0.01");
    expect(formatDecimal(evidence.declaredAmount)).toBe("3.74");
    expect(formatDecimal(evidence.computedAmount)).toBe("3.75");
  });

  it("rejects an empty policy identifier and exact negative tolerance", () => {
    const evidence = line("1");
    const zero = value(parseNonnegativeAmount("0"));
    const oneCent = value(parseNonnegativeAmount("0.01"));
    expect(assessLineTolerance(evidence, { policyId: " ", limit: zero })).toMatchObject({ ok: false, error: { code: "EMPTY_TOLERANCE_POLICY_ID" } });
    expect(assessLineTolerance(evidence, { policyId: "synthetic-tolerance-v1", limit: subtractDecimals(zero, oneCent) })).toMatchObject({ ok: false, error: { code: "NEGATIVE_TOLERANCE_LIMIT" } });
  });
});

describe("Builder line calculation evidence exports", () => {
  it("exports the contract from both the Builder module and package root", () => {
    expect(builderApi.captureLineCalculationEvidence).toBe(rootApi.captureLineCalculationEvidence);
    expect(builderApi.assessLineTolerance).toBe(rootApi.assessLineTolerance);
  });
});

function expectSafeFailure(action: () => unknown, code: string): void {
  expect(action).not.toThrow();
  expect(action()).toMatchObject({ ok: false, error: { code } });
}

describe("line calculation evidence runtime boundaries", () => {
  const forged = Object.freeze({});
  const validInput = {
    sequence: value(parseLineSequence("1")),
    quantity: value(parseNonnegativeQuantity("1")),
    unitPrice: value(parseUnitPrice("1")),
    declaredAmount: value(parseNonnegativeAmount("1")),
  };

  it.each([null, "sequence", 1, forged])("formats untrusted sequence input safely", (input) => {
    expectSafeFailure(() => formatLineSequence(input as never), "INVALID_LINE_EVIDENCE_SEQUENCE");
  });

  it.each([
    [null, "INVALID_LINE_EVIDENCE_INPUT"],
    ["input", "INVALID_LINE_EVIDENCE_INPUT"],
    [1, "INVALID_LINE_EVIDENCE_INPUT"],
    [{ ...validInput, sequence: forged }, "INVALID_LINE_EVIDENCE_SEQUENCE"],
    [{ ...validInput, quantity: forged }, "INVALID_LINE_EVIDENCE_DECIMAL"],
    [{ ...validInput, quantity: subtractDecimals(value(parseNonnegativeAmount("0")), value(parseNonnegativeAmount("0.01"))) }, "INVALID_LINE_EVIDENCE_DECIMAL"],
    [{ ...validInput, unitPrice: subtractDecimals(value(parseNonnegativeAmount("0")), value(parseNonnegativeAmount("0.01"))) }, "INVALID_LINE_EVIDENCE_DECIMAL"],
    [{ ...validInput, declaredAmount: value(parseUnitPrice("0.001")) }, "INVALID_LINE_EVIDENCE_DECIMAL"],
  ])("captures untrusted input safely", (input, code) => {
    expectSafeFailure(() => captureLineCalculationEvidence(input as never), code);
  });

  it.each([null, "lines", 1, [{ ...line("1"), sequence: forged }], [{ ...line("1"), quantity: forged }], [{ ...line("1"), computedAmount: validInput.declaredAmount }]])("validates untrusted collections safely", (input) => {
    expectSafeFailure(() => validateLineCalculationEvidenceCollection(input as never), "INVALID_LINE_EVIDENCE_COLLECTION");
  });

  it.each([
    [null, { policyId: "policy", limit: validInput.declaredAmount }, "INVALID_LINE_EVIDENCE_INPUT"],
    ["evidence", { policyId: "policy", limit: validInput.declaredAmount }, "INVALID_LINE_EVIDENCE_INPUT"],
    [{ ...line("1"), delta: forged }, { policyId: "policy", limit: validInput.declaredAmount }, "INVALID_LINE_EVIDENCE_INPUT"],
    [{ ...line("1"), delta: validInput.declaredAmount }, { policyId: "policy", limit: validInput.declaredAmount }, "INVALID_LINE_EVIDENCE_INPUT"],
    [line("1"), null, "INVALID_TOLERANCE_POLICY"],
    [line("1"), { policyId: 1, limit: validInput.declaredAmount }, "INVALID_TOLERANCE_POLICY"],
    [line("1"), { policyId: " ", limit: validInput.declaredAmount }, "EMPTY_TOLERANCE_POLICY_ID"],
    [line("1"), { policyId: "policy", limit: forged }, "INVALID_TOLERANCE_POLICY"],
  ])("assesses untrusted evidence and policies safely", (evidence, policy, code) => {
    expectSafeFailure(() => assessLineTolerance(evidence as never, policy as never), code);
  });
});

it("contains hostile proxy boundaries", () => {
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const input of [new Proxy({}, { get: () => { throw new Error("trap"); } }), revoked.proxy]) {
    expectSafeFailure(() => captureLineCalculationEvidence(input as never), "INVALID_LINE_EVIDENCE_INPUT");
    expectSafeFailure(() => validateLineCalculationEvidenceCollection(input as never), "INVALID_LINE_EVIDENCE_COLLECTION");
    expectSafeFailure(() => assessLineTolerance(line("1"), input as never), "INVALID_TOLERANCE_POLICY");
  }
});
