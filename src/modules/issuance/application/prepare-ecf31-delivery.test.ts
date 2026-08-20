import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import * as api from "../../../index.js";
import type { Result } from "../../../shared/domain/result.js";

const value = <T>(result: Result<T, unknown>): T => { if (!result.ok) throw new Error("Expected synthetic evidence."); return result.value; };
const ok = <T>(item: T) => Object.freeze({ ok: true as const, value: item });
const fail = () => Object.freeze({ ok: false as const, error: Object.freeze({ code: "SYNTHETIC" }) });

function evidence() {
  const header = value(api.createEcf31CoreHeader({ eNcf: value(api.parseENcf("E310000000001")), issuer: { taxpayerIdentifier: value(api.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" }, buyer: { taxpayerIdentifier: value(api.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" }, issueDate: "01-12-2026", incomeType: "01", paymentType: "1" }));
  const calculation = value(api.captureLineCalculationEvidence({ sequence: value(api.parseLineSequence("1")), quantity: value(api.parseNonnegativeQuantity("1")), unitPrice: value(api.parseUnitPrice("10")), declaredAmount: value(api.parseNonnegativeAmount("0")) }));
  const lineAmount = value(api.createEcf31LineAmountEvidence({ coreLine: value(api.createEcf31CoreLine({ evidence: calculation, itemName: "Synthetic item", billingIndicator: 1, goodOrServiceIndicator: 1 })), discountAmount: value(api.parseNonnegativeAmount("0")), surchargeAmount: value(api.parseNonnegativeAmount("0")) }));
  const draft = value(api.createEcf31CoreDraft({ header, lineAmounts: [lineAmount] })); const quantization = value(api.createEcf31MontoItemQuantizationEvidence(lineAmount)); const classification = value(api.createEcf31AdditionalTaxClassificationEvidence({ draft, entries: [{ source: lineAmount, codes: [] }] }));
  const priceInclusionEvidence = value(api.createEcf31ItbisPriceInclusionEvidence({ draft, montoItemQuantizations: [quantization], indicator: 0 })); const taxableBaseEvidence = value(api.createEcf31PostGlobalAdjustmentTaxableBaseEvidence({ priceInclusionEvidence, adjustments: [] }));
  return Object.freeze({ issuanceEvidence: value(api.createEcf31IdDocIssuanceEvidence({ header, sequenceExpirationDate: "31-12-2026" })), draft, derivedHeaderTotalsEvidence: value(api.createEcf31DerivedHeaderTotalsEvidence({ exemptAmountEvidence: value(api.createEcf31PostGlobalAdjustmentExemptAmountEvidence({ draft, montoItemQuantizations: [quantization], adjustments: [] })), additionalTaxClassificationEvidence: classification, taxableBaseEvidence, totalItbisEvidence: value(api.createEcf31TotalItbisEvidence({ taxableBaseEvidence, additionalTaxClassificationEvidence: classification })) })), detallesItemsEvidence: value(api.createEcf31DetallesItemsEvidence({ draft, additionalTaxClassificationEvidence: classification })), priceInclusionEvidence, fechaHoraFirma: "01-12-2026 12:00:00" });
}

const fixture = fileURLToPath(new URL("../../../../test/fixtures/xml/synthetic-verified-signed.xml", import.meta.url));
let artifact: object | undefined;
async function verifiedArtifact() {
  if (artifact !== undefined) return artifact;
  artifact = value(api.verifyDgiiXmlSignature({ xml: await readFile(fixture, "utf8") })); return artifact;
}

describe("prepareEcf31Delivery", () => {
  it("orchestrates exact evidence in order, fixes the schema, hashes the verified bytes, and preserves identity", async () => {
    const artifact = await verifiedArtifact(); const input = evidence(); const calls: string[] = [];
    const prepare = api.createEcf31DeliveryPreparation(Object.freeze({
      assemble: vi.fn((received: unknown) => { calls.push("assemble"); expect(received).toEqual(input); expect((received as Readonly<{ draft: unknown }>).draft).toBe(input.draft); return ok("<unsigned/>"); }),
      sign: vi.fn((xml) => { calls.push("sign"); expect(xml).toBe("<unsigned/>"); return ok(Object.freeze({})); }),
      serialize: vi.fn(() => { calls.push("serialize"); return ok("<signed exact='yes'/>"); }),
      validate: vi.fn((xml, schema) => { calls.push("validate"); expect(xml).toBe("<signed exact='yes'/>"); expect(schema).toBe("ecf-31-v1.0"); return Promise.resolve(ok(Object.freeze({ valid: true }))); }),
      verify: vi.fn((xml) => { calls.push("verify"); expect(xml).toBe("<signed exact='yes'/>"); return ok(artifact); }),
    }));

    expect(prepare).toMatchObject({ ok: true }); if (!prepare.ok) return;
    const result = await prepare.value.prepare(input);
    expect(result).toEqual(ok(Object.freeze({ artifact, signedXmlSha256: createHash("sha256").update("<signed exact='yes'/>", "utf8").digest("hex") })));
    expect(calls).toEqual(["assemble", "sign", "serialize", "validate", "verify"]); expect(Object.isFrozen(result)).toBe(true); expect(result.ok && Object.isFrozen(result.value)).toBe(true);
  });

  it("accepts the exact optional forms and rejects hostile configuration and package boundaries", async () => {
    const artifact = await verifiedArtifact(); const full = evidence(); const { priceInclusionEvidence, ...withoutPrice } = full; void priceInclusionEvidence;
    const capabilities = Object.freeze({ assemble: () => ok("<u/>"), sign: () => ok({}), serialize: () => ok("<s/>"), validate: () => Promise.resolve(ok(Object.freeze({ valid: true }))), verify: () => ok(artifact) });
    const created = api.createEcf31DeliveryPreparation(capabilities); if (!created.ok) throw new Error("Expected preparation.");
    await expect(created.value.prepare(Object.freeze(withoutPrice))).resolves.toMatchObject({ ok: true });
    const accessor = Object.defineProperty({ ...full }, "draft", { enumerable: true, get: () => full.draft });
    for (const candidate of [null, [], {}, Object.freeze({ ...full, draft: {} }), { ...full, extra: true }, Object.defineProperty({ ...full }, "draft", { enumerable: false }), accessor, Object.create(full), new Proxy(full, {}), new Proxy({}, { ownKeys() { throw new Error("fault"); } }), Object.assign({ ...full }, { [Symbol("x")]: true })]) await expect(created.value.prepare(candidate)).resolves.toEqual({ ok: false, error: { code: "INVALID_ECF31_DELIVERY_PREPARATION_INPUT" } });
    for (const configuration of [null, {}, Object.freeze({ ...capabilities, assemble: 1 }), { ...capabilities, extra: true }, Object.defineProperty({ ...capabilities }, "assemble", { enumerable: true, get() { return capabilities.assemble; } }), Object.assign({ ...capabilities }, { [Symbol("x")]: true }), new Proxy(capabilities, {}), new Proxy({}, { ownKeys() { throw new Error("fault"); } })]) expect(api.createEcf31DeliveryPreparation(configuration)).toEqual({ ok: false, error: { code: "INVALID_ECF31_DELIVERY_PREPARATION_CONFIGURATION" } });
  });

  it("rejects genuine evidence whose draft or header lineage belongs to another package", async () => {
    const artifact = await verifiedArtifact(); const full = evidence(); const other = evidence(); const assemble = vi.fn(() => ok("<u/>"));
    const created = api.createEcf31DeliveryPreparation(Object.freeze({ assemble, sign: () => ok({}), serialize: () => ok("<s/>"), validate: () => Promise.resolve(ok(Object.freeze({ valid: true }))), verify: () => ok(artifact) }));
    if (!created.ok) throw new Error("Expected preparation.");
    for (const input of [Object.freeze({ ...full, issuanceEvidence: other.issuanceEvidence }), Object.freeze({ ...full, detallesItemsEvidence: other.detallesItemsEvidence }), Object.freeze({ ...full, derivedHeaderTotalsEvidence: other.derivedHeaderTotalsEvidence }), Object.freeze({ ...full, priceInclusionEvidence: other.priceInclusionEvidence })]) await expect(created.value.prepare(input)).resolves.toEqual({ ok: false, error: { code: "INVALID_ECF31_DELIVERY_PREPARATION_INPUT" } });
    expect(assemble).not.toHaveBeenCalled();
  });

  it("rejects optional price inclusion that is not the derived taxable evidence identity", async () => {
    const artifact = await verifiedArtifact(); const full = evidence(); const quantizations = full.derivedHeaderTotalsEvidence.exemptAmountEvidence.montoItemQuantizations;
    const priceB = value(api.createEcf31ItbisPriceInclusionEvidence({ draft: full.draft, montoItemQuantizations: quantizations, indicator: 0 })); const taxableB = value(api.createEcf31PostGlobalAdjustmentTaxableBaseEvidence({ priceInclusionEvidence: priceB, adjustments: [] }));
    const derivedB = value(api.createEcf31DerivedHeaderTotalsEvidence({ exemptAmountEvidence: full.derivedHeaderTotalsEvidence.exemptAmountEvidence, additionalTaxClassificationEvidence: full.derivedHeaderTotalsEvidence.additionalTaxClassificationEvidence, taxableBaseEvidence: taxableB, totalItbisEvidence: value(api.createEcf31TotalItbisEvidence({ taxableBaseEvidence: taxableB, additionalTaxClassificationEvidence: full.derivedHeaderTotalsEvidence.additionalTaxClassificationEvidence })) }));
    const created = api.createEcf31DeliveryPreparation(Object.freeze({ assemble: vi.fn(() => ok("<u/>")), sign: () => ok({}), serialize: () => ok("<s/>"), validate: () => Promise.resolve(ok(Object.freeze({ valid: true }))), verify: () => ok(artifact) }));
    if (!created.ok) throw new Error("Expected preparation."); await expect(created.value.prepare(Object.freeze({ ...full, derivedHeaderTotalsEvidence: derivedB }))).resolves.toEqual({ ok: false, error: { code: "INVALID_ECF31_DELIVERY_PREPARATION_INPUT" } });
  });

  it("contains every failed, malformed, thrown, and rejected capability result without continuing", async () => {
    const artifact = await verifiedArtifact(); const input = evidence();
    const stages = ["assemble", "sign", "serialize", "validate", "verify"] as const;
    for (const [index, outcome] of [fail(), {}, new Error("fault")].entries()) {
      for (const stage of stages) {
        const calls: string[] = []; const configuration = Object.freeze({
          assemble: () => { calls.push("assemble"); return stage === "assemble" ? outcome instanceof Error ? (() => { throw outcome; })() : outcome : ok("<u/>"); },
          sign: () => { calls.push("sign"); return stage === "sign" ? outcome instanceof Error ? (() => { throw outcome; })() : outcome : ok({}); },
          serialize: () => { calls.push("serialize"); return stage === "serialize" ? outcome instanceof Error ? (() => { throw outcome; })() : outcome : ok("<s/>"); },
          validate: () => { calls.push("validate"); if (stage === "validate" && outcome instanceof Error) return Promise.reject(outcome); return Promise.resolve(stage === "validate" ? outcome : ok(Object.freeze({ valid: true }))); },
          verify: () => { calls.push("verify"); return stage === "verify" ? outcome instanceof Error ? (() => { throw outcome; })() : outcome : ok(artifact); },
        }); const prepared = api.createEcf31DeliveryPreparation(configuration); if (!prepared.ok) throw new Error("Expected preparation.");
        await expect(prepared.value.prepare(input)).resolves.toEqual({ ok: false, error: { code: "ECF31_DELIVERY_PREPARATION_FAILED" } }); expect(calls).toEqual(stages.slice(0, stages.indexOf(stage) + 1));
      }
      expect(index).toBeLessThan(3);
    }
    const invalid = api.createEcf31DeliveryPreparation(Object.freeze({ assemble: () => ok("<u/>"), sign: () => ok({}), serialize: () => ok("<s/>"), validate: () => Promise.resolve(ok(Object.freeze({ valid: false }))), verify: () => ok(artifact) }));
    if (!invalid.ok) throw new Error("Expected preparation."); await expect(invalid.value.prepare(input)).resolves.toEqual({ ok: false, error: { code: "ECF31_DELIVERY_PREPARATION_FAILED" } });
  });
});

it("exports e-CF 31 delivery preparation from the module and package root", async () => {
  expect((await import("../index.js")).createEcf31DeliveryPreparation).toBe(api.createEcf31DeliveryPreparation);
});
