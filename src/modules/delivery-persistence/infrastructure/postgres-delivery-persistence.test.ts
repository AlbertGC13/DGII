import { describe, expect, it, vi } from "vitest";

import { createPostgresDeliveryPersistence } from "./postgres-delivery-persistence.js";

const attempt = () => ({ allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF" as const, signedXmlSha256: "a".repeat(64), trackId: "track" });
const evidence = () => ({ trackId: "track", codigo: 2 as const, estado: "rejected", rnc: "101010101", eNCF: "E310000000001", fechaRecepcion: "2030-01-01", mensajes: Object.freeze(["synthetic message"]), secuenciaUtilizada: true as const, sequenceDisposition: "consumed-non-reusable" as const });
const event = () => ({ allocationKey: "allocation", attemptKey: "attempt", eventKey: "result", kind: "RESULT_OBSERVED" as const, evidence: evidence() });
const configured = (query = vi.fn()) => createPostgresDeliveryPersistence({ client: { query }, scopeId: "synthetic-scope" });

describe("PostgreSQL E31 delivery persistence", () => {
  it("binds scope once and calls both migration functions with their exact parameter order", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ outcome: "recorded", attempt_no: 1, acknowledged_at: "2030-01-01T00:00:00Z" }] })
      .mockResolvedValueOnce({ rows: [{ outcome: "appended", event_id: "9", state_applied: true, anomaly: false }] });
    const persistence = configured(query);

    await expect(persistence.recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "recorded", attemptNo: 1, acknowledgedAt: "2030-01-01T00:00:00Z" });
    await expect(persistence.appendEvent(event())).resolves.toEqual({ outcome: "appended", eventId: 9n, stateApplied: true, anomaly: false });
    expect(query).toHaveBeenNthCalledWith(1, "SELECT outcome, attempt_no, acknowledged_at::text AS acknowledged_at FROM record_ecf31_delivery_attempt($1, $2, $3, $4, $5, $6, $7)", ["synthetic-scope", "E31", "allocation", "attempt", "testecf", "a".repeat(64), "track"]);
    expect(query).toHaveBeenNthCalledWith(2, "SELECT outcome, event_id::text AS event_id, state_applied, anomaly FROM append_ecf31_delivery_event($1, $2, $3, $4, $5, $6, $7::smallint, $8, $9, $10, $11, $12::jsonb, $13)", ["synthetic-scope", "E31", "allocation", "attempt", "result", "RESULT_OBSERVED", 2, "rejected", "101010101", "E310000000001", "2030-01-01", "[\"synthetic message\"]", true]);
  });

  it("prepares and acknowledges attempts through their exact migration signatures", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ outcome: "prepared", attempt_no: 1 }] })
      .mockResolvedValueOnce({ rows: [{ outcome: "recorded", attempt_no: 1, acknowledged_at: "2030-01-01T00:00:00Z" }] });
    const persistence = configured(query);
    const prepared = { allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF" as const, signedXmlSha256: "a".repeat(64), eNcf: "E310000000001", issuerRnc: "101010101" };
    await expect(persistence.prepareAttempt(prepared)).resolves.toEqual({ outcome: "prepared", attemptNo: 1 });
    await expect(persistence.acknowledgeAttempt({ allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF", trackId: "track" })).resolves.toEqual({ outcome: "recorded", attemptNo: 1, acknowledgedAt: "2030-01-01T00:00:00Z" });
    expect(query).toHaveBeenNthCalledWith(1, "SELECT outcome, attempt_no FROM prepare_ecf31_delivery_attempt($1, $2, $3, $4, $5, $6, $7, $8)", ["synthetic-scope", "E31", "allocation", "attempt", "testecf", "a".repeat(64), "E310000000001", "101010101"]);
    expect(query).toHaveBeenNthCalledWith(2, "SELECT outcome, attempt_no, acknowledged_at::text AS acknowledged_at FROM acknowledge_ecf31_delivery_attempt($1, $2, $3, $4, $5, $6)", ["synthetic-scope", "E31", "allocation", "attempt", "testecf", "track"]);
  });

  it("contains new-operation hostile inputs and invalid database rows without a query or diagnostics", async () => {
    const query = vi.fn(); const persistence = configured(query);
    for (const input of [null, { allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF", signedXmlSha256: "a".repeat(64), eNcf: "E31000000001", issuerRnc: "101010101" }, new Proxy({}, { ownKeys: () => { throw new Error("synthetic trap"); } })]) await expect(persistence.prepareAttempt(input)).resolves.toEqual({ outcome: "invalid_attempt" });
    for (const input of [null, { allocationKey: "allocation", attemptKey: "attempt", environment: "Other", trackId: "track" }, new Proxy({}, { getPrototypeOf: () => { throw new Error("synthetic trap"); } })]) await expect(persistence.acknowledgeAttempt(input)).resolves.toEqual({ outcome: "invalid_attempt" });
    expect(query).not.toHaveBeenCalled();
    for (const outcome of ["replayed", "conflict", "missing_allocation", "missing_snapshot", "invalid_attempt"] as const) await expect(configured(vi.fn().mockResolvedValue({ rows: [{ outcome, attempt_no: outcome === "replayed" ? 1 : null }] })).prepareAttempt({ allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF", signedXmlSha256: "a".repeat(64), eNcf: "E310000000001", issuerRnc: "101010101" })).resolves.toMatchObject({ outcome });
    for (const outcome of ["replayed", "conflict", "track_id_conflict", "missing_allocation", "invalid_attempt"] as const) await expect(configured(vi.fn().mockResolvedValue({ rows: [{ outcome, attempt_no: outcome === "replayed" ? 1 : null, acknowledged_at: outcome === "replayed" ? "2030-01-01T00:00:00Z" : null }] })).acknowledgeAttempt({ allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF", trackId: "track" })).resolves.toMatchObject({ outcome });
    await expect(configured(vi.fn().mockResolvedValue({ rows: [{ outcome: "prepared", attempt_no: 1, extra: true }] })).prepareAttempt({ allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF", signedXmlSha256: "a".repeat(64), eNcf: "E310000000001", issuerRnc: "101010101" })).resolves.toEqual({ outcome: "persistence_unavailable" });
    const valid = { allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF" as const, signedXmlSha256: "a".repeat(64), eNcf: "E310000000001", issuerRnc: "101010101" };
    for (const invalid of [{ ...valid, signedXmlSha256: "A".repeat(64) }, { ...valid, issuerRnc: "x".repeat(33) }]) await expect(persistence.prepareAttempt(invalid)).resolves.toEqual({ outcome: "invalid_attempt" });
    for (const environment of ["CerteCF", "production"] as const) await expect(configured(vi.fn().mockResolvedValue({ rows: [{ outcome: "prepared", attempt_no: 1 }] })).prepareAttempt({ ...valid, environment })).resolves.toMatchObject({ outcome: "prepared" });
    for (const environment of ["CerteCF", "production"] as const) await expect(configured(vi.fn().mockResolvedValue({ rows: [{ outcome: "recorded", attempt_no: 1, acknowledged_at: "2030-01-01T00:00:00Z" }] })).acknowledgeAttempt({ allocationKey: "allocation", attemptKey: "attempt", environment, trackId: "track" })).resolves.toMatchObject({ outcome: "recorded" });
    await expect(configured(vi.fn().mockResolvedValue({ rows: [{ outcome: "prepared", attempt_no: null }] })).prepareAttempt(valid)).resolves.toEqual({ outcome: "persistence_unavailable" });
    await expect(configured(vi.fn().mockRejectedValue(new Error("synthetic driver failure"))).prepareAttempt(valid)).resolves.toEqual({ outcome: "persistence_unavailable" });
    for (const response of [{ rows: [] }, { rows: [{ outcome: "recorded", attempt_no: null, acknowledged_at: null }] }, new Error("synthetic driver failure")]) await expect(configured(vi.fn().mockImplementation(() => response instanceof Error ? Promise.reject(response) : Promise.resolve(response))).acknowledgeAttempt({ allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF", trackId: "track" })).resolves.toEqual({ outcome: "persistence_unavailable" });
    await expect(createPostgresDeliveryPersistence({}).prepareAttempt(valid)).resolves.toEqual({ outcome: "persistence_unavailable" });
    await expect(createPostgresDeliveryPersistence({}).acknowledgeAttempt({ allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF", trackId: "track" })).resolves.toEqual({ outcome: "persistence_unavailable" });
  });

  it("maps every safe database outcome and strictly validates returned fields", async () => {
    for (const outcome of ["replayed", "conflict", "track_id_conflict", "missing_allocation", "invalid_attempt"] as const) {
      const row = outcome === "replayed" ? { outcome, attempt_no: 1, acknowledged_at: "2030-01-01T00:00:00+00:00" } : { outcome, attempt_no: null, acknowledged_at: null };
      await expect(configured(vi.fn().mockResolvedValue({ rows: [row] })).recordAcknowledgedAttempt(attempt())).resolves.toMatchObject({ outcome });
    }
    for (const outcome of ["replayed", "conflict", "missing_attempt", "invalid_event", "invalid_transition"] as const) {
      const row = outcome === "replayed" ? { outcome, event_id: "1", state_applied: false, anomaly: true } : { outcome, event_id: null, state_applied: null, anomaly: null };
      await expect(configured(vi.fn().mockResolvedValue({ rows: [row] })).appendEvent(event())).resolves.toMatchObject({ outcome });
    }
    for (const response of [{ rows: [] }, { rows: [{ outcome: "recorded", attempt_no: 0, acknowledged_at: "2030-01-01T00:00:00Z" }] }, { rows: [{ outcome: "appended", event_id: "0", state_applied: true, anomaly: false }] }, { rows: [{ outcome: "recorded", attempt_no: 1, acknowledged_at: "not-a-time" }, { outcome: "recorded", attempt_no: 1, acknowledged_at: "2030-01-01T00:00:00Z" }] }]) {
      await expect(configured(vi.fn().mockResolvedValue(response)).recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "persistence_unavailable" });
    }
  });

  it("accepts only canonical event ids within the PostgreSQL bigint domain", async () => {
    const maximum = "9223372036854775807";
    await expect(configured(vi.fn().mockResolvedValue({ rows: [{ outcome: "appended", event_id: maximum, state_applied: true, anomaly: false }] })).appendEvent(event()))
      .resolves.toEqual({ outcome: "appended", eventId: 9223372036854775807n, stateApplied: true, anomaly: false });
    await expect(configured(vi.fn().mockResolvedValue({ rows: [{ outcome: "appended", event_id: "9223372036854775808", state_applied: true, anomaly: false }] })).appendEvent(event()))
      .resolves.toEqual({ outcome: "persistence_unavailable" });
  });

  it("rejects malformed inputs before querying and validates event-specific canonical evidence", async () => {
    const query = vi.fn(); const persistence = configured(query);
    for (const invalid of [null, {}, { ...attempt(), allocationKey: " " }, { ...attempt(), attemptKey: "x\n" }, { ...attempt(), signedXmlSha256: "A".repeat(64) }, { ...attempt(), trackId: "x".repeat(257) }]) {
      await expect(persistence.recordAcknowledgedAttempt(invalid)).resolves.toEqual({ outcome: "invalid_attempt" });
    }
    for (const invalid of [null, {}, { ...event(), eventKey: "x\u0000" }, { ...event(), evidence: { ...evidence(), codigo: 1, secuenciaUtilizada: true, sequenceDisposition: null } }, { ...event(), evidence: { ...evidence(), codigo: 0, rnc: "101010101", eNCF: null, fechaRecepcion: null, mensajes: Object.freeze([]), secuenciaUtilizada: null, sequenceDisposition: null } }]) {
      await expect(persistence.appendEvent(invalid)).resolves.toEqual({ outcome: "invalid_event" });
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("contains rejected queries and hostile accessor, proxy, and thenable shapes without diagnostics", async () => {
    const secret = "synthetic internal diagnostic";
    for (const client of [
      { query: vi.fn().mockRejectedValue(new Error(secret)) },
      { query: vi.fn().mockResolvedValue(new Proxy({}, { get: () => { throw new Error(secret); } })) },
      { query: vi.fn().mockResolvedValue({ rows: [new Proxy({}, { get: () => { throw new Error(secret); } })] }) },
      { query: vi.fn().mockResolvedValue({ rows: { then: () => undefined } }) },
    ]) {
      const result = await createPostgresDeliveryPersistence({ client, scopeId: "synthetic-scope" }).appendEvent(event());
      expect(result).toEqual({ outcome: "persistence_unavailable" });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    await expect(configured(vi.fn().mockRejectedValue(new Error(secret))).recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "persistence_unavailable" });
  });

  it("accepts the standard PostgreSQL result envelope while rejecting non-array rows", async () => {
    await expect(configured(vi.fn().mockResolvedValue(Object.assign(Object.create({}), { command: "SELECT", rowCount: 1, rows: [{ outcome: "recorded", attempt_no: 1, acknowledged_at: "2030-01-01T00:00:00Z" }] }))).recordAcknowledgedAttempt(attempt()))
      .resolves.toMatchObject({ outcome: "recorded" });
    await expect(configured(vi.fn().mockResolvedValue({ rows: { length: 1, 0: { outcome: "recorded" } } })).recordAcknowledgedAttempt(attempt()))
      .resolves.toEqual({ outcome: "persistence_unavailable" });
  });

  it("preserves PostgreSQL timestamptz text including its UTC offset spelling", async () => {
    await expect(configured(vi.fn().mockResolvedValue({ rows: [{ outcome: "recorded", attempt_no: 1, acknowledged_at: "2030-01-01 00:00:00+00" }] })).recordAcknowledgedAttempt(attempt()))
      .resolves.toEqual({ outcome: "recorded", attemptNo: 1, acknowledgedAt: "2030-01-01 00:00:00+00" });
  });

  it("maps every environment and event catalog variant", async () => {
    const environments: unknown[] = [];
    const query = vi.fn((text: string, values?: readonly unknown[]) => { if (values) environments.push(values[4]); return Promise.resolve({ rows: [text.includes("attempt") ? { outcome: "recorded", attempt_no: 1, acknowledged_at: "2030-01-01T00:00:00Z" } : { outcome: "appended", event_id: "1", state_applied: true, anomaly: false }] }); });
    const persistence = configured(query);
    for (const environment of ["TesteCF", "CerteCF", "production"] as const) await expect(persistence.recordAcknowledgedAttempt({ ...attempt(), environment, attemptKey: environment })).resolves.toMatchObject({ outcome: "recorded" });
    for (const kind of ["POST_STARTED", "OUTCOME_UNKNOWN", "RECEPTION_ACKNOWLEDGED", "POLLING_DEADLINE_EXPIRED", "POLLING_CANCELLED", "POLLING_ERROR"] as const) await expect(persistence.appendEvent({ allocationKey: "allocation", attemptKey: "attempt", eventKey: kind, kind })).resolves.toMatchObject({ outcome: "appended" });
    for (const codigo of [0, 1, 2, 3, 4] as const) {
      const canonical = codigo === 0 || codigo === 3 ? { ...evidence(), codigo, rnc: null, eNCF: null, fechaRecepcion: null, mensajes: Object.freeze([]), secuenciaUtilizada: null, sequenceDisposition: null } : codigo === 2 ? evidence() : { ...evidence(), codigo, secuenciaUtilizada: null, sequenceDisposition: null };
      await expect(persistence.appendEvent({ ...event(), eventKey: `code-${String(codigo)}`, evidence: canonical })).resolves.toMatchObject({ outcome: "appended" });
    }
    expect(environments).toContain("certecf");
    expect(environments).toContain("ecf");
  });

  it("contains proxies at every boundary and unknown safe-looking output rows", async () => {
    const proxy = new Proxy({}, { getPrototypeOf: () => { throw new Error("synthetic trap"); } });
    await expect(createPostgresDeliveryPersistence(proxy).recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "persistence_unavailable" });
    await expect(configured().recordAcknowledgedAttempt(proxy)).resolves.toEqual({ outcome: "invalid_attempt" });
    await expect(configured().appendEvent(proxy)).resolves.toEqual({ outcome: "invalid_event" });
    await expect(configured().appendEvent({ ...event(), evidence: proxy })).resolves.toEqual({ outcome: "invalid_event" });
    await expect(configured().appendEvent({ allocationKey: "allocation", attemptKey: "attempt", eventKey: "invalid", kind: "OTHER" })).resolves.toEqual({ outcome: "invalid_event" });
    await expect(configured(vi.fn().mockResolvedValue(new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("synthetic trap"); } }))).recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "persistence_unavailable" });
    await expect(configured(vi.fn().mockResolvedValue({ rows: [{ outcome: "unknown", attempt_no: null, acknowledged_at: null }] })).recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "persistence_unavailable" });
    await expect(configured(vi.fn().mockResolvedValue({ rows: [{ outcome: "recorded", attempt_no: null, acknowledged_at: null }] })).recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "persistence_unavailable" });
    await expect(configured(vi.fn().mockResolvedValue({ rows: [{ outcome: "unknown", event_id: null, state_applied: null, anomaly: null }] })).appendEvent(event())).resolves.toEqual({ outcome: "persistence_unavailable" });
  });

  it("rejects transparent and ambiguous message arrays before serialization without leaking traps", async () => {
    const secret = "synthetic message trap"; const query = vi.fn(); const persistence = configured(query);
    const indexedAccessor: string[] = [];
    Object.defineProperty(indexedAccessor, "0", { enumerable: true, get: () => { throw new Error(secret); } });
    const sparse = new Array<string>(1);
    const hidden = ["message"]; Object.defineProperty(hidden, "0", { enumerable: false, value: "message" });
    const extra = ["message"]; Object.defineProperty(extra, "extra", { enumerable: true, value: "ambiguous" });
    for (const mensajes of [new Proxy(["message"], {}), indexedAccessor, sparse, hidden, extra]) {
      const result = await persistence.appendEvent({ ...event(), evidence: { ...evidence(), mensajes } });
      expect(result).toEqual({ outcome: "invalid_event" });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("contains descriptor snapshot trap failures at every hostile boundary", async () => {
    const trap = { ownKeys: () => { throw new Error("synthetic trap"); } };
    const persistence = configured();
    await expect(createPostgresDeliveryPersistence(new Proxy({}, trap)).recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "persistence_unavailable" });
    await expect(persistence.recordAcknowledgedAttempt(new Proxy({}, trap))).resolves.toEqual({ outcome: "invalid_attempt" });
    await expect(persistence.appendEvent(new Proxy({}, trap))).resolves.toEqual({ outcome: "invalid_event" });
    await expect(persistence.appendEvent({ ...event(), evidence: new Proxy({}, trap) })).resolves.toEqual({ outcome: "invalid_event" });
    await expect(persistence.appendEvent({ ...event(), evidence: { ...evidence(), mensajes: new Proxy([], trap) } })).resolves.toEqual({ outcome: "invalid_event" });
    await expect(configured(vi.fn().mockResolvedValue(new Proxy({}, trap))).recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "persistence_unavailable" });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    await expect(persistence.recordAcknowledgedAttempt(revoked.proxy)).resolves.toEqual({ outcome: "invalid_attempt" });
  });

  it("contains absent result envelopes and invalid bound configuration", async () => {
    for (const response of [null, {}, { rows: new Proxy([], { getPrototypeOf: () => { throw new Error("synthetic trap"); } }) }]) await expect(configured(vi.fn().mockResolvedValue(response)).recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "persistence_unavailable" });
    const persistence = createPostgresDeliveryPersistence({ client: { query: vi.fn() }, scopeId: " " });
    await expect(persistence.recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "persistence_unavailable" });
    await expect(persistence.appendEvent(event())).resolves.toEqual({ outcome: "persistence_unavailable" });
    await expect(createPostgresDeliveryPersistence({ client: {}, scopeId: "scope" }).recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "persistence_unavailable" });
    await expect(createPostgresDeliveryPersistence({}).recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "persistence_unavailable" });
    await expect(createPostgresDeliveryPersistence({ client: { query: vi.fn() } }).recordAcknowledgedAttempt(attempt())).resolves.toEqual({ outcome: "persistence_unavailable" });
    await expect(configured().appendEvent({ allocationKey: "allocation", attemptKey: "attempt", eventKey: "missing-evidence", kind: "RESULT_OBSERVED" })).resolves.toEqual({ outcome: "invalid_event" });
    for (const evidenceValue of [{ ...evidence(), codigo: 2, secuenciaUtilizada: null }, { ...evidence(), codigo: 2, secuenciaUtilizada: false, sequenceDisposition: "consumed-non-reusable" }]) await expect(configured().appendEvent({ ...event(), evidence: evidenceValue })).resolves.toEqual({ outcome: "invalid_event" });
    for (const evidenceValue of [{ ...evidence(), codigo: "2" }, { ...evidence(), estado: " " }, { ...evidence(), rnc: 1 }, { ...evidence(), fechaRecepcion: 1 }, { ...evidence(), mensajes: ["ok", 1] }]) await expect(configured().appendEvent({ ...event(), evidence: evidenceValue })).resolves.toEqual({ outcome: "invalid_event" });
  });
});
