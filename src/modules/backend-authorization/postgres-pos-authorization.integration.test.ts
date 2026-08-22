import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { posApiKeyDigest } from "./pos-api-key.js";

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] ?? "postgres://sequence_test@localhost:55432/sequence_test" });
const migrations = ["0001_atomic_sequence_allocation.sql", "0002_ecf31_draft_evidence_snapshots.sql", "0003_ecf31_draft_evidence_envelope_v2.sql", "0004_ecf31_delivery_evidence.sql", "0005_ecf31_delivery_intent_safety.sql", "0006_pos_api_authorization.sql"];
let serial = 0;
type Resolution = Readonly<{ outcome: string; subject_id: string | null; credential_revision: string | null; credential_expires_at: string | null; scope_id: string | null; environment: string | null; membership_revision: string | null; membership_expires_at: string | null }>;
const id = (prefix: string) => `${prefix}-${String(++serial)}`;
const keyId = () => `key_${String(++serial).padStart(16, "0")}`;
/** A deterministic synthetic base64url-43 secret, hashed through the parser's own exported derivation. */
const secretFor = (key: string) => createHash("sha256").update(`synthetic-${key}`).digest("base64url");
const digest = (key: string): Buffer => {
  const derived = posApiKeyDigest(key, secretFor(key));
  if (derived === undefined) throw new Error("synthetic credential material must be presentable");
  return derived;
};

beforeEach(async () => {
  await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dgii_backend_runtime') THEN CREATE ROLE dgii_backend_runtime NOLOGIN; END IF; END $$");
  for (const name of migrations) await pool.query(readFileSync(resolve("db/migrations", name), "utf8"));
  for (const name of migrations) await pool.query(readFileSync(resolve("db/migrations", name), "utf8"));
  await pool.query("TRUNCATE pos_authorization_audit, pos_scope_memberships, pos_api_credentials, pos_principals");
});
afterAll(async () => { await pool.end(); });

async function grant(environment = "testecf", client: Pick<Pool, "query"> = pool) {
  const subject = id("synthetic-subject"); const key = keyId(); const scope = id("synthetic-scope"); const membership = `member_${String(serial).padStart(13, "0")}`;
  await client.query("INSERT INTO pos_principals(subject_id) VALUES ($1)", [subject]);
  await client.query("INSERT INTO pos_api_credentials(key_id, subject_id, digest, revision, valid_from) VALUES ($1,$2,$3,1,statement_timestamp()-interval '1 second')", [key, subject, digest(key)]);
  await client.query("INSERT INTO pos_scope_memberships(membership_id, subject_id, scope_id, environment, revision, valid_from) VALUES ($1,$2,$3,$4,1,statement_timestamp()-interval '1 second')", [membership, subject, scope, environment]);
  return { subject, key, scope, membership };
}
async function resolveAuthorization(key: string, candidate = digest(key), client: Pick<Pool, "query"> = pool): Promise<Resolution> {
  const result = await client.query<Resolution>("SELECT * FROM resolve_pos_authorization($1,$2)", [key, candidate]);
  if (result.rows.length !== 1) throw new Error("resolver result missing");
  const row = result.rows[0]; if (row === undefined) throw new Error("resolver result missing"); return row;
}
const denied = { outcome: "authorization_denied", subject_id: null, credential_revision: null, credential_expires_at: null, scope_id: null, environment: null, membership_revision: null, membership_expires_at: null };

describe("PostgreSQL POS authorization kernel", () => {
  it("resolves every environment and makes all invalid forms indistinguishable", async () => {
    for (const expected of [["testecf", "TesteCF"], ["certecf", "CerteCF"], ["ecf", "production"]] as const) {
      const value = await grant(expected[0]);
      await expect(resolveAuthorization(value.key)).resolves.toMatchObject({ outcome: "resolved", subject_id: value.subject, credential_revision: "1", scope_id: value.scope, environment: expected[1], membership_revision: "1" });
      for (const candidate of [Buffer.alloc(31), Buffer.alloc(33), Buffer.alloc(32), digest(keyId())]) await expect(resolveAuthorization(value.key, candidate)).resolves.toEqual(denied);
    }
    await expect(resolveAuthorization("invalid", Buffer.alloc(32))).resolves.toEqual(denied);
    const unavailable = await grant(); await pool.query("UPDATE pos_api_credentials SET revoked_at=statement_timestamp() WHERE key_id=$1", [unavailable.key]); await expect(resolveAuthorization(unavailable.key)).resolves.toEqual(denied);
    const expired = await grant(); await pool.query("UPDATE pos_scope_memberships SET revoked_at=statement_timestamp() WHERE membership_id=$1", [expired.membership]); await expect(resolveAuthorization(expired.key)).resolves.toEqual(denied);
  });

  it("allows credential rotation but denies the revoked predecessor", async () => {
    const value = await grant(); const replacement = keyId();
    await pool.query("INSERT INTO pos_api_credentials(key_id, subject_id, digest, revision, valid_from) VALUES ($1,$2,$3,2,statement_timestamp()-interval '1 second')", [replacement, value.subject, digest(replacement)]);
    await expect(resolveAuthorization(value.key)).resolves.toMatchObject({ outcome: "resolved" }); await expect(resolveAuthorization(replacement)).resolves.toMatchObject({ outcome: "resolved" });
    await pool.query("UPDATE pos_api_credentials SET revoked_at=statement_timestamp() WHERE key_id=$1", [value.key]);
    await expect(resolveAuthorization(value.key)).resolves.toEqual(denied); await expect(resolveAuthorization(replacement)).resolves.toMatchObject({ outcome: "resolved" });
  });

  it("enforces one declared-active membership and permits atomic replacement", async () => {
    const value = await grant(); await pool.query("UPDATE pos_scope_memberships SET revoked_at=statement_timestamp() WHERE membership_id=$1", [value.membership]); const concurrent = await Promise.allSettled(["a", "b"].map(async (suffix) => pool.query("INSERT INTO pos_scope_memberships(membership_id, subject_id, scope_id, environment, revision, valid_from) VALUES ($1,$2,$3,'ecf',2,statement_timestamp())", [`member_${suffix}${"x".repeat(12)}`, value.subject, `scope-${suffix}`])));
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1); const active = await pool.query<{ membership_id: string }>("SELECT membership_id FROM pos_scope_memberships WHERE subject_id=$1 AND active", [value.subject]);
    const membership = active.rows[0]; if (membership === undefined) throw new Error("active membership missing"); const client = await pool.connect(); try { await client.query("BEGIN"); await client.query("UPDATE pos_scope_memberships SET revoked_at=statement_timestamp() WHERE membership_id=$1", [membership.membership_id]); await client.query("INSERT INTO pos_scope_memberships(membership_id,subject_id,scope_id,environment,revision,valid_from) VALUES ($1,$2,'replacement','certecf',3,statement_timestamp())", [`m${"x".repeat(19)}`, value.subject]); await client.query("COMMIT"); } finally { await client.query("ROLLBACK").catch(() => undefined); client.release(); }
    await expect(resolveAuthorization(value.key)).resolves.toMatchObject({ outcome: "resolved", scope_id: "replacement", environment: "CerteCF", membership_revision: "3" });
  });

  it("uses commit-visible revocation without retaining downstream locks", async () => {
    const value = await grant(); const client = await pool.connect();
    try { await client.query("BEGIN"); await client.query("UPDATE pos_scope_memberships SET revoked_at=statement_timestamp() WHERE membership_id=$1", [value.membership]); await expect(resolveAuthorization(value.key)).resolves.toMatchObject({ outcome: "resolved" }); await client.query("COMMIT"); await expect(resolveAuthorization(value.key)).resolves.toEqual(denied); } finally { await client.query("ROLLBACK").catch(() => undefined); client.release(); }
  });

  it("protects immutable core state, audit history, digest storage, and rollback", async () => {
    const value = await grant();
    await expect(pool.query("UPDATE pos_principals SET subject_id='changed' WHERE subject_id=$1", [value.subject])).rejects.toMatchObject({ code: "P0001" });
    await expect(pool.query("DELETE FROM pos_api_credentials WHERE key_id=$1", [value.key])).rejects.toMatchObject({ code: "P0001" });
    await expect(pool.query("UPDATE pos_scope_memberships SET scope_id='changed' WHERE membership_id=$1", [value.membership])).rejects.toMatchObject({ code: "P0001" });
    await expect(pool.query("SELECT octet_length(digest)::text AS size FROM pos_api_credentials WHERE key_id=$1", [value.key])).resolves.toMatchObject({ rows: [{ size: "32" }] });
    await expect(pool.query("SELECT count(*)::text AS count FROM pos_authorization_audit WHERE subject_id=$1", [value.subject])).resolves.toMatchObject({ rows: [{ count: "3" }] });
    await expect(pool.query("SELECT count(*)::text AS count FROM pos_authorization_audit WHERE to_jsonb(pos_authorization_audit)::text LIKE '%digest%' ")).resolves.toMatchObject({ rows: [{ count: "0" }] });
    const client = await pool.connect(); try { await client.query("BEGIN"); await client.query("UPDATE pos_api_credentials SET revoked_at=statement_timestamp() WHERE key_id=$1", [value.key]); await client.query("ROLLBACK"); } finally { await client.query("ROLLBACK").catch(() => undefined); client.release(); }
    await expect(resolveAuthorization(value.key)).resolves.toMatchObject({ outcome: "resolved" });
    await expect(pool.query("UPDATE pos_authorization_audit SET event='changed'")).rejects.toMatchObject({ code: "P0001" });
    await pool.query("UPDATE pos_scope_memberships SET revoked_at=statement_timestamp() WHERE membership_id=$1", [value.membership]);
    await expect(pool.query("SELECT event FROM pos_authorization_audit WHERE subject_id=$1 ORDER BY audit_id", [value.subject])).resolves.toMatchObject({ rows: [{ event: "principal_created" }, { event: "credential_created" }, { event: "membership_created" }, { event: "membership_revoked" }] });
  });

  it("exposes only the resolver to the runtime role and preserves owner legacy calls", async () => {
    const value = await grant();
    await expect(pool.query("SELECT has_function_privilege('public','resolve_pos_authorization(text,bytea)','EXECUTE') AS public_resolver, has_function_privilege('dgii_backend_runtime','resolve_pos_authorization(text,bytea)','EXECUTE') AS runtime_resolver, has_table_privilege('dgii_backend_runtime','pos_api_credentials','SELECT') AS runtime_table, has_function_privilege('public','allocate_fiscal_sequence(text,text,text,text,date)','EXECUTE') AS sequence_public, has_function_privilege('public','store_ecf31_draft_evidence(text,text,text,text,jsonb)','EXECUTE') AS draft_public, has_function_privilege('dgii_backend_runtime','allocate_fiscal_sequence(text,text,text,text,date)','EXECUTE') AS runtime_legacy, prosecdef AS definer, proconfig @> ARRAY['search_path=pg_catalog'] AS path, pg_get_userbyid(proowner)=current_user AS owner FROM pg_proc WHERE oid='resolve_pos_authorization(text,bytea)'::regprocedure")).resolves.toMatchObject({ rows: [{ public_resolver: false, runtime_resolver: true, runtime_table: false, sequence_public: false, draft_public: false, runtime_legacy: false, definer: true, path: true, owner: true }] });
    await expect(pool.query<{ signature: string }>("SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('dgii_backend_runtime',p.oid,'EXECUTE') ORDER BY signature")).resolves.toMatchObject({ rows: [{ signature: "resolve_pos_authorization(text,bytea)" }] });
    await expect(pool.query("SELECT count(*)::text AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('public',p.oid,'EXECUTE')")).resolves.toMatchObject({ rows: [{ count: "0" }] });
    const client = await pool.connect(); try { await client.query("SET ROLE dgii_backend_runtime"); await expect(resolveAuthorization(value.key, digest(value.key), client)).resolves.toMatchObject({ outcome: "resolved" }); await client.query("SELECT * FROM pos_api_credentials").then(() => { throw new Error("expected table denial"); }, (error: unknown) => { expect(error).toMatchObject({ code: "42501" }); }); } finally { await client.query("RESET ROLE"); client.release(); }
    await expect(pool.query("SELECT * FROM allocate_fiscal_sequence('owner-scope','E31','owner-key','owner-fingerprint',current_date)")).resolves.toBeDefined();
    await expect(pool.query("SELECT * FROM store_ecf31_draft_evidence('owner-scope','E310000000001','owner-key','owner-fingerprint','{}'::jsonb)")).resolves.toBeDefined();
  });
});
