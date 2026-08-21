/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as api from "../../../index.js";
import { createEcf31DeliveryCoordinator } from "./coordinate-ecf31-delivery.js";

function value<T>(result: api.Result<T, unknown>): T { if (!result.ok) throw new Error("Expected fixture value."); return result.value; }
const signedFixture = fileURLToPath(new URL("../../../../test/fixtures/xml/synthetic-verified-signed.xml", import.meta.url));
let artifact: object | undefined;
async function verifiedArtifact() { artifact ??= value(api.verifyDgiiXmlSignature({ xml: await readFile(signedFixture, "utf8") })); return artifact; }

function evidence() {
  const header = value(api.createEcf31CoreHeader({ eNcf: value(api.parseENcf("E310000000001")), issuer: { taxpayerIdentifier: value(api.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" }, buyer: { taxpayerIdentifier: value(api.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" }, issueDate: "01-12-2026", incomeType: "01", paymentType: "1" }));
  const line = value(api.createEcf31LineAmountEvidence({ coreLine: value(api.createEcf31CoreLine({ evidence: value(api.captureLineCalculationEvidence({ sequence: value(api.parseLineSequence("1")), quantity: value(api.parseNonnegativeQuantity("1")), unitPrice: value(api.parseUnitPrice("1")), declaredAmount: value(api.parseNonnegativeAmount("1")) })), itemName: "Synthetic item", billingIndicator: 1, goodOrServiceIndicator: 1 })), discountAmount: value(api.parseNonnegativeAmount("0")), surchargeAmount: value(api.parseNonnegativeAmount("0")) }));
  const draft = value(api.createEcf31CoreDraft({ header, lineAmounts: [line] })); const quantization = value(api.createEcf31MontoItemQuantizationEvidence(line)); const classification = value(api.createEcf31AdditionalTaxClassificationEvidence({ draft, entries: [{ source: line, codes: [] }] })); const priceInclusionEvidence = value(api.createEcf31ItbisPriceInclusionEvidence({ draft, montoItemQuantizations: [quantization], indicator: 0 })); const taxableBaseEvidence = value(api.createEcf31PostGlobalAdjustmentTaxableBaseEvidence({ priceInclusionEvidence, adjustments: [] }));
  return Object.freeze({ issuanceEvidence: value(api.createEcf31IdDocIssuanceEvidence({ header, sequenceExpirationDate: "31-12-2026" })), draft, derivedHeaderTotalsEvidence: value(api.createEcf31DerivedHeaderTotalsEvidence({ exemptAmountEvidence: value(api.createEcf31PostGlobalAdjustmentExemptAmountEvidence({ draft, montoItemQuantizations: [quantization], adjustments: [] })), additionalTaxClassificationEvidence: classification, taxableBaseEvidence, totalItbisEvidence: value(api.createEcf31TotalItbisEvidence({ taxableBaseEvidence, additionalTaxClassificationEvidence: classification })) })), detallesItemsEvidence: value(api.createEcf31DetallesItemsEvidence({ draft, additionalTaxClassificationEvidence: classification })), priceInclusionEvidence, fechaHoraFirma: "01-12-2026 12:00:00" });
}

type Outcome = { outcome: string; [key: string]: unknown };
async function harness(overrides: Partial<Record<"prepare" | "append" | "acknowledge" | "submit" | "transaction" | "local", unknown>> = {}) {
  const calls: string[] = []; const prepared = await verifiedArtifact();
  const persistence = { prepareAttempt: async (input: unknown): Promise<Outcome> => { calls.push("prepare"); return overrides.prepare as Outcome ?? { outcome: "prepared", attemptNo: 1 }; }, appendEvent: async (input: { kind: string }): Promise<Outcome> => { calls.push(input.kind); return overrides.append as Outcome ?? { outcome: "appended", eventId: 1n, stateApplied: true, anomaly: false }; }, acknowledgeAttempt: async (): Promise<Outcome> => { calls.push("acknowledge"); return overrides.acknowledge as Outcome ?? { outcome: "recorded", attemptNo: 1, acknowledgedAt: "2026-12-01T12:00:00Z" }; }, recordAcknowledgedAttempt: async (): Promise<Outcome> => ({ outcome: "recorded", attemptNo: 1, acknowledgedAt: "2026-12-01T12:00:00Z" }) };
  const transactions = { run: async (work: (port: typeof persistence) => Promise<unknown>) => { calls.push("run"); if (overrides.transaction === "throw") throw new Error("safe"); if (overrides.transaction) return overrides.transaction; try { return { outcome: "committed", value: await work(persistence) }; } catch { return { outcome: "rolled_back" }; } } };
  const preparation = { prepare: async () => { calls.push("local"); if (overrides.local === "throw") throw new Error("safe"); return overrides.local ?? { ok: true as const, value: { artifact: prepared, signedXmlSha256: "a".repeat(64) } }; } };
  const reception = { submit: async () => { calls.push("submit"); if (overrides.submit === "throw") throw new Error("safe"); return overrides.submit ?? { ok: true as const, value: { trackId: "track-1" } }; } };
  const coordinator = value(createEcf31DeliveryCoordinator({ preparation, transactions, reception }));
  return { calls, coordinator, input: Object.freeze({ allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF" as const, evidence: evidence() }) };
}

describe("e-CF 31 delivery coordinator", () => {
  it("prepares, durably starts, submits once, and atomically acknowledges", async () => {
    const h = await harness(); const result = await h.coordinator.coordinate(h.input);
    expect(result).toEqual({ outcome: "acknowledged", trackId: "track-1" }); expect(Object.isFrozen(result)).toBe(true);
    expect(h.calls).toEqual(["local", "run", "prepare", "run", "POST_STARTED", "submit", "run", "acknowledge", "RECEPTION_ACKNOWLEDGED"]);
  });

  it.each([
    [{ outcome: "missing_allocation" }, "delivery_not_ready"], [{ outcome: "missing_snapshot" }, "delivery_not_ready"], [{ outcome: "conflict" }, "delivery_conflict"], [{ outcome: "invalid_attempt" }, "invalid_request"], [{ outcome: "persistence_unavailable" }, "persistence_unavailable"],
  ])("maps first-transaction %o safely", async (prepare, outcome) => {
    const h = await harness({ prepare }); expect(await h.coordinator.coordinate(h.input)).toEqual({ outcome }); expect(h.calls).not.toContain("submit");
  });

  it.each([
    [{ outcome: "replayed", eventId: 1n, stateApplied: true, anomaly: false }, "automatic_resend_blocked"], [{ outcome: "appended", eventId: 1n, stateApplied: false, anomaly: false }, "automatic_resend_blocked"], [{ outcome: "conflict" }, "automatic_resend_blocked"], [{ outcome: "persistence_unavailable" }, "persistence_unavailable"],
  ])("never submits when POST_STARTED is %o", async (append, outcome) => {
    const h = await harness({ append }); expect(await h.coordinator.coordinate(h.input)).toEqual({ outcome }); expect(h.calls).not.toContain("submit");
  });

  it("blocks a faithful replay before a second reception call", async () => {
    const h = await harness(); let started = false; let submissions = 0;
    const coordinator = value(createEcf31DeliveryCoordinator({ preparation: { prepare: async () => ({ ok: true as const, value: { artifact: await verifiedArtifact(), signedXmlSha256: "a".repeat(64) } }) }, transactions: { run: async (work: (p: unknown) => Promise<unknown>) => { try { return { outcome: "committed", value: await work({ prepareAttempt: async () => ({ outcome: "replayed", attemptNo: 1 }), appendEvent: async (event: { kind: string }) => event.kind === "POST_STARTED" && started ? { outcome: "replayed", eventId: 1n, stateApplied: true, anomaly: false } : (started = event.kind === "POST_STARTED" || started, { outcome: "appended", eventId: 1n, stateApplied: true, anomaly: false }), acknowledgeAttempt: async () => ({ outcome: "recorded", attemptNo: 1, acknowledgedAt: "2026-12-01T12:00:00Z" }), recordAcknowledgedAttempt: async () => ({ outcome: "recorded", attemptNo: 1, acknowledgedAt: "2026-12-01T12:00:00Z" }) }) }; } catch { return { outcome: "rolled_back" }; } } }, reception: { submit: async () => (submissions += 1, { ok: true as const, value: { trackId: "track" } }) } }));
    await coordinator.coordinate(h.input); expect(await coordinator.coordinate(h.input)).toEqual({ outcome: "automatic_resend_blocked" }); expect(submissions).toBe(1);
  });

  it.each([
    [{ ok: false, error: { code: "DGII_RECEPTION_FAILED" } }, undefined], [undefined, "track-1"],
  ])("contains reception and post-reception uncertainty", async (submit, trackId) => {
    const h = await harness({ submit, acknowledge: { outcome: "conflict" } }); expect(await h.coordinator.coordinate(h.input)).toEqual({ outcome: "outcome_unknown", ...(trackId === undefined ? {} : { trackId }) }); expect(h.calls).toContain("OUTCOME_UNKNOWN");
  });

  it("rejects hostile input and malformed configuration before ports", async () => {
    const h = await harness(); const proxy = new Proxy({}, { ownKeys() { throw new Error("trap"); } });
    expect(createEcf31DeliveryCoordinator({ preparation: proxy, transactions: {}, reception: {} })).toEqual({ ok: false, error: { code: "INVALID_ECF31_DELIVERY_COORDINATOR_CONFIGURATION" } });
    expect(await h.coordinator.coordinate({ ...h.input, eNcf: "E310000000001" })).toEqual({ outcome: "invalid_request" }); expect(h.calls).toEqual([]);
  });

  it.each([
    [{ ok: false, error: { code: "INVALID_ECF31_DELIVERY_PREPARATION_INPUT" } }, "invalid_request"], [{ ok: false, error: { code: "ECF31_DELIVERY_PREPARATION_FAILED" } }, "preparation_failed"], ["throw", "preparation_failed"], [{ ok: true, value: { artifact: {}, signedXmlSha256: "a".repeat(64) } }, "preparation_failed"],
  ])("contains invalid local preparation %o", async (local, outcome) => {
    const h = await harness({ local }); expect(await h.coordinator.coordinate(h.input)).toEqual({ outcome }); expect(h.calls).toEqual(["local"]);
  });

  it.each([
    [{ outcome: "transaction_unavailable" }, "persistence_unavailable"], [{ outcome: "rolled_back" }, "persistence_unavailable"], ["throw", "persistence_unavailable"],
  ])("contains unconfirmed transactions %o", async (transaction, outcome) => {
    const h = await harness({ transaction }); expect(await h.coordinator.coordinate(h.input)).toEqual({ outcome }); expect(h.calls).toEqual(["local", "run"]);
  });

  it.each(["\n", "x".repeat(129)])("rejects hostile control and over-bound keys", async (allocationKey) => {
    const h = await harness(); expect(await h.coordinator.coordinate({ ...h.input, allocationKey })).toEqual({ outcome: "invalid_request" });
  });

  it("contains forged evidence and thrown reception after POST_STARTED", async () => {
    const h = await harness({ submit: "throw" }); expect(await h.coordinator.coordinate({ ...h.input, evidence: Object.freeze({}) })).toEqual({ outcome: "preparation_failed" });
    expect(await h.coordinator.coordinate(h.input)).toEqual({ outcome: "outcome_unknown" }); expect(h.calls).toContain("OUTCOME_UNKNOWN");
  });

  it("rejects accessor methods and input without invoking ports", async () => {
    const h = await harness(); const accessor = { ...h.input }; Object.defineProperty(accessor, "evidence", { enumerable: true, get() { throw new Error("trap"); } });
    expect(await h.coordinator.coordinate(accessor)).toEqual({ outcome: "invalid_request" });
    expect(createEcf31DeliveryCoordinator({ preparation: { prepare: new Proxy(() => undefined, {}) }, transactions: { run: async () => undefined }, reception: { submit: async () => undefined } })).toMatchObject({ ok: false });
  });

  it("contains malformed runner persistence and acknowledgement-event failure", async () => {
    const h = await harness(); const prepared = await verifiedArtifact();
    const malformed = value(createEcf31DeliveryCoordinator({ preparation: { prepare: async () => ({ ok: true as const, value: { artifact: prepared, signedXmlSha256: "a".repeat(64) } }) }, transactions: { run: async (work: (port: unknown) => Promise<unknown>) => ({ outcome: "committed", value: await work({}) }) }, reception: { submit: async () => ({ ok: true as const, value: { trackId: "track" } }) } }));
    expect(await malformed.coordinate({ ...h.input, environment: "CerteCF" })).toEqual({ outcome: "persistence_unavailable" });
    let events = 0; const rollback = value(createEcf31DeliveryCoordinator({ preparation: { prepare: async () => ({ ok: true as const, value: { artifact: prepared, signedXmlSha256: "a".repeat(64) } }) }, transactions: { run: async (work: (port: unknown) => Promise<unknown>) => { try { return { outcome: "committed", value: await work({ prepareAttempt: async () => ({ outcome: "prepared", attemptNo: 1 }), appendEvent: async () => (++events === 2 ? { outcome: "conflict" } : { outcome: "appended", eventId: 1n, stateApplied: true, anomaly: false }), acknowledgeAttempt: async () => ({ outcome: "recorded", attemptNo: 1, acknowledgedAt: "2026-12-01T12:00:00Z" }), recordAcknowledgedAttempt: async () => ({ outcome: "recorded", attemptNo: 1, acknowledgedAt: "2026-12-01T12:00:00Z" }) }) }; } catch { return { outcome: "rolled_back" }; } } }, reception: { submit: async () => ({ ok: true as const, value: { trackId: "track" } }) } }));
    expect(await rollback.coordinate(h.input)).toEqual({ outcome: "outcome_unknown", trackId: "track" });
  });

  it("accepts production controls and genuine evidence without optional price evidence", async () => {
    const h = await harness(); const { priceInclusionEvidence, ...withoutPrice } = h.input.evidence as Record<string, unknown>;
    expect(await h.coordinator.coordinate({ ...h.input, environment: "production", evidence: Object.freeze(withoutPrice) })).toEqual({ outcome: "acknowledged", trackId: "track-1" });
  });
});
