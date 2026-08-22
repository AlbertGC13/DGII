import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspect } from "node:util";

import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { BACKEND_ACTION, createBackendScopeAuthority } from "../backend-scope-authority.js";
import { posApiKeyDigest } from "../pos-api-key.js";
import { createPosBackendScopeAuthorityPorts } from "./pos-backend-scope-authority-ports.js";
import { createPostgresPosAuthorizationResolver } from "./postgres-pos-authorization.js";

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] ?? "postgres://sequence_test@localhost:55432/sequence_test" });
const migrations = ["0001_atomic_sequence_allocation.sql", "0002_ecf31_draft_evidence_snapshots.sql", "0003_ecf31_draft_evidence_envelope_v2.sql", "0004_ecf31_delivery_evidence.sql", "0005_ecf31_delivery_intent_safety.sql", "0006_pos_api_authorization.sql"];
const denied = { ok: false, error: "authorization_denied" }; let serial = 0;
/** The mandatory wrapper: a native `pg.Pool` structurally satisfies the client type and is rejected at runtime, so the driver is handed over as a plain object carrying exactly one `query` data property. */
const wrap = (driver: Pick<Pool, "query">) => ({ client: { query: async (text: string, values?: readonly unknown[]) => driver.query(text, values as unknown[]) } });
const portsFor = (presentedKey: unknown, dependencies: unknown = wrap(pool)) => createPosBackendScopeAuthorityPorts({ resolver: createPostgresPosAuthorizationResolver(dependencies), presentedKey });
const authorityFor = (presentedKey: unknown, dependencies: unknown = wrap(pool)) => createBackendScopeAuthority({ ...portsFor(presentedKey, dependencies), clock: () => ({ monotonicMs: 0, wallMs: Date.now() }), maxTtlMs: 60_000 });
/** Seeded through the parser's own exported derivation, so no fixture can restate the production formula. */
const digest = (keyId: string, secret: string): Buffer => {
  const derived = posApiKeyDigest(keyId, secret);
  if (derived === undefined) throw new Error("synthetic credential material must be presentable"); return derived;
};

beforeEach(async () => {
  await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dgii_backend_runtime') THEN CREATE ROLE dgii_backend_runtime NOLOGIN; END IF; END $$");
  for (const name of migrations) await pool.query(readFileSync(resolve("db/migrations", name), "utf8"));
  await pool.query("TRUNCATE pos_authorization_audit, pos_scope_memberships, pos_api_credentials, pos_principals");
});
afterAll(async () => { await pool.end(); });

const credential = async (subject: string, revision: number) => {
  serial += 1; const keyId = `synthetic-key-${String(serial).padStart(6, "0")}`; const secret = `synthetic-secret-${String(serial).padStart(26, "0")}`;
  await pool.query("INSERT INTO pos_api_credentials(key_id, subject_id, digest, revision, valid_from) VALUES ($1,$2,$3,$4,statement_timestamp()-interval '1 second')", [keyId, subject, digest(keyId, secret), revision]);
  return { keyId, secret, key: `dgii_pos_v1_${keyId}_${secret}` };
};
async function grant() {
  serial += 1; const subject = `synthetic-subject-${String(serial)}`; const scope = `synthetic-scope-${String(serial)}`; const membership = `synthetic-mbr-${String(serial).padStart(6, "0")}`;
  await pool.query("INSERT INTO pos_principals(subject_id) VALUES ($1)", [subject]);
  await pool.query("INSERT INTO pos_scope_memberships(membership_id, subject_id, scope_id, environment, revision, valid_from) VALUES ($1,$2,$3,'certecf',1,statement_timestamp()-interval '1 second')", [membership, subject, scope]);
  return { subject, scope, membership, ...(await credential(subject, 1)) };
}
async function issued(key: string) {
  const authority = authorityFor(key); const capability = await authority.issue(BACKEND_ACTION, key);
  if (!capability.ok) throw new Error("expected a capability");
  return { authority, capability: capability.value };
}

describe("POS-bound backend scope authority ports against the live kernel", () => {
  it("issues from live state and runs the operation exactly once, then burns the capability", async () => {
    const granted = await grant();
    const { authority, capability } = await issued(granted.key);
    const operation = vi.fn((context: { scopeId: string; environment: string }) => `${context.scopeId}/${context.environment}`);
    await expect(authority.use(capability, BACKEND_ACTION, operation)).resolves.toEqual({ ok: true, value: `${granted.scope}/CerteCF` });
    await expect(authority.use(capability, BACKEND_ACTION, operation)).resolves.toEqual(denied);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("denies use when the credential is revoked between issue and use", async () => {
    const granted = await grant();
    const { authority, capability } = await issued(granted.key);
    await pool.query("UPDATE pos_api_credentials SET revoked_at=statement_timestamp() WHERE key_id=$1", [granted.keyId]);
    const operation = vi.fn(() => "unexpected");
    await expect(authority.use(capability, BACKEND_ACTION, operation)).resolves.toEqual(denied);
    expect(operation).not.toHaveBeenCalled();
  });

  it("denies use when the membership is revoked between issue and use", async () => {
    const granted = await grant();
    const { authority, capability } = await issued(granted.key);
    await pool.query("UPDATE pos_scope_memberships SET revoked_at=statement_timestamp() WHERE membership_id=$1", [granted.membership]);
    const operation = vi.fn(() => "unexpected");
    await expect(authority.use(capability, BACKEND_ACTION, operation)).resolves.toEqual(denied);
    expect(operation).not.toHaveBeenCalled();
  });

  it("denies the superseded key when the credential revision is rotated between issue and use", async () => {
    const granted = await grant();
    const { authority, capability } = await issued(granted.key);
    const rotated = await credential(granted.subject, 2);
    await pool.query("UPDATE pos_api_credentials SET revoked_at=statement_timestamp() WHERE key_id=$1", [granted.keyId]);
    const operation = vi.fn(() => "unexpected");
    await expect(authority.use(capability, BACKEND_ACTION, operation)).resolves.toEqual(denied);
    expect(operation).not.toHaveBeenCalled();
    const successor = await issued(rotated.key);
    await expect(successor.authority.use(successor.capability, BACKEND_ACTION, (context) => context.scopeId)).resolves.toEqual({ ok: true, value: granted.scope });
  });

  it("keeps an expired but unrevoked membership in the active slot until an explicit audited revocation", async () => {
    const granted = await grant();
    await pool.query("UPDATE pos_scope_memberships SET revoked_at=statement_timestamp() WHERE membership_id=$1", [granted.membership]);
    const expired = "synthetic-expired-00";
    await pool.query("INSERT INTO pos_scope_memberships(membership_id, subject_id, scope_id, environment, revision, valid_from, expires_at) VALUES ($1,$2,$3,'certecf',2,statement_timestamp()-interval '10 seconds',statement_timestamp()-interval '1 second')", [expired, granted.subject, granted.scope]);
    await expect(authorityFor(granted.key).issue(BACKEND_ACTION, granted.key)).resolves.toEqual(denied);
    await expect(pool.query("INSERT INTO pos_scope_memberships(membership_id, subject_id, scope_id, environment, revision, valid_from) VALUES ($1,$2,$3,'certecf',3,statement_timestamp()-interval '1 second')", ["synthetic-replaced-0", granted.subject, granted.scope])).rejects.toMatchObject({ code: "23505" });
    await pool.query("UPDATE pos_scope_memberships SET revoked_at=statement_timestamp() WHERE membership_id=$1", [expired]);
    await expect(pool.query("SELECT count(*)::text AS count FROM pos_authorization_audit WHERE membership_id=$1 AND event='membership_revoked'", [expired])).resolves.toMatchObject({ rows: [{ count: "1" }] });
    await pool.query("INSERT INTO pos_scope_memberships(membership_id, subject_id, scope_id, environment, revision, valid_from) VALUES ($1,$2,$3,'certecf',3,statement_timestamp()-interval '1 second')", ["synthetic-replaced-0", granted.subject, granted.scope]);
    const replaced = await issued(granted.key);
    await expect(replaced.authority.use(replaced.capability, BACKEND_ACTION, (context) => context.scopeId)).resolves.toEqual({ ok: true, value: granted.scope });
  });

  it("never authorises foreign evidence and denies a native pool handed over without the wrapper", async () => {
    const granted = await grant(); const foreign = await grant();
    await expect(authorityFor(granted.key).issue(BACKEND_ACTION, foreign.key)).resolves.toEqual(denied);
    await expect(authorityFor(foreign.key).issue(BACKEND_ACTION, granted.key)).resolves.toEqual(denied);
    for (const dependencies of [pool, { client: pool }, wrap(pool).client]) {
      await expect(authorityFor(granted.key, dependencies).issue(BACKEND_ACTION, granted.key)).resolves.toEqual(denied);
    }
  });

  it("rejects from the ports with a value that carries nothing derived from the credential", async () => {
    const granted = await grant();
    await pool.query("UPDATE pos_api_credentials SET revoked_at=statement_timestamp() WHERE key_id=$1", [granted.keyId]);
    const rejected: unknown = await portsFor(granted.key).identify(granted.key).then(() => undefined, (error: unknown) => error);
    expect(rejected).toBeInstanceOf(Error);
    for (const rendered of [String(rejected), JSON.stringify(rejected), inspect(rejected, { depth: null }), (rejected as Error).stack ?? ""]) {
      expect(rendered).not.toContain(granted.secret);
      expect(rendered).not.toContain(granted.keyId);
      expect(rendered).not.toContain("resolve_pos_authorization");
    }
  });
});
