import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import { parseENcf, parseTaxpayerIdentifier } from "../../fiscal-identity/index.js";

const { createEcf31CoreHeader, createEcf31IdDocIssuanceEvidence, isEcf31IdDocIssuanceEvidence } = rootApi;

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function header(paymentType: "1" | "2" | "3" = "1", issueDate = "29-02-2028") {
  return value(createEcf31CoreHeader({
    eNcf: value(parseENcf("E310000000001")),
    issuer: { taxpayerIdentifier: value(parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
    buyer: { taxpayerIdentifier: value(parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
    issueDate,
    incomeType: "01",
    paymentType,
  }));
}

function input(overrides: Record<string, unknown> = {}) {
  return { header: header(), sequenceExpirationDate: "31-12-2028", ...overrides };
}

function expectFailure(inputValue: unknown, code: string): void {
  expect(() => createEcf31IdDocIssuanceEvidence(inputValue)).not.toThrow();
  expect(createEcf31IdDocIssuanceEvidence(inputValue)).toMatchObject({ ok: false, error: { code } });
}

describe("Ecf31IdDocIssuanceEvidence", () => {
  it.each(["1", "3"] as const)("accepts payment type %s without a payment deadline", (paymentType) => {
    const result = createEcf31IdDocIssuanceEvidence(input({ header: header(paymentType) }));

    expect(result).toMatchObject({ ok: true, value: { sequenceExpirationDate: "31-12-2028" } });
  });

  it("accepts a credit deadline equal to or later than the issue date and preserves date strings", () => {
    const equal = value(createEcf31IdDocIssuanceEvidence(input({ header: header("2"), paymentDueDate: "29-02-2028" })));
    const later = value(createEcf31IdDocIssuanceEvidence(input({ header: header("2"), paymentDueDate: "01-03-2028" })));

    expect(equal).toMatchObject({ paymentDueDate: "29-02-2028", sequenceExpirationDate: "31-12-2028" });
    expect(later.paymentDueDate).toBe("01-03-2028");
  });

  it("accepts leap day in a century divisible by four hundred", () => {
    const result = createEcf31IdDocIssuanceEvidence(input({ sequenceExpirationDate: "29-02-2000" }));

    expect(result).toMatchObject({ ok: true, value: { sequenceExpirationDate: "29-02-2000" } });
  });

  it.each([
    ["missing credit deadline", input({ header: header("2") }), "INVALID_ECF31_IDDOC_PAYMENT_DEADLINE"],
    ["cash deadline", input({ paymentDueDate: "29-02-2028" }), "INVALID_ECF31_IDDOC_PAYMENT_DEADLINE"],
    ["free deadline", input({ header: header("3"), paymentDueDate: "29-02-2028" }), "INVALID_ECF31_IDDOC_PAYMENT_DEADLINE"],
    ["credit deadline before issue date", input({ header: header("2"), paymentDueDate: "28-02-2028" }), "INVALID_ECF31_IDDOC_PAYMENT_DEADLINE"],
    ["malformed sequence date", input({ sequenceExpirationDate: "1-12-2028" }), "INVALID_ECF31_IDDOC_DATE"],
    ["nonexistent sequence date", input({ sequenceExpirationDate: "31-04-2028" }), "INVALID_ECF31_IDDOC_DATE"],
    ["non-leap sequence date", input({ sequenceExpirationDate: "29-02-2027" }), "INVALID_ECF31_IDDOC_DATE"],
    ["non-leap century date", input({ sequenceExpirationDate: "29-02-1900" }), "INVALID_ECF31_IDDOC_DATE"],
    ["year zero", input({ sequenceExpirationDate: "29-02-0000" }), "INVALID_ECF31_IDDOC_DATE"],
    ["nonexistent payment date", input({ header: header("2"), paymentDueDate: "29-02-2027" }), "INVALID_ECF31_IDDOC_PAYMENT_DEADLINE"],
    ["calendar-invalid genuine header date", input({ header: header("1", "31-04-2028") }), "INVALID_ECF31_IDDOC_DATE"],
  ])("rejects %s with a safe fixed error", (_case, candidate, code) => {
    expectFailure(candidate, code);
  });

  it("requires a genuine header and contains hostile inputs without coercion", () => {
    const accessor = Object.create(null, { header: { enumerable: true, get: () => { throw new Error("trap"); } }, sequenceExpirationDate: { enumerable: true, value: "31-12-2028" } }) as unknown;
    const customPrototype = Object.create({ inherited: true }) as Record<string, unknown>;
    customPrototype["header"] = header();
    customPrototype["sequenceExpirationDate"] = "31-12-2028";
    const revoked = Proxy.revocable<Record<string, never>>({}, {});
    revoked.revoke();
    const throwingProxy = new Proxy<Record<string, never>>({}, { ownKeys: () => { throw new Error("trap"); } });

    expectFailure(input({ header: { ...header() } }), "INVALID_ECF31_IDDOC_HEADER");
    for (const hostile of [null, [], accessor, customPrototype, revoked.proxy, throwingProxy,
      { sequenceExpirationDate: "31-12-2028" }, { header: header() }, { header: header(), sequenceExpirationDate: "31-12-2028", unexpected: true },
      Object.defineProperties({}, { header: { enumerable: false, value: header() }, sequenceExpirationDate: { enumerable: true, value: "31-12-2028" } })]) {
      expectFailure(hostile, "INVALID_ECF31_IDDOC_INPUT");
    }
  });

  it("freezes a nominal evidence value", () => {
    const evidence = value(createEcf31IdDocIssuanceEvidence(input()));

    expect(Object.isFrozen(evidence)).toBe(true);
    expect(isEcf31IdDocIssuanceEvidence(evidence)).toBe(true);
    expect(isEcf31IdDocIssuanceEvidence({ ...evidence })).toBe(false);
  });
});

it("exports the IdDoc issuance evidence contract from Builder and the package root", () => {
  expect(builderApi.createEcf31IdDocIssuanceEvidence).toBe(rootApi.createEcf31IdDocIssuanceEvidence);
  expect(builderApi.isEcf31IdDocIssuanceEvidence).toBe(rootApi.isEcf31IdDocIssuanceEvidence);
  expect(builderApi.ECF31_IDDOC_ISSUANCE_EVIDENCE_POLICY_ID).toBe("ecf31-iddoc-issuance-evidence-v1");
});
