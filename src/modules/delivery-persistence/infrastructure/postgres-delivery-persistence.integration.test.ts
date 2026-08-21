import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPostgresDeliveryPersistence } from "./postgres-delivery-persistence.js";

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] ?? "postgres://sequence_test@localhost:55432/sequence_test" });
const migrations = ["0001_atomic_sequence_allocation.sql", "0002_ecf31_draft_evidence_snapshots.sql", "0003_ecf31_draft_evidence_envelope_v2.sql", "0004_ecf31_delivery_evidence.sql", "0005_ecf31_delivery_intent_safety.sql"];

beforeEach(async () => {
  for (const name of migrations) await pool.query(readFileSync(resolve("db/migrations", name), "utf8"));
  for (const name of migrations) await pool.query(readFileSync(resolve("db/migrations", name), "utf8"));
  await pool.query("TRUNCATE ecf31_delivery_current, ecf31_delivery_events, ecf31_delivery_acknowledgements, ecf31_delivery_attempts, ecf31_draft_evidence_snapshots, sequence_allocation_requests, sequence_counters");
});
afterAll(async () => { await pool.end(); });

async function preparedAdapter(scopeId: string, client: Pick<Pool, "query"> = pool) {
  await pool.query("INSERT INTO sequence_counters(scope_id, ecf_type, range_start, range_end, next_value, valid_from, valid_to) VALUES ($1, 'E31', 1, 99, 1, '2030-01-01', '2030-12-31')", [scopeId]);
  await pool.query("SELECT * FROM allocate_fiscal_sequence($1, 'E31', 'allocation', 'fingerprint', '2030-06-15')", [scopeId]);
  const snapshot = { schema: "ecf31-draft-evidence-v1", header: { schema: "ecf31-core-header", version: 1, eNcf: "E310000000001", issuer: { taxpayerIdentifier: "101010101", legalName: "Synthetic issuer", address: "Synthetic address" }, buyer: { taxpayerIdentifier: "00000000000", legalName: "Synthetic buyer" }, issueDate: "01-01-2030", incomeType: "01", paymentType: "1" }, lineAdjustments: [{ schema: "ecf31-line-adjustment", version: 1, coreLine: { schema: "ecf31-core-line", version: 1, sequence: "1", quantity: "1", unitPrice: "1", computedAmount: "1", declaredAmount: "1", delta: "0", itemName: "Synthetic item", billingIndicator: 0, goodOrServiceIndicator: 1 }, discountAmount: "0", surchargeAmount: "0", adjustedAmount: "1", adjustedDelta: "0", quantizedAmount: "1", policyId: "ecf31-monto-item-half-up-v1" }], headerTotals: { schema: "ecf31-header-totals", version: 1, montoGravadoTotal: "1", totalItbis: "0", montoTotal: "1" } };
  await pool.query("SELECT * FROM store_ecf31_draft_evidence($1, 'E310000000001', 'allocation', 'fingerprint', $2::jsonb)", [scopeId, JSON.stringify(snapshot)]);
  return createPostgresDeliveryPersistence({ client: { query: client.query.bind(client) }, scopeId });
}

describe("PostgreSQL delivery persistence adapter", () => {
  it("uses the caller transaction, adds no grants, and rolls back its exact recorder calls", async () => {
    const scopeId = "synthetic-adapter-scope";
    await pool.query("INSERT INTO sequence_counters(scope_id, ecf_type, range_start, range_end, next_value, valid_from, valid_to) VALUES ($1, 'E31', 1, 99, 1, '2030-01-01', '2030-12-31')", [scopeId]);
    await pool.query("SELECT * FROM allocate_fiscal_sequence($1, 'E31', 'allocation', 'fingerprint', '2030-06-15')", [scopeId]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const persistence = createPostgresDeliveryPersistence({ client: { query: client.query.bind(client) }, scopeId });
      await expect(persistence.recordAcknowledgedAttempt({ allocationKey: "allocation", attemptKey: "adapter", environment: "TesteCF", signedXmlSha256: "a".repeat(64), trackId: "adapter-track" })).resolves.toMatchObject({ outcome: "recorded", attemptNo: 1 });
      await expect(persistence.appendEvent({ allocationKey: "allocation", attemptKey: "adapter", eventKey: "ack", kind: "RECEPTION_ACKNOWLEDGED" })).resolves.toMatchObject({ outcome: "appended", stateApplied: true, anomaly: false });
      await client.query("ROLLBACK");
    } finally { client.release(); }
    await expect(pool.query("SELECT count(*)::text AS count FROM ecf31_delivery_attempts WHERE scope_id = $1", [scopeId])).resolves.toMatchObject({ rows: [{ count: "0" }] });
    await expect(pool.query("SELECT has_function_privilege('public', 'record_ecf31_delivery_attempt(text, text, text, text, text, text, text)', 'EXECUTE') AS attempt_allowed, has_function_privilege('public', 'append_ecf31_delivery_event(text, text, text, text, text, text, smallint, text, text, text, text, jsonb, boolean)', 'EXECUTE') AS event_allowed")).resolves.toMatchObject({ rows: [{ attempt_allowed: false, event_allowed: false }] });
  });

  it("denies an ordinary role both exact recorder signatures without leaking diagnostics", async () => {
    const role = "delivery_recorder_ordinary";
    const diagnostic = "synthetic-secret-diagnostic";
    await pool.query(`CREATE ROLE ${role}`);
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${role}`);
      for (const statement of [
        `SELECT * FROM record_ecf31_delivery_attempt('scope', 'E31', '${diagnostic}', 'attempt', 'testecf', repeat('a', 64), 'track')`,
        `SELECT * FROM prepare_ecf31_delivery_attempt('scope', 'E31', '${diagnostic}', 'attempt', 'testecf', repeat('a', 64), 'E310000000001', '101010101')`,
        `SELECT * FROM acknowledge_ecf31_delivery_attempt('scope', 'E31', '${diagnostic}', 'attempt', 'testecf', 'track')`,
        `SELECT * FROM append_ecf31_delivery_event('scope', 'E31', '${diagnostic}', 'attempt', 'event', 'RECEPTION_ACKNOWLEDGED', NULL, NULL, NULL, NULL, NULL, '[]'::jsonb, NULL)`,
      ]) {
        await client.query(statement).then(() => { throw new Error("expected permission denial"); }, (error: unknown) => {
          expect(error).toMatchObject({ code: "42501" });
          expect(error instanceof Error ? error.message : "").not.toContain(diagnostic);
        });
      }
    } finally {
      await client.query("RESET ROLE");
      client.release();
      await pool.query(`DROP ROLE IF EXISTS ${role}`);
    }
  });

  it("persists the prepared delivery lifecycle, replays exact identities, and preserves caller rollback", async () => {
    const scopeId = "synthetic-intent-adapter";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const persistence = await preparedAdapter(scopeId, client);
      const prepared = { allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF" as const, signedXmlSha256: "a".repeat(64), eNcf: "E310000000001", issuerRnc: "101010101" };
      await expect(persistence.prepareAttempt(prepared)).resolves.toEqual({ outcome: "prepared", attemptNo: 1 });
      await expect(persistence.prepareAttempt(prepared)).resolves.toEqual({ outcome: "replayed", attemptNo: 1 });
      await expect(persistence.prepareAttempt({ ...prepared, issuerRnc: "202020202" })).resolves.toEqual({ outcome: "conflict" });
      await expect(persistence.appendEvent({ allocationKey: "allocation", attemptKey: "attempt", eventKey: "post", kind: "POST_STARTED" })).resolves.toMatchObject({ outcome: "appended", stateApplied: true });
      await expect(persistence.appendEvent({ allocationKey: "allocation", attemptKey: "attempt", eventKey: "unknown", kind: "OUTCOME_UNKNOWN" })).resolves.toMatchObject({ outcome: "appended", stateApplied: true });
      const acknowledged = { allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF" as const, trackId: "synthetic-track" };
      const first = await persistence.acknowledgeAttempt(acknowledged); const replay = await persistence.acknowledgeAttempt(acknowledged);
      expect(first).toMatchObject({ outcome: "recorded", attemptNo: 1 }); expect(replay).toEqual({ ...first, outcome: "replayed" });
      await client.query("ROLLBACK");
    } finally { client.release(); }
    await expect(pool.query("SELECT count(*)::text AS count FROM ecf31_delivery_attempts WHERE scope_id = $1", [scopeId])).resolves.toMatchObject({ rows: [{ count: "0" }] });
  });

  it("returns invalid_transition without mutation and denies the new functions to ordinary roles", async () => {
    const scopeId = "synthetic-intent-transition"; const persistence = await preparedAdapter(scopeId);
    await expect(persistence.prepareAttempt({ allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF", signedXmlSha256: "a".repeat(64), eNcf: "E310000000001", issuerRnc: "101010101" })).resolves.toMatchObject({ outcome: "prepared" });
    await expect(persistence.appendEvent({ allocationKey: "allocation", attemptKey: "attempt", eventKey: "unknown", kind: "OUTCOME_UNKNOWN" })).resolves.toEqual({ outcome: "invalid_transition" });
    await expect(pool.query("SELECT count(*)::text AS count FROM ecf31_delivery_events WHERE scope_id = $1", [scopeId])).resolves.toMatchObject({ rows: [{ count: "0" }] });
    await expect(pool.query("SELECT has_function_privilege('public', 'prepare_ecf31_delivery_attempt(text, text, text, text, text, text, text, text)', 'EXECUTE') AS prepare_allowed, has_function_privilege('public', 'acknowledge_ecf31_delivery_attempt(text, text, text, text, text, text)', 'EXECUTE') AS acknowledge_allowed")).resolves.toMatchObject({ rows: [{ prepare_allowed: false, acknowledge_allowed: false }] });
  });
});
