import { describe, expect, it, vi } from "vitest";

import { createBackendScopeAuthority } from "./backend-scope-authority.js";

const action = "delivery:evidence:record" as const;
const principal = { subjectId: "synthetic-principal", credentialRevision: "credential-1", expiresAtMs: 1_100 };
const scope = { scopeId: "synthetic-scope", environment: "TesteCF" as const, membershipRevision: "membership-1", membershipExpiresAtMs: 1_050, active: true as const };
const setup = (overrides: Record<string, unknown> = {}) => {
  const identify = vi.fn().mockResolvedValue(principal);
  const resolve = vi.fn().mockResolvedValue(scope);
  const refresh = vi.fn().mockResolvedValue({ principal, scope });
  const clock = vi.fn(() => ({ monotonicMs: 10, wallMs: 1_000 }));
  return { authority: createBackendScopeAuthority({ identify, resolve, refresh, clock, maxTtlMs: 500, ...overrides }), identify, resolve, refresh, clock };
};

describe("backend scope authority", () => {
  it("issues an opaque capability only for the exact action and supplies scope only to its operation", async () => {
    const { authority } = setup();
    await expect(authority.issue(action, { request: "synthetic" })).resolves.toMatchObject({ ok: true });
    const issued = await authority.issue(action, {});
    if (!issued.ok) throw new Error("expected capability");
    expect(Object.keys(issued.value)).toEqual([]);
    expect(JSON.stringify(issued.value)).toBeUndefined();
    expect(() => structuredClone(issued.value)).toThrow();
    expect(issued.value).toThrow("opaque capability");
    await expect(authority.use(issued.value, action, (context) => context.scopeId)).resolves.toEqual({ ok: true, value: "synthetic-scope" });
    await expect(authority.issue("wrong-action", {})).resolves.toEqual({ ok: false, error: "authorization_denied" });
  });

  it("burns synchronously so precisely one concurrent caller reaches refresh and downstream", async () => {
    const { authority, refresh } = setup(); const issued = await authority.issue(action, {});
    if (!issued.ok) throw new Error("expected capability");
    const downstream = vi.fn(() => "recorded");
    await expect(Promise.all([authority.use(issued.value, action, downstream), authority.use(issued.value, action, downstream)])).resolves.toEqual([{ ok: true, value: "recorded" }, { ok: false, error: "authorization_denied" }]);
    expect(refresh).toHaveBeenCalledTimes(1); expect(downstream).toHaveBeenCalledTimes(1);
  });

  it("burns before every failure and fails closed for stale scope, rejected ports, and downstream errors", async () => {
    for (const refresh of [vi.fn().mockResolvedValue({ principal, scope: { ...scope, membershipRevision: "changed" } }), vi.fn().mockResolvedValue({ principal: { ...principal, credentialRevision: "changed" }, scope }), vi.fn().mockRejectedValue(new Error("secret")), vi.fn().mockResolvedValue(new Proxy({}, { ownKeys: () => { throw new Error("secret"); } }))]) {
      const { authority } = setup({ refresh }); const issued = await authority.issue(action, {}); if (!issued.ok) throw new Error("expected capability");
      await expect(authority.use(issued.value, action, () => "unexpected")).resolves.toEqual({ ok: false, error: "authorization_denied" });
      await expect(authority.use(issued.value, action, () => "unexpected")).resolves.toEqual({ ok: false, error: "authorization_denied" });
    }
    const { authority } = setup(); const issued = await authority.issue(action, {}); if (!issued.ok) throw new Error("expected capability");
    await expect(authority.use(issued.value, action, () => { throw new Error("secret"); })).resolves.toEqual({ ok: false, error: "operation_failed" });
    await expect(authority.use(issued.value, action, () => "unexpected")).resolves.toEqual({ ok: false, error: "authorization_denied" });
  });

  it("rejects hostile initial dependencies, expiry, clock regression, forged and foreign capabilities", async () => {
    for (const configured of [setup({ identify: vi.fn().mockResolvedValue({ ...principal, extra: true }) }), setup({ resolve: vi.fn().mockResolvedValue({ ...scope, [Symbol("extra")]: true }) }), setup({ clock: () => ({ monotonicMs: Number.NaN, wallMs: 1_000 }) }), setup({ maxTtlMs: 0 })]) await expect(configured.authority.issue(action, {})).resolves.toEqual({ ok: false, error: "authorization_denied" });
    const clock = vi.fn().mockReturnValueOnce({ monotonicMs: 10, wallMs: 1_000 }).mockReturnValueOnce({ monotonicMs: 9, wallMs: 1_001 });
    const { authority } = setup({ clock }); const issued = await authority.issue(action, {}); if (!issued.ok) throw new Error("expected capability");
    await expect(authority.use(issued.value, action, () => "unexpected")).resolves.toEqual({ ok: false, error: "authorization_denied" });
    const first = setup(); const second = setup(); const capability = await first.authority.issue(action, {}); if (!capability.ok) throw new Error("expected capability");
    await expect(second.authority.use(capability.value, action, () => "unexpected")).resolves.toEqual({ ok: false, error: "authorization_denied" });
    await expect(first.authority.use(new Proxy(capability.value, {}), action, () => "unexpected")).resolves.toEqual({ ok: false, error: "authorization_denied" });
    await expect(first.authority.use(() => undefined, action, () => "unexpected")).resolves.toEqual({ ok: false, error: "authorization_denied" });
  });

  it("rejects expiration at issue and use, wrong use actions, revoked proxies, and stale fresh expiry", async () => {
    const expired = setup({ clock: () => ({ monotonicMs: 10, wallMs: 1_050 }) });
    await expect(expired.authority.issue(action, {})).resolves.toEqual({ ok: false, error: "authorization_denied" });
    const clock = vi.fn().mockReturnValueOnce({ monotonicMs: 10, wallMs: 1_000 }).mockReturnValueOnce({ monotonicMs: 11, wallMs: 1_050 });
    const authority = setup({ clock, refresh: vi.fn().mockResolvedValue({ principal, scope: { ...scope, membershipExpiresAtMs: 1_050 } }) }); const issued = await authority.authority.issue(action, {}); if (!issued.ok) throw new Error("expected capability");
    await expect(authority.authority.use(issued.value, "wrong-action", () => "unexpected")).resolves.toEqual({ ok: false, error: "authorization_denied" });
    await expect(authority.authority.use(issued.value, action, () => "unexpected")).resolves.toEqual({ ok: false, error: "authorization_denied" });
    const valid = setup(); const capability = await valid.authority.issue(action, {}); if (!capability.ok) throw new Error("expected capability"); const revoked = Proxy.revocable(capability.value, {}); revoked.revoke();
    await expect(valid.authority.use(revoked.proxy, action, () => "unexpected")).resolves.toEqual({ ok: false, error: "authorization_denied" });
    const regressed = setup({ clock: vi.fn().mockReturnValueOnce({ monotonicMs: 10, wallMs: 1_000 }).mockReturnValueOnce({ monotonicMs: 11, wallMs: 999 }) }); const regressedCapability = await regressed.authority.issue(action, {}); if (!regressedCapability.ok) throw new Error("expected capability");
    await expect(regressed.authority.use(regressedCapability.value, action, () => "unexpected")).resolves.toEqual({ ok: false, error: "authorization_denied" });
  });

  it("fails closed for every environment and descriptor or fresh-result ambiguity", async () => {
    for (const environment of ["CerteCF", "production"] as const) await expect(setup({ resolve: vi.fn().mockResolvedValue({ ...scope, environment }) }).authority.issue(action, {})).resolves.toMatchObject({ ok: true });
    const descriptorTrap = new Proxy({ ...scope }, { getOwnPropertyDescriptor: () => undefined });
    await expect(setup({ resolve: vi.fn().mockResolvedValue(descriptorTrap) }).authority.issue(action, {})).resolves.toEqual({ ok: false, error: "authorization_denied" });
    await expect(setup({ resolve: vi.fn().mockResolvedValue(new Proxy({}, { getPrototypeOf: () => { throw new Error("secret"); } })) }).authority.issue(action, {})).resolves.toEqual({ ok: false, error: "authorization_denied" });
    for (const fresh of [null, { principal: {}, scope }, { principal, scope: {} }]) {
      const configured = setup({ refresh: vi.fn().mockResolvedValue(fresh) }); const issued = await configured.authority.issue(action, {}); if (!issued.ok) throw new Error("expected capability");
      await expect(configured.authority.use(issued.value, action, () => "unexpected")).resolves.toEqual({ ok: false, error: "authorization_denied" });
    }
    const symbolScope = { ...scope } as Record<string | symbol, unknown>; delete symbolScope["active"]; symbolScope[Symbol("active")] = true;
    await expect(setup({ resolve: vi.fn().mockResolvedValue(symbolScope) }).authority.issue(action, {})).resolves.toEqual({ ok: false, error: "authorization_denied" });
    const accessorScope = { ...scope }; Object.defineProperty(accessorScope, "active", { enumerable: true, get: () => true });
    await expect(setup({ resolve: vi.fn().mockResolvedValue(accessorScope) }).authority.issue(action, {})).resolves.toEqual({ ok: false, error: "authorization_denied" });
  });

  it("denies after refresh crosses any capability or fresh authorization expiry and burns the capability", async () => {
    const longPrincipal = { ...principal, expiresAtMs: 2_000 };
    const longScope = { ...scope, membershipExpiresAtMs: 2_000 };
    for (const [fresh, expiry] of [
      [{ principal: longPrincipal, scope: longScope }, 1_500],
      [{ principal: { ...longPrincipal, expiresAtMs: 1_100 }, scope: longScope }, 1_100],
      [{ principal: longPrincipal, scope: { ...longScope, membershipExpiresAtMs: 1_100 } }, 1_100],
    ] as const) {
      const clock = vi.fn().mockReturnValueOnce({ monotonicMs: 10, wallMs: 1_000 }).mockReturnValueOnce({ monotonicMs: 11, wallMs: 1_001 }).mockReturnValueOnce({ monotonicMs: 12, wallMs: expiry });
      const refresh = vi.fn(() => fresh);
      const { authority } = setup({ identify: vi.fn().mockResolvedValue(longPrincipal), resolve: vi.fn().mockResolvedValue(longScope), refresh, clock });
      const issued = await authority.issue(action, {}); if (!issued.ok) throw new Error("expected capability");
      const operation = vi.fn(() => "unexpected");
      await expect(authority.use(issued.value, action, operation)).resolves.toEqual({ ok: false, error: "authorization_denied" });
      await expect(authority.use(issued.value, action, operation)).resolves.toEqual({ ok: false, error: "authorization_denied" });
      expect(operation).not.toHaveBeenCalled(); expect(refresh).toHaveBeenCalledTimes(1);
    }
  });

  it("contains hostile dependency access, ports, thenables, and post-refresh clocks without diagnostics", async () => {
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const denied = { ok: false, error: "authorization_denied" };
    const hostileThenable = { get then(): never { throw new Error("secret"); } };
    for (const configured of [
      setup({ identify: () => { throw new Error("secret"); } }),
      setup({ identify: vi.fn().mockRejectedValue(new Error("secret")) }),
      setup({ identify: () => hostileThenable as unknown as Promise<typeof principal> }),
      setup({ resolve: () => { throw new Error("secret"); } }),
      setup({ resolve: vi.fn().mockRejectedValue(new Error("secret")) }),
      setup({ resolve: () => hostileThenable as unknown as Promise<typeof scope> }),
      setup({ clock: () => { throw new Error("secret"); } }),
      setup({ maxTtlMs: Number.NaN }),
    ]) await expect(configured.authority.issue(action, {})).resolves.toEqual(denied);
    for (const key of ["identify", "resolve", "refresh", "clock", "maxTtlMs"] as const) {
      const dependencies = { identify: vi.fn().mockResolvedValue(principal), resolve: vi.fn().mockResolvedValue(scope), refresh: vi.fn().mockResolvedValue({ principal, scope }), clock: vi.fn(() => ({ monotonicMs: 10, wallMs: 1_000 })), maxTtlMs: 500 };
      Object.defineProperty(dependencies, key, { enumerable: true, get: () => { throw new Error("secret"); } });
      await expect(createBackendScopeAuthority(dependencies).issue(action, {})).resolves.toEqual(denied);
    }
    await expect(createBackendScopeAuthority(new Proxy({}, { ownKeys: () => { throw new Error("secret"); } }) as never).issue(action, {})).resolves.toEqual(denied);
    await expect(createBackendScopeAuthority(new Proxy({ identify: vi.fn(), resolve: vi.fn(), refresh: vi.fn(), clock: vi.fn(), maxTtlMs: 500 }, { getOwnPropertyDescriptor: () => { throw new Error("secret"); } }) as never).issue(action, {})).resolves.toEqual(denied);
    await expect(createBackendScopeAuthority(new Proxy({ identify: vi.fn(), resolve: vi.fn(), refresh: vi.fn(), clock: vi.fn(), maxTtlMs: 500 }, { getOwnPropertyDescriptor: (target, key) => { if (key === "maxTtlMs") throw new Error("secret"); return Reflect.getOwnPropertyDescriptor(target, key); } }) as never).issue(action, {})).resolves.toEqual(denied);
    for (const clock of [
      vi.fn().mockReturnValueOnce({ monotonicMs: 10, wallMs: 1_000 }).mockReturnValueOnce({ monotonicMs: 11, wallMs: 1_001 }).mockImplementation(() => { throw new Error("secret"); }),
      vi.fn().mockReturnValueOnce({ monotonicMs: 10, wallMs: 1_000 }).mockReturnValueOnce({ monotonicMs: 11, wallMs: 1_001 }).mockReturnValueOnce({ monotonicMs: 12, wallMs: Number.NaN }),
      vi.fn().mockReturnValueOnce({ monotonicMs: 10, wallMs: 1_000 }).mockReturnValueOnce({ monotonicMs: 11, wallMs: 1_001 }).mockReturnValueOnce({ monotonicMs: 10, wallMs: 1_002 }),
    ]) {
      const { authority } = setup({ clock, refresh: () => hostileThenable as unknown as Promise<{ principal: typeof principal; scope: typeof scope }> }); const issued = await authority.issue(action, {}); if (!issued.ok) throw new Error("expected capability");
      await expect(authority.use(issued.value, action, () => "unexpected")).resolves.toEqual(denied);
      await expect(authority.use(issued.value, action, () => "unexpected")).resolves.toEqual(denied);
    }
    expect(diagnostics).not.toHaveBeenCalled(); diagnostics.mockRestore();
  });
});
