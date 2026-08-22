/* eslint-disable @typescript-eslint/require-await */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPostgresDeliveryTransactionRunner } from "../../delivery-persistence/index.js";
import { createDgiiResultPollingScheduler } from "../../dgii-result-consultation/index.js";
import { createEcf31DeliveryResultReconciler } from "./reconcile-ecf31-delivery-result.js";
import type { Result } from "../../../shared/domain/result.js";

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] ?? "postgres://sequence_test@localhost:55432/sequence_test" });
const migrations = ["0001_atomic_sequence_allocation.sql", "0002_ecf31_draft_evidence_snapshots.sql", "0003_ecf31_draft_evidence_envelope_v2.sql", "0004_ecf31_delivery_evidence.sql", "0005_ecf31_delivery_intent_safety.sql"];
const classifications = ["indeterminate", "accepted", "rejected", "in-process", "accepted-conditional"] as const;
const receivedAt = 1_700_000_000_000;
const attempt = { allocationKey: "allocation", attemptKey: "attempt" } as const;
const snapshot = { schema: "ecf31-draft-evidence-v1", header: { schema: "ecf31-core-header", version: 1, eNcf: "E310000000001", issuer: { taxpayerIdentifier: "101010101", legalName: "Synthetic issuer", address: "Synthetic address" }, buyer: { taxpayerIdentifier: "00000000000", legalName: "Synthetic buyer" }, issueDate: "01-01-2030", incomeType: "01", paymentType: "1" }, lineAdjustments: [{ schema: "ecf31-line-adjustment", version: 1, coreLine: { schema: "ecf31-core-line", version: 1, sequence: "1", quantity: "1", unitPrice: "1", computedAmount: "1", declaredAmount: "1", delta: "0", itemName: "Synthetic item", billingIndicator: 0, goodOrServiceIndicator: 1 }, discountAmount: "0", surchargeAmount: "0", adjustedAmount: "1", adjustedDelta: "0", quantizedAmount: "1", policyId: "ecf31-monto-item-half-up-v1" }], headerTotals: { schema: "ecf31-header-totals", version: 1, montoGravadoTotal: "1", totalItbis: "0", montoTotal: "1" } };

function value<T>(result: Result<T, unknown>): T { if (!result.ok) throw new Error("Expected fixture value."); return result.value; }
function consulted(codigo: 0 | 1 | 2 | 3 | 4, trackId: string, secuenciaUtilizada: boolean | null): unknown {
  const terminalPayload = codigo === 0 || codigo === 3 ? { rnc: null, eNCF: null, fechaRecepcion: null, mensajes: Object.freeze([]), secuenciaUtilizada: null, sequenceDisposition: null } : { rnc: "101010101", eNCF: "E310000000001", fechaRecepcion: "2030-06-15", mensajes: Object.freeze(["Synthetic observation"]), secuenciaUtilizada, sequenceDisposition: secuenciaUtilizada === null ? null : secuenciaUtilizada ? "consumed-non-reusable" : "potentially-reusable-no-blind-resend" };
  return Object.freeze({ ok: true, value: Object.freeze({ trackId, codigo, classification: classifications[codigo], estado: `Estado ${String(codigo)}`, ...terminalPayload }) });
}
function scheduler(responses: readonly unknown[], advances: readonly number[]) {
  let now = receivedAt; let consultations = 0; let sleeps = 0;
  return value(createDgiiResultPollingScheduler({ clock: () => now, random: () => 0.5, sleeper: async (delay: number) => { now += Math.max(delay, advances[Math.min(sleeps++, advances.length - 1)] as number); }, consultation: { consult: async () => responses[Math.min(consultations++, responses.length - 1)] } }));
}
async function reconcilerFor(scopeId: string, responses: readonly unknown[], advances: readonly number[]) {
  await pool.query("INSERT INTO sequence_counters(scope_id, ecf_type, range_start, range_end, next_value, valid_from, valid_to) VALUES ($1, 'E31', 1, 99, 1, '2030-01-01', '2030-12-31')", [scopeId]);
  await pool.query("SELECT * FROM allocate_fiscal_sequence($1, 'E31', 'allocation', 'fingerprint', '2030-06-15')", [scopeId]);
  await pool.query("SELECT * FROM store_ecf31_draft_evidence($1, 'E310000000001', 'allocation', 'fingerprint', $2::jsonb)", [scopeId, JSON.stringify(snapshot)]);
  const transactions = createPostgresDeliveryTransactionRunner({ connectionSource: { connect: () => pool.connect() }, scopeId });
  await expect(transactions.run(async (persistence) => persistence.prepareAttempt({ ...attempt, environment: "TesteCF", signedXmlSha256: "a".repeat(64), eNcf: "E310000000001", issuerRnc: "101010101" }))).resolves.toMatchObject({ value: { outcome: "prepared" } });
  await expect(transactions.run(async (persistence) => persistence.appendEvent({ ...attempt, eventKey: "post-started-v1", kind: "POST_STARTED" }))).resolves.toMatchObject({ value: { outcome: "appended", stateApplied: true } });
  await expect(transactions.run(async (persistence) => persistence.acknowledgeAttempt({ ...attempt, environment: "TesteCF", trackId: scopeId }))).resolves.toMatchObject({ value: { outcome: "recorded" } });
  await expect(transactions.run(async (persistence) => persistence.appendEvent({ ...attempt, eventKey: "reception-acknowledged-v1", kind: "RECEPTION_ACKNOWLEDGED" }))).resolves.toMatchObject({ value: { outcome: "appended", stateApplied: true } });
  await expect(current(scopeId)).resolves.toMatchObject({ delivery_state: "ACKNOWLEDGED", polling_state: "ACTIVE" });
  return value(createEcf31DeliveryResultReconciler({ polling: scheduler(responses, advances), transactions }));
}
async function current(scopeId: string): Promise<unknown> { return (await pool.query("SELECT delivery_state, polling_state, disposition, auto_resend_blocked, anomaly FROM ecf31_delivery_current WHERE scope_id = $1", [scopeId])).rows[0]; }
async function reconciliationEvents(scopeId: string): Promise<unknown[]> { return (await pool.query("SELECT event_key, event_kind, codigo, secuencia_utilizada, disposition, state_applied, anomaly FROM ecf31_delivery_events WHERE scope_id = $1 AND event_kind NOT IN ('POST_STARTED', 'RECEPTION_ACKNOWLEDGED') ORDER BY event_id", [scopeId])).rows as unknown[]; }

beforeEach(async () => {
  for (const name of migrations) await pool.query(readFileSync(resolve("db/migrations", name), "utf8"));
  await pool.query("TRUNCATE ecf31_delivery_current, ecf31_delivery_events, ecf31_delivery_acknowledgements, ecf31_delivery_attempts, ecf31_draft_evidence_snapshots, sequence_allocation_requests, sequence_counters");
});
afterAll(async () => { await pool.end(); });

describe("e-CF 31 delivery result reconciliation against PostgreSQL", () => {
  it.each([
    ["synthetic-accepted", 1 as const, null, "ACCEPTED", null],
    ["synthetic-rejected", 2 as const, true, "REJECTED", "CONSUMED_NON_REUSABLE"],
    ["synthetic-rejected-reusable", 2 as const, false, "REJECTED", "POTENTIALLY_REUSABLE_NO_BLIND_RESEND"],
    ["synthetic-conditional", 4 as const, null, "ACCEPTED_CONDITIONAL", null],
  ])("drives %s to its terminal delivery state and records the disposition", async (scopeId, codigo, secuenciaUtilizada, deliveryState, disposition) => {
    const reconciler = await reconcilerFor(scopeId, [consulted(codigo, scopeId, secuenciaUtilizada)], [1_000]);
    expect(await reconciler.reconcile({ ...attempt, trackId: scopeId, receivedAt })).toEqual({ outcome: "reconciled", trackId: scopeId, codigo, sequenceDisposition: secuenciaUtilizada === null ? null : secuenciaUtilizada ? "consumed-non-reusable" : "potentially-reusable-no-blind-resend", replayed: false });
    await expect(current(scopeId)).resolves.toEqual({ delivery_state: deliveryState, polling_state: "COMPLETED", disposition, auto_resend_blocked: true, anomaly: false });
    await expect(reconciliationEvents(scopeId)).resolves.toEqual([{ event_key: `result-observed-v1-codigo-${String(codigo)}`, event_kind: "RESULT_OBSERVED", codigo, secuencia_utilizada: secuenciaUtilizada, disposition, state_applied: true, anomaly: false }]);
  });

  it("replays an identical reconciliation instead of duplicating the observed result", async () => {
    const scopeId = "synthetic-replay";
    const reconciler = await reconcilerFor(scopeId, [consulted(1, scopeId, null)], [1_000]);
    const request = { ...attempt, trackId: scopeId, receivedAt };
    expect(await reconciler.reconcile(request)).toMatchObject({ outcome: "reconciled", replayed: false });
    expect(await reconciler.reconcile(request)).toMatchObject({ outcome: "reconciled", replayed: true, codigo: 1 });
    await expect(reconciliationEvents(scopeId)).resolves.toHaveLength(1);
    await expect(current(scopeId)).resolves.toMatchObject({ delivery_state: "ACCEPTED", anomaly: false });
  });

  it("records a contradicting later result as a non-applied anomaly and keeps the terminal state", async () => {
    const scopeId = "synthetic-superseded";
    const reconciler = await reconcilerFor(scopeId, [consulted(1, scopeId, null), consulted(2, scopeId, true)], [1_000]);
    expect(await reconciler.reconcile({ ...attempt, trackId: scopeId, receivedAt })).toMatchObject({ outcome: "reconciled", codigo: 1 });
    expect(await reconciler.reconcile({ ...attempt, trackId: scopeId, receivedAt })).toEqual({ outcome: "superseded", trackId: scopeId, replayed: false });
    await expect(current(scopeId)).resolves.toMatchObject({ delivery_state: "ACCEPTED", anomaly: true });
    await expect(reconciliationEvents(scopeId)).resolves.toMatchObject([{ state_applied: true }, { event_key: "result-observed-v1-codigo-2", state_applied: false, anomaly: true }]);
  });

  it("discards the pending last evidence and leaves the attempt reconcilable after the deadline", async () => {
    const scopeId = "synthetic-deadline";
    const reconciler = await reconcilerFor(scopeId, [consulted(3, scopeId, null)], [1_000, 200_000]);
    expect(await reconciler.reconcile({ ...attempt, trackId: scopeId, receivedAt })).toEqual({ outcome: "reconcilable", trackId: scopeId, reason: "deadline_expired", replayed: false });
    await expect(current(scopeId)).resolves.toEqual({ delivery_state: "PENDING_RECONCILIATION", polling_state: "DEADLINE_EXPIRED", disposition: null, auto_resend_blocked: true, anomaly: false });
    await expect(reconciliationEvents(scopeId)).resolves.toEqual([{ event_key: "polling-deadline-expired-v1", event_kind: "POLLING_DEADLINE_EXPIRED", codigo: null, secuencia_utilizada: null, disposition: null, state_applied: true, anomaly: false }]);
  });

  it("lands cancellation and scheduler failure on their own events without a terminal state", async () => {
    const cancelled = await reconcilerFor("synthetic-cancelled", [consulted(1, "synthetic-cancelled", null)], [1_000]);
    const controller = new AbortController(); controller.abort();
    expect(await cancelled.reconcile({ ...attempt, trackId: "synthetic-cancelled", receivedAt, signal: controller.signal })).toEqual({ outcome: "reconcilable", trackId: "synthetic-cancelled", reason: "cancelled", replayed: false });
    await expect(current("synthetic-cancelled")).resolves.toMatchObject({ delivery_state: "ACKNOWLEDGED", polling_state: "CANCELLED" });
    await expect(reconciliationEvents("synthetic-cancelled")).resolves.toMatchObject([{ event_key: "polling-cancelled-v1", event_kind: "POLLING_CANCELLED", state_applied: true }]);

    const failed = await reconcilerFor("synthetic-error", [Object.freeze({ ok: false, error: Object.freeze({ code: "DGII_RESULT_CONSULTATION_FAILED" }) })], [1_000]);
    expect(await failed.reconcile({ ...attempt, trackId: "synthetic-error", receivedAt })).toEqual({ outcome: "reconcilable", trackId: "synthetic-error", reason: "scheduler_error", replayed: false });
    await expect(current("synthetic-error")).resolves.toMatchObject({ delivery_state: "ACKNOWLEDGED", polling_state: "ERROR" });
    await expect(reconciliationEvents("synthetic-error")).resolves.toMatchObject([{ event_key: "polling-error-v1", event_kind: "POLLING_ERROR", state_applied: true }]);
  });

  it("refuses an unknown attempt without writing anything", async () => {
    const scopeId = "synthetic-missing";
    const reconciler = await reconcilerFor(scopeId, [consulted(1, scopeId, null)], [1_000]);
    expect(await reconciler.reconcile({ allocationKey: "allocation", attemptKey: "absent", trackId: scopeId, receivedAt })).toEqual({ outcome: "attempt_not_found" });
    await expect(reconciliationEvents(scopeId)).resolves.toEqual([]);
  });
});
