import { describe, expect, it, vi } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import { parseENcf, parseTaxpayerIdentifier } from "../../fiscal-identity/index.js";

const { createEcf31CoreHeader, isEcf31CoreHeader } = rootApi;

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function validInput() {
  return {
    eNcf: value(parseENcf("E310000000001")),
    issuer: {
      taxpayerIdentifier: value(parseTaxpayerIdentifier("000000000")),
      legalName: " Issuer SA ",
      address: " Av. Example 1 ",
    },
    buyer: {
      taxpayerIdentifier: value(parseTaxpayerIdentifier("00000000000")),
      legalName: " Buyer SRL ",
    },
    issueDate: "01-12-2026",
    incomeType: "01",
    paymentType: "1",
  };
}

function expectSafeFailure(input: unknown): void {
  expect(() => createEcf31CoreHeader(input)).not.toThrow();
  expect(createEcf31CoreHeader(input)).toMatchObject({ ok: false });
}

describe("Ecf31CoreHeader", () => {
  it("captures an immutable post-allocation type-31 header without rewriting accepted strings", () => {
    const input = validInput();
    const header = value(createEcf31CoreHeader(input));

    expect(header).toMatchObject({
      eNcf: input.eNcf,
      issuer: input.issuer,
      buyer: input.buyer,
      issueDate: "01-12-2026",
      incomeType: "01",
      paymentType: "1",
    });
    expect(Object.isFrozen(header)).toBe(true);
    expect(Object.isFrozen(header.issuer)).toBe(true);
    expect(Object.isFrozen(header.buyer)).toBe(true);
    expect(isEcf31CoreHeader(header)).toBe(true);
    expect(isEcf31CoreHeader({ ...header })).toBe(false);
  });

  it.each([
    ["issuer legal-name whitespace", { issuer: { ...validInput().issuer, legalName: " \t" } }, "INVALID_ISSUER_LEGAL_NAME"],
    ["issuer legal-name code-point limit", { issuer: { ...validInput().issuer, legalName: "a".repeat(150) + "\u{1F600}" } }, "INVALID_ISSUER_LEGAL_NAME"],
    ["issuer address whitespace", { issuer: { ...validInput().issuer, address: "\n" } }, "INVALID_ISSUER_ADDRESS"],
    ["issuer address code-point limit", { issuer: { ...validInput().issuer, address: "a".repeat(100) + "\u{1F600}" } }, "INVALID_ISSUER_ADDRESS"],
    ["buyer legal-name whitespace", { buyer: { ...validInput().buyer, legalName: " " } }, "INVALID_BUYER_LEGAL_NAME"],
    ["buyer legal-name code-point limit", { buyer: { ...validInput().buyer, legalName: "a".repeat(150) + "\u{1F600}" } }, "INVALID_BUYER_LEGAL_NAME"],
    ["non-type-31 e-NCF", { eNcf: value(parseENcf("E320000000001")) }, "E_NCF_TYPE_NOT_31"],
    ["non-RNC issuer", { issuer: { ...validInput().issuer, taxpayerIdentifier: value(parseTaxpayerIdentifier("00000000000")) } }, "ISSUER_IDENTIFIER_NOT_RNC"],
    ["bad lexical date", { issueDate: "1-12-2026" }, "INVALID_ISSUE_DATE"],
    ["date lexical ranges", { issueDate: "32-13-2026" }, "INVALID_ISSUE_DATE"],
    ["income type", { incomeType: "07" }, "INVALID_INCOME_TYPE"],
    ["payment type", { paymentType: "4" }, "INVALID_PAYMENT_TYPE"],
  ])("rejects %s with a safe catalog error", (_case, override, code) => {
    const result = createEcf31CoreHeader({ ...validInput(), ...override });

    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(result)).not.toContain("000000000");
  });

  it.each([
    null,
    "header",
    1,
    [],
    { ...validInput(), issuer: null },
    { ...validInput(), buyer: null },
    { ...validInput(), eNcf: { ...validInput().eNcf } },
    { ...validInput(), issuer: { ...validInput().issuer, taxpayerIdentifier: { ...validInput().issuer.taxpayerIdentifier } } },
    { ...validInput(), buyer: { ...validInput().buyer, taxpayerIdentifier: { ...validInput().buyer.taxpayerIdentifier } } },
  ])("rejects invalid or structurally forged inputs safely", expectSafeFailure);

  it("does not swallow unexpected validator failures", () => {
    const trim = vi.spyOn(String.prototype, "trim").mockImplementation(() => {
      throw new Error("unexpected trim failure");
    });

    try {
      expect(() => createEcf31CoreHeader(validInput())).toThrow("unexpected trim failure");
    } finally {
      trim.mockRestore();
    }
  });

  it("contains hostile nested getters and revoked proxies", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const throwingProxy = new Proxy({}, { get: () => { throw new Error("trap"); } });
    const throwingIssuer = { ...validInput(), issuer: throwingProxy };
    const throwingBuyer = { ...validInput(), buyer: throwingProxy };

    for (const input of [throwingProxy, revoked.proxy, throwingIssuer, throwingBuyer]) {
      expectSafeFailure(input);
    }
  });
});

it("exports the Ecf31CoreHeader contract from Builder and the package root", () => {
  expect(builderApi.createEcf31CoreHeader).toBe(rootApi.createEcf31CoreHeader);
  expect(builderApi.isEcf31CoreHeader).toBe(rootApi.isEcf31CoreHeader);
});
