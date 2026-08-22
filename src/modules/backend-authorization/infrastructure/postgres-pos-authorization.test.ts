import { inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { createPostgresPosAuthorizationResolver } from "./postgres-pos-authorization.js";

const keyId = "synthetic-key".padEnd(20, "x");
const secret = "synthetic-secret".padEnd(43, "x");
const key = `dgii_pos_v1_${keyId}_${secret}`;
const denied = { ok: false, error: "authorization_denied" };
const row = { outcome: "resolved", subject_id: "synthetic-subject", credential_revision: "1", credential_expires_at_ms: "1700000000000", scope_id: "synthetic-scope", environment: "TesteCF", membership_revision: "2", membership_expires_at_ms: null };
const value = { subjectId: "synthetic-subject", credentialRevision: "1", credentialExpiresAtMs: 1_700_000_000_000, scopeId: "synthetic-scope", environment: "TesteCF", membershipRevision: "2", membershipExpiresAtMs: Number.MAX_SAFE_INTEGER };
const without = (name: string) => Object.fromEntries(Object.entries(row).filter(([column]) => column !== name));
const revoke = (target: object): unknown => { const revocable = Proxy.revocable(target, {}); revocable.revoke(); return revocable.proxy; };
/** Hostile clients must answer with a genuinely resolvable row, so only the strict dependency gate can deny them. */
const authorizing = () => Promise.resolve({ rows: [row] });
const bind = (result: unknown) => { const query = vi.fn().mockResolvedValue(result); return { query, resolver: createPostgresPosAuthorizationResolver({ client: { query } }) }; };

describe("PostgreSQL POS authorization adapter", () => {
  it("resolves a well-formed row through parameterised SQL that never carries the credential", async () => {
    const { query, resolver } = bind({ rows: [row] });
    const outcome = await resolver.resolve(key);
    expect(outcome).toEqual({ ok: true, value });
    if (!outcome.ok) throw new Error("expected a resolved authorization");
    expect(Object.isFrozen(outcome.value)).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const call = query.mock.calls[0] as [string, readonly unknown[]] | undefined;
    if (call === undefined) throw new Error("expected one query");
    expect(call[0]).toContain("resolve_pos_authorization($1, $2)");
    expect(call[0]).not.toContain(keyId); expect(call[0]).not.toContain(secret);
    expect(call[1]).toHaveLength(2); expect(call[1][0]).toBe(keyId);
    expect(Buffer.isBuffer(call[1][1])).toBe(true); expect(call[1][1]).toHaveLength(32);
  });

  it("treats a null expiry as non-expiring rather than as a denial", async () => {
    await expect(bind({ rows: [{ ...row, credential_expires_at_ms: null, membership_expires_at_ms: "1700000000001" }] }).resolver.resolve(key))
      .resolves.toEqual({ ok: true, value: { ...value, credentialExpiresAtMs: Number.MAX_SAFE_INTEGER, membershipExpiresAtMs: 1_700_000_000_001 } });
    await expect(bind({ rows: [{ ...row, credential_expires_at_ms: "0", membership_expires_at_ms: "9007199254740991" }] }).resolver.resolve(key))
      .resolves.toEqual({ ok: true, value: { ...value, credentialExpiresAtMs: 0, membershipExpiresAtMs: Number.MAX_SAFE_INTEGER } });
  });

  it("denies every unknown outcome, malformed column and hostile row descriptor", async () => {
    const rows: readonly unknown[] = [
      { ...row, outcome: "authorization_denied" }, { ...row, outcome: "resolved_later" }, { ...row, outcome: 1 },
      { ...row, outcome: "RESOLVED" }, { ...row, outcome: "Resolved" }, { ...row, outcome: " resolved" },
      { ...row, subject_id: "" }, { ...row, subject_id: "not a subject" }, { ...row, subject_id: 42 }, { ...row, scope_id: null },
      { ...row, credential_revision: "0" }, { ...row, credential_revision: "-1" }, { ...row, membership_revision: "one" },
      { ...row, environment: "TESTECF" }, { ...row, environment: "testecf" },
      { ...row, credential_expires_at_ms: "1.5" }, { ...row, credential_expires_at_ms: "9007199254740992" }, { ...row, credential_expires_at_ms: "not_finite" },
      { ...row, credential_expires_at_ms: 1_700_000_000_000 }, { ...row, membership_expires_at_ms: "-1" }, { ...row, membership_expires_at_ms: undefined },
      { ...row, extra: true }, without("scope_id"), Object.assign(Object.create(null) as object, row), new Proxy({ ...row }, {}),
      Object.defineProperty({ ...row }, "outcome", { get: () => "resolved", enumerable: true, configurable: true }),
      Object.defineProperty({ ...row }, "outcome", { value: "resolved", enumerable: false, configurable: true }),
      revoke({ ...row }), [row], "resolved", null,
    ];
    for (const candidate of rows) await expect(bind({ rows: [candidate] }).resolver.resolve(key)).resolves.toEqual(denied);
  });

  it("denies every result envelope that is not exactly one row", async () => {
    const results: readonly unknown[] = [
      null, undefined, 42, "rows", [{ rows: [row] }], {}, { rows: [] }, { rows: [row, row] }, { rows: row }, { rows: null }, { rows: Array<unknown>(1) },
      { rows: Object.defineProperty([0], "0", { get: () => row, enumerable: true, configurable: true }) },
      { rows: new Proxy([row], {}) }, { rows: revoke([row]) }, Object.defineProperty({}, "rows", { get: () => [row], enumerable: true }),
      new Proxy({ rows: [row] }, {}), revoke({ rows: [row] }),
    ];
    for (const result of results) await expect(bind(result).resolver.resolve(key)).resolves.toEqual(denied);
  });

  it("denies hostile dependencies and never queries for a malformed presentation", async () => {
    const dependencies: readonly unknown[] = [
      undefined, null, 42, {}, { client: null }, { client: {} }, { client: { query: 42 } }, { client: { query: authorizing, extra: 1 } },
      { client: { query: authorizing }, extra: 1 }, new Proxy({ client: { query: authorizing } }, {}), { client: new Proxy({ query: authorizing }, {}) },
      Object.assign(Object.create(null) as object, { client: { query: authorizing } }), [{ client: { query: authorizing } }],
    ];
    for (const dependency of dependencies) await expect(createPostgresPosAuthorizationResolver(dependency).resolve(key)).resolves.toEqual(denied);
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const resolver = createPostgresPosAuthorizationResolver({ client: { query } });
    for (const malformed of [`${key}x`, ` ${key}`, `dgii_pos_v2_${keyId}_${secret}`, 42, null, Object(key)]) await expect(resolver.resolve(malformed)).resolves.toEqual(denied);
    expect(query).not.toHaveBeenCalled();
  });

  it("collapses driver failures into the same denial and never discloses the credential", async () => {
    for (const query of [vi.fn().mockRejectedValue(new Error(`driver failed for ${key}`)), vi.fn(() => { throw new Error(`driver failed for ${key}`); }), vi.fn().mockResolvedValue(Promise.reject(new Error("28P01")))]) {
      const resolver = createPostgresPosAuthorizationResolver({ client: { query } });
      const outcome = await resolver.resolve(key);
      expect(outcome).toEqual(denied);
      expect(JSON.stringify(outcome)).not.toContain(secret);
      expect(JSON.stringify(outcome)).not.toContain("28P01");
    }
    const resolved = await bind({ rows: [row] }).resolver.resolve(key);
    for (const rendered of [JSON.stringify(resolved), inspect(resolved, { depth: null })] as readonly string[]) {
      expect(rendered).not.toContain(secret); expect(rendered).not.toContain(key); expect(rendered).not.toContain("resolve_pos_authorization");
    }
  });
});
