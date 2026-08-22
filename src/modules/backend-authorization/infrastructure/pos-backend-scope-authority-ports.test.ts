import { inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { BACKEND_ACTION, createBackendScopeAuthority } from "../backend-scope-authority.js";
import { createPosBackendScopeAuthorityPorts } from "./pos-backend-scope-authority-ports.js";

const keyId = "synthetic-key".padEnd(20, "x");
const secret = "synthetic-secret".padEnd(43, "x");
const key = `dgii_pos_v1_${keyId}_${secret}`; const foreignKey = `dgii_pos_v1_${keyId}_${"synthetic-other".padEnd(43, "y")}`;
const row = { subjectId: "synthetic-subject", credentialRevision: "1", credentialExpiresAtMs: 1_700_000_000_000, scopeId: "synthetic-scope", environment: "TesteCF", membershipRevision: "2", membershipExpiresAtMs: 1_700_000_000_500 };
const principal = { subjectId: "synthetic-subject", credentialRevision: "1", expiresAtMs: 1_700_000_000_000 };
const scope = { scopeId: "synthetic-scope", environment: "TesteCF", membershipRevision: "2", membershipExpiresAtMs: 1_700_000_000_500, active: true };
const resolved = (value: unknown = row) => Object.freeze({ ok: true, value: Object.freeze(value) });
const denied = Object.freeze({ ok: false, error: "authorization_denied" });
const revoke = (target: object): unknown => { const revocable = Proxy.revocable(target, {}); revocable.revoke(); return revocable.proxy; };
const without = (source: object, name: string) => Object.fromEntries(Object.entries(source).filter(([field]) => field !== name));
const bind = (outcome: unknown = resolved(), presentedKey: unknown = key) => {
  const resolve = vi.fn<(presented: unknown) => Promise<unknown>>(() => Promise.resolve(outcome));
  return { resolve, ports: createPosBackendScopeAuthorityPorts({ resolver: { resolve }, presentedKey }) };
};
/** Returns the rejection value itself so the same detail-free instance can be compared and rendered. */
const rejection = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => { throw new Error("expected a rejection"); }, (error: unknown) => error);

describe("POS-bound backend scope authority ports", () => {
  it("answers every port from a fresh resolve of the bound credential and memoises nothing", async () => {
    const { resolve, ports } = bind();
    await expect(ports.identify(key)).resolves.toEqual(principal);
    await expect(ports.resolve(principal, BACKEND_ACTION)).resolves.toEqual(scope);
    await expect(ports.refresh(principal, scope, BACKEND_ACTION)).resolves.toEqual({ principal, scope });
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(resolve.mock.calls).toEqual([[key], [key], [key]]);
  });

  it("reports the current database values rather than anything captured earlier", async () => {
    const answers = [resolved(), resolved({ ...row, credentialRevision: "9", membershipRevision: "9", membershipExpiresAtMs: 1_700_000_000_400 })];
    const resolve = vi.fn<(presented: unknown) => Promise<unknown>>(() => Promise.resolve(answers.shift() ?? denied));
    const ports = createPosBackendScopeAuthorityPorts({ resolver: { resolve }, presentedKey: key });
    await expect(ports.identify(key)).resolves.toEqual(principal);
    await expect(ports.resolve(principal, BACKEND_ACTION)).rejects.toThrow("authorization_denied");
    await expect(ports.identify(key)).rejects.toThrow("authorization_denied");
  });

  it("binds to exactly one presented credential so foreign evidence can never authorise as it", async () => {
    const { resolve, ports } = bind();
    for (const evidence of [foreignKey, key.slice(0, -1), `${key} `, "", undefined, null, 42, Object(key), Buffer.from(key, "utf8"), { key }]) {
      await expect(ports.identify(evidence)).rejects.toThrow("authorization_denied");
    }
    expect(resolve).not.toHaveBeenCalled();
    await expect(ports.identify(key.concat(""))).resolves.toEqual(principal);
    await expect(bind(resolved(), 42).ports.identify(42)).rejects.toThrow("authorization_denied");
  });

  it("rejects any action other than the one backend action", async () => {
    const { resolve, ports } = bind();
    for (const action of ["delivery:evidence:recorded", "", undefined, null, Object(BACKEND_ACTION)]) {
      await expect(ports.resolve(principal, action)).rejects.toThrow("authorization_denied");
      await expect(ports.refresh(principal, scope, action)).rejects.toThrow("authorization_denied");
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects a handed principal or scope that diverges from what the database now reports", async () => {
    const { ports } = bind();
    for (const handed of [{ ...principal, subjectId: "other" }, { ...principal, credentialRevision: "2" }, { ...principal, subjectId: 1 }, { ...principal, expiresAtMs: 1 }]) {
      await expect(ports.resolve(handed, BACKEND_ACTION)).rejects.toThrow("authorization_denied");
      await expect(ports.refresh(handed, scope, BACKEND_ACTION)).rejects.toThrow("authorization_denied");
    }
    for (const handed of [{ ...scope, scopeId: "other" }, { ...scope, environment: "production" }, { ...scope, membershipRevision: "3" }, { ...scope, active: false }, { ...scope, membershipExpiresAtMs: 1 }]) {
      await expect(ports.refresh(principal, handed, BACKEND_ACTION)).rejects.toThrow("authorization_denied");
    }
  });

  it("rejects hostile principal and scope descriptors", async () => {
    const { ports } = bind();
    const hostile: readonly unknown[] = [undefined, null, 42, "principal", [principal], { ...principal, extra: true }, without(principal, "expiresAtMs"),
      Object.assign(Object.create(null) as object, principal), new Proxy({ ...principal }, {}), revoke({ ...principal }),
      Object.defineProperty({ ...principal }, "subjectId", { get: () => "synthetic-subject", enumerable: true, configurable: true }),
      Object.defineProperty({ ...principal }, "subjectId", { value: "synthetic-subject", enumerable: false, configurable: true })];
    for (const handed of hostile) await expect(ports.resolve(handed, BACKEND_ACTION)).rejects.toThrow("authorization_denied");
    for (const handed of [...hostile, new Proxy({ ...scope }, {}), { ...scope, extra: true }, without(scope, "active")]) {
      await expect(ports.refresh(principal, handed, BACKEND_ACTION)).rejects.toThrow("authorization_denied");
    }
  });

  it("returns ports that always reject when the factory input is hostile", async () => {
    const resolve = () => Promise.resolve(resolved());
    const hostile: readonly unknown[] = [undefined, null, 42, {}, { resolver: null, presentedKey: key }, { resolver: {}, presentedKey: key },
      { resolver: { resolve: 42 }, presentedKey: key }, { resolver: { resolve, extra: 1 }, presentedKey: key }, { resolver: { resolve } },
      { resolver: { resolve }, presentedKey: key, extra: 1 }, new Proxy({ resolver: { resolve }, presentedKey: key }, {}),
      { resolver: new Proxy({ resolve }, {}), presentedKey: key }, Object.assign(Object.create(null) as object, { resolver: { resolve }, presentedKey: key }),
      [{ resolver: { resolve }, presentedKey: key }], revoke({ resolver: { resolve }, presentedKey: key }),
      Object.defineProperty({ presentedKey: key }, "resolver", { get: () => ({ resolve }), enumerable: true, configurable: true })];
    for (const dependencies of hostile) {
      const ports = createPosBackendScopeAuthorityPorts(dependencies);
      await expect(ports.identify(key)).rejects.toThrow("authorization_denied");
      await expect(ports.resolve(principal, BACKEND_ACTION)).rejects.toThrow("authorization_denied");
      await expect(ports.refresh(principal, scope, BACKEND_ACTION)).rejects.toThrow("authorization_denied");
    }
  });

  it("rejects every denial, malformed resolution and resolver failure", async () => {
    const outcomes: readonly unknown[] = [denied, undefined, null, 42, { ok: true }, { ok: "true", value: row }, Object.freeze({ ok: true, value: undefined }),
      resolved([row]), resolved({ ...row, extra: 1 }), resolved(without(row, "scopeId")), new Proxy(resolved(), {}), resolved({ ...row, subjectId: "" }),
      resolved({ ...row, credentialRevision: 1 }), resolved({ ...row, credentialExpiresAtMs: 1.5 }), resolved({ ...row, scopeId: null }),
      resolved({ ...row, environment: "testecf" }), resolved({ ...row, membershipRevision: " " }), resolved({ ...row, membershipExpiresAtMs: -1 })];
    for (const outcome of outcomes) {
      const ports = createPosBackendScopeAuthorityPorts({ resolver: { resolve: () => Promise.resolve(outcome) }, presentedKey: key });
      await expect(ports.identify(key)).rejects.toThrow("authorization_denied");
      await expect(ports.refresh(principal, scope, BACKEND_ACTION)).rejects.toThrow("authorization_denied");
    }
    for (const resolve of [vi.fn(() => Promise.reject(new Error(`driver failed for ${key}`))), vi.fn(() => { throw new Error(`driver failed for ${key}`); })]) {
      await expect(createPosBackendScopeAuthorityPorts({ resolver: { resolve }, presentedKey: key }).identify(key)).rejects.toThrow("authorization_denied");
    }
  });

  it("rejects with one detail-free value that never carries the credential or a driver failure", async () => {
    const failing = vi.fn(() => Promise.reject(new Error(`28P01 while resolving ${key}`)));
    const ports = createPosBackendScopeAuthorityPorts({ resolver: { resolve: failing }, presentedKey: key });
    const first = await rejection(ports.identify(key));
    const second = await rejection(ports.refresh(principal, scope, BACKEND_ACTION));
    const third = await rejection(bind().ports.identify(foreignKey));
    expect(first).toBeInstanceOf(Error);
    expect(second).toBe(first);
    expect(third).toBe(first);
    for (const rendered of [String(first), JSON.stringify(first), inspect(first, { depth: null }), (first as Error).stack ?? ""]) {
      expect(rendered).not.toContain(secret);
      expect(rendered).not.toContain(keyId);
      expect(rendered).not.toContain(key);
      expect(rendered).not.toContain("28P01");
    }
  });

  it("drives a real authority end to end through the composed dependencies", async () => {
    const { resolve, ports } = bind();
    const clock = () => ({ monotonicMs: 10, wallMs: 1_699_999_999_000 });
    const authority = createBackendScopeAuthority({ ...ports, clock, maxTtlMs: 60_000 });
    const issued = await authority.issue(BACKEND_ACTION, key);
    if (!issued.ok) throw new Error("expected a capability");
    await expect(authority.use(issued.value, BACKEND_ACTION, (context) => context.scopeId)).resolves.toEqual({ ok: true, value: "synthetic-scope" });
    expect(resolve).toHaveBeenCalledTimes(3);
    await expect(createBackendScopeAuthority({ ...ports, clock, maxTtlMs: 60_000 }).issue(BACKEND_ACTION, foreignKey)).resolves.toEqual({ ok: false, error: "authorization_denied" });
  });
});
