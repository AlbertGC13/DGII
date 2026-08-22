import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { posApiKeyDigest } from "../pos-api-key.js";
import { createPostgresPosAuthorizationResolver } from "./postgres-pos-authorization.js";

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] ?? "postgres://sequence_test@localhost:55432/sequence_test" });
const migrations = ["0001_atomic_sequence_allocation.sql", "0002_ecf31_draft_evidence_snapshots.sql", "0003_ecf31_draft_evidence_envelope_v2.sql", "0004_ecf31_delivery_evidence.sql", "0005_ecf31_delivery_intent_safety.sql", "0006_pos_api_authorization.sql"];
const denied = { ok: false, error: "authorization_denied" };
let serial = 0;
const client = (query: Pick<Pool, "query">["query"]) => createPostgresPosAuthorizationResolver({ client: { query: async (text: string, values?: readonly unknown[]) => query(text, values as unknown[]) } });
const resolver = client(pool.query.bind(pool));
/** Seeded through the parser's own exported derivation, so no fixture can restate the production formula. */
const digest = (keyId: string, secret: string): Buffer => {
  const derived = posApiKeyDigest(keyId, secret);
  if (derived === undefined) throw new Error("synthetic credential material must be presentable");
  return derived;
};

beforeEach(async () => {
  await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dgii_backend_runtime') THEN CREATE ROLE dgii_backend_runtime NOLOGIN; END IF; END $$");
  for (const name of migrations) await pool.query(readFileSync(resolve("db/migrations", name), "utf8"));
  await pool.query("TRUNCATE pos_authorization_audit, pos_scope_memberships, pos_api_credentials, pos_principals");
});
afterAll(async () => { await pool.end(); });

async function grant(environment = "testecf", expiresAt: string | null = null, membershipExpiresAt: string | null = null) {
  serial += 1;
  const subject = `synthetic-subject-${String(serial)}`; const scope = `synthetic-scope-${String(serial)}`;
  const keyId = `synthetic-key-${String(serial).padStart(6, "0")}`; const secret = `synthetic-secret-${String(serial).padStart(26, "0")}`;
  const membership = `synthetic-mbr-${String(serial).padStart(6, "0")}`;
  await pool.query("INSERT INTO pos_principals(subject_id) VALUES ($1)", [subject]);
  await pool.query("INSERT INTO pos_api_credentials(key_id, subject_id, digest, revision, valid_from, expires_at) VALUES ($1,$2,$3,1,statement_timestamp()-interval '1 second',$4)", [keyId, subject, digest(keyId, secret), expiresAt]);
  await pool.query("INSERT INTO pos_scope_memberships(membership_id, subject_id, scope_id, environment, revision, valid_from, expires_at) VALUES ($1,$2,$3,$4,1,statement_timestamp()-interval '1 second',$5)", [membership, subject, scope, environment, membershipExpiresAt]);
  return { subject, scope, keyId, secret, membership, key: `dgii_pos_v1_${keyId}_${secret}` };
}

describe("PostgreSQL POS authorization adapter against the live kernel", () => {
  it("resolves every environment and reports an absent expiry as non-expiring", async () => {
    for (const [stored, environment] of [["testecf", "TesteCF"], ["certecf", "CerteCF"], ["ecf", "production"]] as const) {
      const granted = await grant(stored);
      await expect(resolver.resolve(granted.key)).resolves.toEqual({ ok: true, value: { subjectId: granted.subject, credentialRevision: "1", credentialExpiresAtMs: Number.MAX_SAFE_INTEGER, scopeId: granted.scope, environment, membershipRevision: "1", membershipExpiresAtMs: Number.MAX_SAFE_INTEGER } });
    }
  });

  it("converts a stored expiry to exact epoch milliseconds including sub-second precision", async () => {
    const granted = await grant("testecf", "2030-01-01T00:00:00.123Z");
    const outcome = await resolver.resolve(granted.key);
    if (!outcome.ok) throw new Error("expected a resolved authorization");
    expect(outcome.value.credentialExpiresAtMs).toBe(Date.parse("2030-01-01T00:00:00.123Z"));
    expect(outcome.value.membershipExpiresAtMs).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("treats a stored infinity expiry as non-expiring on both the credential and the membership", async () => {
    const granted = await grant("ecf", "infinity", "infinity");
    await expect(resolver.resolve(granted.key)).resolves.toMatchObject({ ok: true, value: { credentialExpiresAtMs: Number.MAX_SAFE_INTEGER, membershipExpiresAtMs: Number.MAX_SAFE_INTEGER } });
  });

  it("denies a wrong secret, an unknown identifier, and revoked credentials or memberships", async () => {
    const granted = await grant();
    const foreign = await grant();
    for (const presented of [`dgii_pos_v1_${granted.keyId}_${foreign.secret}`, `dgii_pos_v1_${foreign.keyId}_${granted.secret}`, `dgii_pos_v1_${"absent-key".padEnd(20, "x")}_${granted.secret}`]) {
      await expect(resolver.resolve(presented)).resolves.toEqual(denied);
    }
    await expect(resolver.resolve(granted.key)).resolves.toMatchObject({ ok: true });
    await pool.query("UPDATE pos_scope_memberships SET revoked_at=statement_timestamp() WHERE membership_id=$1", [granted.membership]);
    await expect(resolver.resolve(granted.key)).resolves.toEqual(denied);
    await pool.query("UPDATE pos_api_credentials SET revoked_at=statement_timestamp() WHERE key_id=$1", [foreign.keyId]);
    await expect(resolver.resolve(foreign.key)).resolves.toEqual(denied);
  });

  it("resolves under the least-privilege runtime role and denies when the database refuses the call", async () => {
    const granted = await grant("certecf");
    const session = await pool.connect();
    try {
      await session.query("SET ROLE dgii_backend_runtime");
      await expect(client(session.query.bind(session)).resolve(granted.key)).resolves.toMatchObject({ ok: true, value: { environment: "CerteCF" } });
      await session.query("RESET ROLE");
      await expect(client(session.query.bind(session)).resolve(`dgii_pos_v1_${granted.keyId}_${"unrelated-secret".padEnd(43, "y")}`)).resolves.toEqual(denied);
    } finally { await session.query("RESET ROLE").catch(() => undefined); session.release(); }
    const closed = new Pool({ connectionString: "postgres://sequence_test@localhost:1/absent" });
    await closed.end();
    const outcome = await client(closed.query.bind(closed)).resolve(granted.key);
    expect(outcome).toEqual(denied);
    expect(JSON.stringify(outcome)).not.toContain(granted.secret);
  });
});
