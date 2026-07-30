import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import type { Result } from "../../../index.js";

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] ?? "postgres://sequence_test@localhost:55432/sequence_test" });
const migrationPaths = ["0001_atomic_sequence_allocation.sql", "0002_ecf31_draft_evidence_snapshots.sql"].map((name) => resolve("db/migrations", name));
let scope = 0;
type Allocation = Readonly<{ outcome: string; allocated_value: string | null }>;
type Queryable = Pick<Pool, "query">;
type Snapshot = Readonly<{ schema: string; header: object; lineAdjustments: readonly object[]; headerTotals: object }>;
type Stored = Readonly<{ outcome: string; created_at: string | null }>;

beforeEach(async () => { for (const migrationPath of migrationPaths) await pool.query(readFileSync(migrationPath, "utf8")); await pool.query("TRUNCATE ecf31_draft_evidence_snapshots, sequence_allocation_requests, sequence_counters"); });
afterAll(async () => { await pool.end(); });
function newScope(): string { scope += 1; return `synthetic-scope-${String(scope)}`; }
async function provision(id: string, type = "E31", start = 1, end = 99, from = "2030-01-01", to = "2030-12-31"): Promise<void> {
  await pool.query("INSERT INTO sequence_counters (scope_id, ecf_type, range_start, range_end, next_value, valid_from, valid_to) VALUES ($1, $2, $3, $4, $3, $5, $6)", [id, type, start, end, from, to]);
}
async function allocate(id: string, key: string, fingerprint: string, type = "E31", date = "2030-06-15", client: Queryable = pool): Promise<Allocation> {
  const result = await client.query<Allocation>("SELECT outcome, allocated_value FROM allocate_fiscal_sequence($1, $2, $3, $4, $5)", [id, type, key, fingerprint, date]);
  if (result.rows[0] === undefined) throw new Error("result missing");
  return result.rows[0];
}
async function state(id: string, type = "E31"): Promise<Readonly<{ next: string; requests: string }>> {
  const result = await pool.query<{ next: string; requests: string }>("SELECT c.next_value::text AS next, count(r.*)::text AS requests FROM sequence_counters c LEFT JOIN sequence_allocation_requests r USING (scope_id, ecf_type) WHERE c.scope_id = $1 AND c.ecf_type = $2 GROUP BY c.next_value", [id, type]);
  if (result.rows[0] === undefined) throw new Error("result missing");
  return result.rows[0];
}
function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}
function evidence() {
  const header = value(rootApi.createEcf31CoreHeader({
    eNcf: value(rootApi.parseENcf("E310000000001")),
    issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
    buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
    issueDate: "01-12-2026", incomeType: "01", paymentType: "1",
  }));
  const lineAmounts = ["1", "2"].map((sequence) => value(rootApi.createEcf31LineAmountEvidence({
    coreLine: value(rootApi.createEcf31CoreLine({
      evidence: value(rootApi.captureLineCalculationEvidence({
        sequence: value(rootApi.parseLineSequence(sequence)), quantity: value(rootApi.parseNonnegativeQuantity("1")),
        unitPrice: value(rootApi.parseUnitPrice("1")), declaredAmount: value(rootApi.parseNonnegativeAmount("1")),
      })), itemName: `Synthetic item ${sequence}`, billingIndicator: 0, goodOrServiceIndicator: 1,
    })), discountAmount: value(rootApi.parseNonnegativeAmount("0")), surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
  })));
  const draft = value(rootApi.createEcf31CoreDraft({ header, lineAmounts }));
  return value(rootApi.createEcf31PersistableDraftEvidence({
    draft, montoItemQuantizations: lineAmounts.map((lineAmount) => value(rootApi.createEcf31MontoItemQuantizationEvidence(lineAmount))),
    headerTotals: value(rootApi.createEcf31HeaderTotalsEvidence({})),
  }));
}
function snapshot(): Snapshot {
  return value(rootApi.serializeEcf31PersistableDraftEvidence(evidence()));
}
function changedSnapshot(): Snapshot {
  const current = snapshot();
  return { ...current, header: { ...current.header, paymentType: "changed" } };
}
async function store(id: string, key: string, fingerprint: string, eNcf: string, evidence: unknown, client: Queryable = pool): Promise<Stored> {
  const result = await client.query<Stored>("SELECT outcome, created_at::text FROM store_ecf31_draft_evidence($1, $2, $3, $4, $5::jsonb)", [id, eNcf, key, fingerprint, JSON.stringify(evidence)]);
  if (result.rows[0] === undefined) throw new Error("result missing");
  return result.rows[0];
}
async function snapshots(id: string): Promise<string> {
  const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM ecf31_draft_evidence_snapshots WHERE scope_id = $1", [id]);
  if (result.rows[0] === undefined) throw new Error("result missing");
  return result.rows[0].count;
}
async function wasStored(attempt: Promise<Stored>): Promise<boolean> {
  try { return (await attempt).outcome === "stored"; } catch { return false; }
}
describe("PostgreSQL atomic fiscal sequence allocation", () => {
  it("allocates parallel requests uniquely in range without lost increments", async () => {
    const id = newScope(); await provision(id, "E31", 100, 199);
    const results = await Promise.all(Array.from({ length: 24 }, (_, index) => allocate(id, `key-${String(index)}`, `hash-${String(index)}`)));
    expect(new Set(results.map(({ allocated_value }) => allocated_value)).size).toBe(24);
    expect(results.every(({ outcome, allocated_value }) => outcome === "allocated" && Number(allocated_value) >= 100 && Number(allocated_value) <= 199)).toBe(true);
    expect(await state(id)).toEqual({ next: "124", requests: "24" });
  });
  it("makes concurrent identical replays consume one value", async () => {
    const id = newScope(); await provision(id, "E31", 10, 20);
    const results = await Promise.all(Array.from({ length: 12 }, () => allocate(id, "same-key", "same-hash")));
    expect(new Set(results.map(({ allocated_value }) => allocated_value))).toEqual(new Set(["10"]));
    expect(results.filter(({ outcome }) => outcome === "allocated")).toHaveLength(1);
    expect(await state(id)).toEqual({ next: "11", requests: "1" });
  });
  it("rejects an idempotency fingerprint conflict without mutation", async () => {
    const id = newScope(); await provision(id, "E31", 10, 20); await allocate(id, "key", "first");
    await expect(allocate(id, "key", "second")).resolves.toEqual({ outcome: "idempotency_conflict", allocated_value: null });
    expect(await state(id)).toEqual({ next: "11", requests: "1" });
  });
  it("allows the final bounded value and then reports exhaustion without mutation", async () => {
    const id = newScope(); await provision(id, "E31", 9_999_999_999, 9_999_999_999);
    await expect(allocate(id, "last", "last")).resolves.toEqual({ outcome: "allocated", allocated_value: "9999999999" });
    await expect(allocate(id, "later", "later")).resolves.toEqual({ outcome: "exhausted", allocated_value: null });
    expect(await state(id)).toEqual({ next: "10000000000", requests: "1" });
  });
  it("rolls back both counter and idempotency record with its enclosing transaction", async () => {
    const id = newScope(); await provision(id); const client: PoolClient = await pool.connect();
    try { await client.query("BEGIN"); await allocate(id, "rollback", "rollback", "E31", "2030-06-15", client); await client.query("ROLLBACK"); } finally { client.release(); }
    expect(await state(id)).toEqual({ next: "1", requests: "0" });
  });
  it("isolates different trusted scopes and e-CF types", async () => {
    const left = newScope(); const right = newScope();
    await provision(left, "E31", 10, 20); await provision(left, "E32", 30, 40); await provision(right, "E31", 50, 60);
    await expect(Promise.all([allocate(left, "a", "a", "E31"), allocate(left, "a", "a", "E32"), allocate(right, "a", "a", "E31")])).resolves.toEqual([{ outcome: "allocated", allocated_value: "10" }, { outcome: "allocated", allocated_value: "30" }, { outcome: "allocated", allocated_value: "50" }]);
  });
  it("rejects outside provisioned validity and preserves state", async () => {
    const id = newScope(); await provision(id, "E31", 1, 5, "2030-01-01", "2030-01-31");
    await expect(allocate(id, "early", "early", "E31", "2029-12-31")).resolves.toEqual({ outcome: "outside_validity", allocated_value: null });
    expect(await state(id)).toEqual({ next: "1", requests: "0" });
  });
  it("replays a committed key after later exhaustion", async () => {
    const id = newScope(); await provision(id, "E31", 7, 7); await allocate(id, "committed", "committed"); await allocate(id, "new", "new");
    await expect(allocate(id, "committed", "committed")).resolves.toEqual({ outcome: "replayed", allocated_value: "7" });
    expect(await state(id)).toEqual({ next: "8", requests: "1" });
  });
});

describe("PostgreSQL immutable e-CF 31 evidence snapshots", () => {
  it("stores an allocation and canonical snapshot atomically, and rolls both back together", async () => {
    const committed = newScope(); await provision(committed); const committedClient = await pool.connect();
    try {
      await committedClient.query("BEGIN");
      await allocate(committed, "commit", "fingerprint", "E31", "2030-06-15", committedClient);
      await expect(store(committed, "commit", "fingerprint", "E310000000001", snapshot(), committedClient)).resolves.toMatchObject({ outcome: "stored" });
      await committedClient.query("COMMIT");
    } finally { committedClient.release(); }
    expect(await state(committed)).toEqual({ next: "2", requests: "1" }); expect(await snapshots(committed)).toBe("1");

    const rolledBack = newScope(); await provision(rolledBack); const rollbackClient = await pool.connect();
    try {
      await rollbackClient.query("BEGIN");
      await allocate(rolledBack, "rollback", "fingerprint", "E31", "2030-06-15", rollbackClient);
      await store(rolledBack, "rollback", "fingerprint", "E310000000001", snapshot(), rollbackClient);
      await rollbackClient.query("ROLLBACK");
    } finally { rollbackClient.release(); }
    expect(await state(rolledBack)).toEqual({ next: "1", requests: "0" }); expect(await snapshots(rolledBack)).toBe("0");
  });

  it("replays only identical identity and snapshot content without changing created_at", async () => {
    const id = newScope(); await provision(id); await allocate(id, "key", "fingerprint");
    const first = await store(id, "key", "fingerprint", "E310000000001", snapshot());
    await expect(store(id, "key", "fingerprint", "E310000000001", snapshot())).resolves.toEqual({ outcome: "replayed", created_at: first.created_at });
    await expect(store(id, "key", "fingerprint", "E310000000001", changedSnapshot())).resolves.toMatchObject({ outcome: "conflict" });
    await expect(store(id, "key", "other-fingerprint", "E310000000001", snapshot())).resolves.toMatchObject({ outcome: "conflict" });
    await expect(store(id, "key", "fingerprint", "E310000000002", snapshot())).resolves.toMatchObject({ outcome: "conflict" });
    expect(await snapshots(id)).toBe("1");
  });

  it("requires a matching E31 allocation, exact sequence e-NCF, exact schema, and nonempty canonical lines", async () => {
    const id = newScope();
    await expect(store(id, "missing", "fingerprint", "E310000000001", snapshot())).resolves.toMatchObject({ outcome: "missing_allocation" });
    await provision(id); await allocate(id, "key", "fingerprint");
    const invalidSnapshots: readonly [string, unknown][] = [
      ["E310000000002", snapshot()],
      ["E310000000001", { ...snapshot(), schema: "other" }],
      ["E310000000001", { ...snapshot(), lineAdjustments: [] }],
      ["E310000000001", { ...snapshot(), extra: true }],
    ];
    for (const [eNcf, evidence] of invalidSnapshots) expect(await wasStored(store(id, "key", "fingerprint", eNcf, evidence))).toBe(false);
    expect(await snapshots(id)).toBe("0");
  });

  it("rejects empty and malformed nested components while accepting the current canonical codec fixture", async () => {
    const id = newScope(); await provision(id); await allocate(id, "key", "fingerprint");
    const canonical = snapshot();
    const malformed: unknown[] = [
      { schema: "ecf31-draft-evidence-v1", header: {}, lineAdjustments: [{}], headerTotals: {} },
      { ...canonical, header: { ...canonical.header, schema: "other" } },
      { ...canonical, lineAdjustments: [{ ...canonical.lineAdjustments[0], schema: "other" }] },
      { ...canonical, lineAdjustments: [{ ...canonical.lineAdjustments[0], coreLine: { schema: "ecf31-core-line", version: "1" } }] },
      { ...canonical, headerTotals: { ...canonical.headerTotals, montoTotal: 0 } },
    ];
    for (const evidence of malformed) expect(await wasStored(store(id, "key", "fingerprint", "E310000000001", evidence))).toBe(false);
    await expect(store(id, "key", "fingerprint", "E310000000001", canonical)).resolves.toMatchObject({ outcome: "stored" });
  });

  it("isolates trusted scopes and preserves SQL metacharacters as data", async () => {
    const left = newScope(); const right = newScope(); const key = "key'; select 1; --"; const fingerprint = "fingerprint$?[]";
    await provision(left); await provision(right); await allocate(left, key, fingerprint);
    await expect(store(right, key, fingerprint, "E310000000001", snapshot())).resolves.toMatchObject({ outcome: "missing_allocation" });
    await expect(store(left, key, fingerprint, "E310000000001", snapshot())).resolves.toMatchObject({ outcome: "stored" });
    await expect(pool.query("SELECT e_ncf FROM ecf31_draft_evidence_snapshots WHERE scope_id = $1", [right])).resolves.toMatchObject({ rows: [] });
    expect(await snapshots(right)).toBe("0"); expect(await snapshots(left)).toBe("1");
  });

  it("rejects UPDATE and DELETE while retaining the stored row for SELECT", async () => {
    const id = newScope(); await provision(id); await allocate(id, "key", "fingerprint"); await store(id, "key", "fingerprint", "E310000000001", snapshot());
    await expect(pool.query("UPDATE ecf31_draft_evidence_snapshots SET snapshot = $1::jsonb WHERE scope_id = $2", [JSON.stringify(changedSnapshot()), id])).rejects.toThrow();
    await expect(pool.query("DELETE FROM ecf31_draft_evidence_snapshots WHERE scope_id = $1", [id])).rejects.toThrow();
    expect(await snapshots(id)).toBe("1");
  });

  it("persists allocation and evidence on the caller client, commits together, and rolls both back together", async () => {
    const committed = newScope(); await provision(committed); const client = await pool.connect();
    try {
      await client.query("BEGIN"); await allocate(committed, "commit", "fingerprint", "E31", "2030-06-15", client);
      await expect(rootApi.saveEcf31DraftEvidence(client, { scopeId: committed, eNcf: "E310000000001", idempotencyKey: "commit", fingerprint: "fingerprint", evidence: evidence() })).resolves.toEqual({ outcome: "stored" });
      await client.query("COMMIT");
    } finally { client.release(); }
    expect(await state(committed)).toEqual({ next: "2", requests: "1" }); expect(await snapshots(committed)).toBe("1");
    const found = await rootApi.findEcf31DraftEvidence(pool, { scopeId: committed, eNcf: "E310000000001" });
    expect(found.outcome === "found" && rootApi.isEcf31PersistableDraftEvidence(found.evidence)).toBe(true);

    const rolledBack = newScope(); await provision(rolledBack); const rollbackClient = await pool.connect();
    try {
      await rollbackClient.query("BEGIN"); await allocate(rolledBack, "rollback", "fingerprint", "E31", "2030-06-15", rollbackClient);
      await rootApi.saveEcf31DraftEvidence(rollbackClient, { scopeId: rolledBack, eNcf: "E310000000001", idempotencyKey: "rollback", fingerprint: "fingerprint", evidence: evidence() });
      await rollbackClient.query("ROLLBACK");
    } finally { rollbackClient.release(); }
    expect(await state(rolledBack)).toEqual({ next: "1", requests: "0" }); expect(await snapshots(rolledBack)).toBe("0");
  });

  it("replays identical evidence, contains conflicts, and isolates scopes through the repository", async () => {
    const left = newScope(); const right = newScope(); await provision(left); await provision(right); await allocate(left, "key", "fingerprint");
    const request = { scopeId: left, eNcf: "E310000000001", idempotencyKey: "key", fingerprint: "fingerprint", evidence: evidence() };
    await expect(rootApi.saveEcf31DraftEvidence(pool, request)).resolves.toEqual({ outcome: "stored" });
    await expect(rootApi.saveEcf31DraftEvidence(pool, request)).resolves.toEqual({ outcome: "replayed" });
    await expect(rootApi.saveEcf31DraftEvidence(pool, { ...request, fingerprint: "other" })).resolves.toEqual({ outcome: "conflict" });
    await expect(rootApi.saveEcf31DraftEvidence(pool, { ...request, scopeId: right })).resolves.toEqual({ outcome: "missing_allocation" });
    await expect(rootApi.findEcf31DraftEvidence(pool, { scopeId: right, eNcf: request.eNcf })).resolves.toEqual({ outcome: "not_found" });
  });

  it("contains a privileged corrupt-row fixture as corrupt stored evidence", async () => {
    const id = newScope(); await provision(id); await allocate(id, "key", "fingerprint");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE ecf31_draft_evidence_snapshots DISABLE TRIGGER validate_ecf31_draft_evidence_snapshot_insert");
      await client.query("INSERT INTO ecf31_draft_evidence_snapshots (scope_id, e_ncf, allocation_idempotency_key, request_fingerprint, allocated_value, snapshot) VALUES ($1, $2, $3, $4, $5, $6::jsonb)", [id, "E310000000001", "key", "fingerprint", 1, JSON.stringify({ schema: "invalid" })]);
      await client.query("ALTER TABLE ecf31_draft_evidence_snapshots ENABLE TRIGGER validate_ecf31_draft_evidence_snapshot_insert");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    await expect(rootApi.findEcf31DraftEvidence(pool, { scopeId: id, eNcf: "E310000000001" })).resolves.toEqual({ outcome: "corrupt_stored_evidence" });
  });
});
