/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from "vitest";

import { createEcf31DeliveryResultReconciler } from "./reconcile-ecf31-delivery-result.js";
import type { Result } from "../../../shared/domain/result.js";

const classifications = ["indeterminate", "accepted", "rejected", "in-process", "accepted-conditional"] as const;
const ledgerEvidenceKeys = ["trackId", "codigo", "estado", "rnc", "eNCF", "fechaRecepcion", "mensajes", "secuenciaUtilizada", "sequenceDisposition"];
const request = Object.freeze({ allocationKey: "allocation", attemptKey: "attempt", trackId: "track-1", receivedAt: 1_700_000_000_000 });
const applied = Object.freeze({ outcome: "appended", eventId: 1n, stateApplied: true, anomaly: false });

function value<T>(result: Result<T, unknown>): T { if (!result.ok) throw new Error("Expected fixture value."); return result.value; }
function evidence(codigo: number, overrides: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.freeze({ trackId: "track-1", codigo, classification: classifications[codigo], estado: "Aceptado", rnc: "101010101", eNCF: "E310000000001", fechaRecepcion: "01-12-2026", mensajes: Object.freeze([]), secuenciaUtilizada: null, sequenceDisposition: null, ...overrides });
}
function terminal(codigo: number, overrides: Readonly<Record<string, unknown>>): unknown { return Object.freeze({ kind: "TERMINAL", trackId: "track-1", evidence: evidence(codigo, overrides) }); }

function harness(polled: unknown, ledger: unknown) {
  const appended: unknown[] = []; const polls: unknown[] = [];
  const persistence = { prepareAttempt: async () => undefined, appendEvent: async (event: unknown) => { appended.push(event); if (ledger === "throw") throw new Error("safe"); return ledger; }, acknowledgeAttempt: async () => undefined, recordAcknowledgedAttempt: async () => undefined };
  const polling = { poll: async (input: unknown) => { polls.push(input); if (polled === "throw") throw new Error("safe"); return polled; } };
  const transactions = { run: async (work: (port: typeof persistence) => Promise<unknown>) => { try { return { outcome: "committed", value: await work(persistence) }; } catch { return { outcome: "rolled_back" }; } } };
  return { appended, polls, reconciler: value(createEcf31DeliveryResultReconciler({ polling, transactions })) };
}

describe("e-CF 31 delivery result reconciler", () => {
  it("projects exactly the nine ledger evidence fields and never forwards classification", async () => {
    const h = harness(terminal(1, {}), applied);
    const result = await h.reconciler.reconcile(request);
    expect(result).toEqual({ outcome: "reconciled", trackId: "track-1", codigo: 1, sequenceDisposition: null, replayed: false });
    expect(Object.isFrozen(result)).toBe(true);
    expect(h.polls).toMatchObject([{ trackId: "track-1", receivedAt: 1_700_000_000_000 }]);
    expect(Reflect.ownKeys(h.appended[0] as object)).toEqual(["allocationKey", "attemptKey", "eventKey", "kind", "evidence"]);
    expect(h.appended[0]).toMatchObject({ allocationKey: "allocation", attemptKey: "attempt", eventKey: "result-observed-v1-codigo-1", kind: "RESULT_OBSERVED" });
    expect(Reflect.ownKeys((h.appended[0] as { evidence: object }).evidence)).toEqual(ledgerEvidenceKeys);
  });

  it.each([
    [2, { secuenciaUtilizada: true, sequenceDisposition: "consumed-non-reusable" }, "consumed-non-reusable"],
    [2, { secuenciaUtilizada: false, sequenceDisposition: "potentially-reusable-no-blind-resend" }, "potentially-reusable-no-blind-resend"],
    [4, {}, null],
  ])("reports the codigo %s disposition without leaking scheduler-only fields", async (codigo, overrides, sequenceDisposition) => {
    const h = harness(terminal(codigo, overrides), applied);
    expect(await h.reconciler.reconcile(request)).toEqual({ outcome: "reconciled", trackId: "track-1", codigo, sequenceDisposition, replayed: false });
    expect(Reflect.ownKeys((h.appended[0] as { evidence: object }).evidence)).toEqual(ledgerEvidenceKeys);
    expect(h.appended[0]).toMatchObject({ eventKey: `result-observed-v1-codigo-${String(codigo)}` });
  });

  it.each([
    [Object.freeze({ kind: "PENDING_RECONCILIATION", trackId: "track-1" }), "deadline_expired", "POLLING_DEADLINE_EXPIRED", "polling-deadline-expired-v1"],
    [Object.freeze({ kind: "PENDING_RECONCILIATION", trackId: "track-1", lastEvidence: evidence(3, {}) }), "deadline_expired", "POLLING_DEADLINE_EXPIRED", "polling-deadline-expired-v1"],
    [Object.freeze({ kind: "CANCELLED", trackId: "track-1" }), "cancelled", "POLLING_CANCELLED", "polling-cancelled-v1"],
    [Object.freeze({ kind: "SCHEDULER_ERROR", trackId: "track-1" }), "scheduler_error", "POLLING_ERROR", "polling-error-v1"],
  ])("keeps %o reconcilable and discards any non-terminal evidence", async (polled, reason, kind, eventKey) => {
    const h = harness(polled, applied);
    expect(await h.reconciler.reconcile(request)).toEqual({ outcome: "reconcilable", trackId: "track-1", reason, replayed: false });
    expect(h.appended).toEqual([{ allocationKey: "allocation", attemptKey: "attempt", eventKey, kind }]);
    expect(Reflect.ownKeys(h.appended[0] as object)).toEqual(["allocationKey", "attemptKey", "eventKey", "kind"]);
  });

  it("distinguishes a replay from a first append and surfaces a refused projection", async () => {
    const replay = harness(terminal(1, {}), Object.freeze({ outcome: "replayed", eventId: 7n, stateApplied: true, anomaly: false }));
    expect(await replay.reconciler.reconcile(request)).toEqual({ outcome: "reconciled", trackId: "track-1", codigo: 1, sequenceDisposition: null, replayed: true });
    const superseded = harness(terminal(2, { secuenciaUtilizada: true, sequenceDisposition: "consumed-non-reusable" }), Object.freeze({ outcome: "appended", eventId: 8n, stateApplied: false, anomaly: true }));
    expect(await superseded.reconciler.reconcile(request)).toEqual({ outcome: "superseded", trackId: "track-1", replayed: false });
    const flagged = harness(Object.freeze({ kind: "CANCELLED", trackId: "track-1" }), Object.freeze({ outcome: "replayed", eventId: 9n, stateApplied: true, anomaly: true }));
    expect(await flagged.reconciler.reconcile(request)).toEqual({ outcome: "superseded", trackId: "track-1", replayed: true });
  });

  it.each([
    [Object.freeze({ outcome: "missing_attempt" }), "attempt_not_found"],
    [Object.freeze({ outcome: "invalid_transition" }), "attempt_not_reconcilable"],
    [Object.freeze({ outcome: "conflict" }), "ledger_refused"],
    [Object.freeze({ outcome: "invalid_event" }), "ledger_refused"],
    [Object.freeze({ outcome: "persistence_unavailable" }), "persistence_unavailable"],
    [Object.freeze({ outcome: "surprise", eventId: 1n, stateApplied: true, anomaly: false }), "persistence_unavailable"],
    ["throw", "persistence_unavailable"],
  ])("maps ledger refusal %o to a closed outcome", async (ledger, outcome) => {
    const h = harness(terminal(1, {}), ledger);
    expect(await h.reconciler.reconcile(request)).toEqual({ outcome });
  });

  it.each([
    ["throw"],
    [Object.freeze({ kind: "TERMINAL", trackId: "track-1" })],
    [Object.freeze({ kind: "TERMINAL", trackId: "track-1", evidence: evidence(0, {}) })],
    [Object.freeze({ kind: "TERMINAL", trackId: "track-1", evidence: evidence(3, {}) })],
    [Object.freeze({ kind: "TERMINAL", trackId: "track-1", evidence: evidence(1, { trackId: "other" }) })],
    [Object.freeze({ kind: "TERMINAL", trackId: "track-1", evidence: evidence(1, { sequenceDisposition: "invented" }) })],
    [Object.freeze({ kind: "TERMINAL", trackId: "track-1", evidence: Object.freeze({ trackId: "track-1", codigo: 1 }) })],
    [Object.freeze({ kind: "UNKNOWN", trackId: "track-1" })],
    [Object.freeze({ kind: "CANCELLED", trackId: "other-track" })],
    [Object.freeze({ kind: "CANCELLED" })],
    [new Proxy({ kind: "CANCELLED", trackId: "track-1" }, {})],
    [null],
  ])("contains unusable polling outcome %o without touching the ledger", async (polled) => {
    const h = harness(polled, applied);
    expect(await h.reconciler.reconcile(request)).toEqual({ outcome: "polling_unusable" });
    expect(h.appended).toEqual([]);
  });

  it.each([
    [{ ...request, allocationKey: "x".repeat(129) }],
    [{ ...request, attemptKey: "\n" }],
    [{ ...request, trackId: "" }],
    [{ ...request, receivedAt: 1.5 }],
    [{ ...request, signal: "not-a-signal" }],
    [{ allocationKey: "allocation", attemptKey: "attempt", trackId: "track-1" }],
    [{ ...request, extra: 1 }],
  ])("rejects hostile request %o before polling", async (hostile) => {
    const h = harness(terminal(1, {}), applied);
    expect(await h.reconciler.reconcile(hostile)).toEqual({ outcome: "invalid_request" });
    expect(h.polls).toEqual([]);
  });

  it("forwards a caller abort signal and rejects accessor-backed requests", async () => {
    const h = harness(Object.freeze({ kind: "CANCELLED", trackId: "track-1" }), applied);
    const controller = new AbortController(); controller.abort();
    expect(await h.reconciler.reconcile({ ...request, signal: controller.signal })).toEqual({ outcome: "reconcilable", trackId: "track-1", reason: "cancelled", replayed: false });
    expect(h.polls).toMatchObject([{ signal: controller.signal }]);
    const accessor = { ...request }; Object.defineProperty(accessor, "trackId", { enumerable: true, get() { throw new Error("trap"); } });
    expect(await h.reconciler.reconcile(accessor)).toEqual({ outcome: "invalid_request" });
  });

  it("rejects malformed configuration and malformed runner persistence", async () => {
    const trap = new Proxy({}, { ownKeys() { throw new Error("trap"); } });
    for (const configuration of [trap, { polling: { poll: async () => undefined } }, { polling: trap, transactions: { run: async () => undefined } }, { polling: { poll: 1 }, transactions: { run: async () => undefined } }, { polling: { poll: new Proxy(() => undefined, {}) }, transactions: { run: async () => undefined } }]) {
      expect(createEcf31DeliveryResultReconciler(configuration)).toEqual({ ok: false, error: { code: "INVALID_ECF31_DELIVERY_RESULT_RECONCILER_CONFIGURATION" } });
    }
    const malformed = value(createEcf31DeliveryResultReconciler({ polling: { poll: async () => terminal(1, {}) }, transactions: { run: async (work: (port: unknown) => Promise<unknown>) => ({ outcome: "committed", value: await work({}) }) } }));
    expect(await malformed.reconcile(request)).toEqual({ outcome: "persistence_unavailable" });
    const thrown = value(createEcf31DeliveryResultReconciler({ polling: { poll: async () => terminal(1, {}) }, transactions: { run: async () => { throw new Error("safe"); } } }));
    expect(await thrown.reconcile(request)).toEqual({ outcome: "persistence_unavailable" });
  });
});
