import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] ?? "postgres://sequence_test@localhost:55432/sequence_test" });
const migrationPath = resolve("db/migrations/0001_atomic_sequence_allocation.sql");
let scope = 0;
type Allocation = Readonly<{ outcome: string; allocated_value: string | null }>;
type Queryable = Pick<Pool, "query">;

beforeEach(async () => { await pool.query(readFileSync(migrationPath, "utf8")); await pool.query("TRUNCATE sequence_allocation_requests, sequence_counters"); });
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
