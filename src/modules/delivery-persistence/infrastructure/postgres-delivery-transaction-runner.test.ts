import { describe, expect, it, vi } from "vitest";

import { createPostgresDeliveryTransactionRunner } from "./postgres-delivery-transaction-runner.js";

const configured = (connect = vi.fn()) => createPostgresDeliveryTransactionRunner({ connectionSource: { connect }, scopeId: "synthetic-scope" });
const client = (query = vi.fn().mockResolvedValue({ rows: [] }), release = vi.fn()) => ({ query, release });

describe("PostgreSQL delivery transaction runner", () => {
  it("uses one fresh client, commits a successful callback, releases it, and retains only its value", async () => {
    const first = client(); const second = client(); const connect = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const runner = configured(connect);

    await expect(runner.run(async (persistence) => ({ prepared: await persistence.prepareAttempt({ allocationKey: "allocation", attemptKey: "attempt", environment: "TesteCF", signedXmlSha256: "a".repeat(64), eNcf: "E310000000001", issuerRnc: "101010101" }) }))).resolves.toEqual({ outcome: "committed", value: { prepared: { outcome: "persistence_unavailable" } } });
    await expect(runner.run(() => Promise.resolve("second"))).resolves.toEqual({ outcome: "committed", value: "second" });

    expect(connect).toHaveBeenCalledTimes(2);
    expect(first.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(first.query).toHaveBeenNthCalledWith(2, "SELECT outcome, attempt_no FROM prepare_ecf31_delivery_attempt($1, $2, $3, $4, $5, $6, $7, $8)", ["synthetic-scope", "E31", "allocation", "attempt", "testecf", "a".repeat(64), "E310000000001", "101010101"]);
    expect(first.query).toHaveBeenNthCalledWith(3, "COMMIT");
    expect(second.query).toHaveBeenCalledWith("BEGIN");
    expect(second.query).toHaveBeenCalledWith("COMMIT");
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(second.release).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(await runner.run(() => Promise.resolve("immutable")))).toBe(true);
  });

  it("rolls back callback failures without exposing their payload or committing", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] }); const release = vi.fn(); const runner = configured(vi.fn().mockResolvedValue(client(query, release)));
    const result = await runner.run(() => Promise.reject(new Error("synthetic internal diagnostic")));

    expect(result).toEqual({ outcome: "rolled_back" });
    expect(JSON.stringify(result)).not.toContain("synthetic internal diagnostic");
    expect(query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(query).toHaveBeenNthCalledWith(2, "ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("contains connection, transaction, and release failures without false durability", async () => {
    const failure = new Error("synthetic internal diagnostic");
    const scenarios = [
      configured(vi.fn().mockRejectedValue(failure)),
      configured(vi.fn().mockResolvedValue(client(vi.fn().mockRejectedValue(failure)))),
      configured(vi.fn().mockResolvedValue(client(vi.fn().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(failure)))),
      configured(vi.fn().mockResolvedValue(client(vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }), vi.fn().mockRejectedValue(failure)))),
      configured(vi.fn().mockResolvedValue(client(vi.fn().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(failure)))),
    ];

    for (const runner of scenarios) {
      const result = await runner.run(() => Promise.resolve("value"));
      expect(result).toEqual({ outcome: "transaction_unavailable" });
      expect(JSON.stringify(result)).not.toContain("synthetic internal diagnostic");
    }
    const rollbackFailure = configured(vi.fn().mockResolvedValue(client(vi.fn().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(failure))));
    await expect(rollbackFailure.run(() => Promise.reject(failure))).resolves.toEqual({ outcome: "transaction_unavailable" });
    const rollbackReleaseFailure = configured(vi.fn().mockResolvedValue(client(vi.fn().mockResolvedValue({ rows: [] }), vi.fn().mockRejectedValue(failure))));
    await expect(rollbackReleaseFailure.run(() => Promise.reject(failure))).resolves.toEqual({ outcome: "transaction_unavailable" });
  });

  it("rejects hostile factory and run boundaries before any database work", async () => {
    const connect = vi.fn(); const accessor = {};
    Object.defineProperty(accessor, "connectionSource", { enumerable: true, get: () => { throw new Error("synthetic trap"); } });
    for (const input of [null, {}, { connectionSource: {}, scopeId: "scope" }, { connectionSource: { connect }, scopeId: "scope", extra: true }, Object.assign(Object.create({}), { connectionSource: { connect }, scopeId: "scope" }), accessor, new Proxy({}, { ownKeys: () => { throw new Error("synthetic trap"); } })]) {
      await expect(createPostgresDeliveryTransactionRunner(input).run(() => Promise.resolve("value"))).resolves.toEqual({ outcome: "transaction_unavailable" });
    }
    const runner = configured(connect);
    for (const work of [null, {}, new Proxy(() => Promise.resolve("value"), {})]) await expect(runner.run(work as never)).resolves.toEqual({ outcome: "transaction_unavailable" });
    await expect(configured(vi.fn().mockResolvedValue({ query: vi.fn() })).run(() => Promise.resolve("value"))).resolves.toEqual({ outcome: "transaction_unavailable" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("accepts prototype data methods while releasing safely inspectable malformed clients", async () => {
    const calls: string[] = [];
    class NativeClient {
      query(text: string) { calls.push(text); return Promise.resolve({ rows: [] }); }
      release() { calls.push("release"); }
    }
    await expect(configured(vi.fn().mockResolvedValue(new NativeClient())).run(() => Promise.resolve("native"))).resolves.toEqual({ outcome: "committed", value: "native" });
    expect(calls).toEqual(["BEGIN", "COMMIT", "release"]);

    const released = vi.fn(); const accessor = {};
    Object.defineProperty(accessor, "query", { get: () => { throw new Error("synthetic trap"); } });
    Object.setPrototypeOf(accessor, { release: released });
    await expect(configured(vi.fn().mockResolvedValue(accessor)).run(() => Promise.resolve("value"))).resolves.toEqual({ outcome: "transaction_unavailable" });
    expect(released).toHaveBeenCalledOnce();
    const proxyMethodReleased = vi.fn();
    await expect(configured(vi.fn().mockResolvedValue({ query: new Proxy(() => Promise.resolve({ rows: [] }), {}), release: proxyMethodReleased })).run(() => Promise.resolve("value"))).resolves.toEqual({ outcome: "transaction_unavailable" });
    expect(proxyMethodReleased).toHaveBeenCalledOnce();
    await expect(configured(vi.fn().mockResolvedValue(new Proxy(new NativeClient(), { getPrototypeOf: () => { throw new Error("synthetic trap"); } }))).run(() => Promise.resolve("value"))).resolves.toEqual({ outcome: "transaction_unavailable" });
  });

  it("releases once when query inspection reaches a hostile prototype after a safe release", async () => {
    const trap = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("synthetic trap"); } });
    const ownRelease = vi.fn(); const own = Object.create(trap) as { release?: () => void };
    own.release = ownRelease;
    await expect(configured(vi.fn().mockResolvedValue(own)).run(() => Promise.resolve("value"))).resolves.toEqual({ outcome: "transaction_unavailable" });
    expect(ownRelease).toHaveBeenCalledOnce();

    const inheritedRelease = vi.fn(); const safePrototype = { release: inheritedRelease }; const inherited = Object.create(safePrototype) as object;
    Object.setPrototypeOf(safePrototype, trap);
    await expect(configured(vi.fn().mockResolvedValue(inherited)).run(() => Promise.resolve("value"))).resolves.toEqual({ outcome: "transaction_unavailable" });
    expect(inheritedRelease).toHaveBeenCalledOnce();
  });
});
