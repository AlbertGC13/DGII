import { describe, expect, it } from "vitest";

import * as api from "../../../index.js";

const accepted = Object.freeze({ trackId: "track-188", codigo: 1 as const, classification: "accepted" as const, estado: "accepted", rnc: null, eNCF: null, fechaRecepcion: null, mensajes: Object.freeze([]), secuenciaUtilizada: null, sequenceDisposition: null });
const pending = Object.freeze({ ...accepted, codigo: 3 as const, classification: "in-process" as const });
type Options = Partial<{ now: () => number; sleep: (delay: number, signal: AbortSignal) => Promise<void>; random: () => number; consult: () => Promise<unknown> }>;

function scheduler(options: Options = {}) {
  let time = 0; const delays: number[] = []; let calls = 0;
  const result = api.createDgiiResultPollingScheduler({
    clock: options.now ?? (() => time),
    sleeper: options.sleep ?? ((delay) => { delays.push(delay); time += delay; return Promise.resolve(); }),
    random: options.random ?? (() => 0.5),
    consultation: { consult: async () => { calls += 1; return options.consult ? options.consult() : Object.freeze({ ok: true as const, value: accepted }); } },
  });
  expect(result.ok).toBe(true); if (!result.ok) throw new Error("Expected scheduler.");
  return { poll: result.value.poll, run: (input: { trackId?: string; receivedAt?: number; signal?: AbortSignal } = {}) => result.value.poll({ trackId: "track-188", receivedAt: 0, ...input }), delays, calls: () => calls, setTime: (value: number) => { time = value; } };
}

describe("DGII result polling scheduler", () => {
  it("waits before its first consultation, clamps the last sleep, and never consults at the deadline", async () => {
    const subject = scheduler({ consult: () => Promise.resolve(Object.freeze({ ok: true as const, value: pending })) });
    await expect(subject.run()).resolves.toEqual({ kind: "PENDING_RECONCILIATION", trackId: "track-188", lastEvidence: pending });
    expect(subject.delays).toEqual([1000, 2000, 5000, 15000, 30000, 30000, 30000, 7000]);
    expect(subject.calls()).toBe(7);
  });

  it("uses inclusive jitter boundaries and snapshots immutable terminal evidence", async () => {
    const subject = scheduler({ random: () => 1 });
    const output = await subject.run();
    expect(subject.delays).toEqual([1250]);
    expect(output).toEqual({ kind: "TERMINAL", trackId: "track-188", evidence: accepted });
    if (output.kind !== "TERMINAL") throw new Error("Expected terminal output.");
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.evidence)).toBe(true);
    expect(Object.isFrozen(output.evidence.mensajes)).toBe(true);
    expect(output.evidence).not.toBe(accepted);
  });

  it("retains bounded rejection evidence with optional values", async () => {
    const rejected = Object.freeze({ ...accepted, codigo: 2 as const, classification: "rejected" as const, rnc: "101010101", eNCF: "E310000000001", fechaRecepcion: "2026-08-13", mensajes: Object.freeze(["Rejected"]), secuenciaUtilizada: true, sequenceDisposition: "consumed-non-reusable" as const });
    await expect(scheduler({ consult: () => Promise.resolve(Object.freeze({ ok: true as const, value: rejected })) }).run()).resolves.toEqual({ kind: "TERMINAL", trackId: "track-188", evidence: rejected });
  });

  it("returns the fixed error for invalid TrackIds and hostile dependencies", async () => {
    const invalid = [null, {}, { clock() { return 0; }, sleeper() {}, random() { return 0.5; }, consultation: {} }, Object.freeze({ clock: () => 0, sleeper: () => Promise.resolve(), random: () => 0.5, consultation: Object.freeze({ consult: () => Promise.resolve(Object.freeze({ ok: true, value: accepted })) }), then() {} }), new Proxy({}, { getPrototypeOf() { throw new Error("synthetic"); } })];
    for (const value of invalid) expect(api.createDgiiResultPollingScheduler(value)).toEqual({ ok: false, error: { code: "INVALID_DGII_RESULT_POLLING_SCHEDULER_CONFIGURATION" } });
    const subject = scheduler();
    for (const trackId of ["", " ", "\u0000", "x".repeat(257)]) await expect(subject.run({ trackId })).resolves.toEqual({ kind: "SCHEDULER_ERROR", trackId: "" });
    await expect(subject.run({ receivedAt: Number.MAX_SAFE_INTEGER })).resolves.toEqual({ kind: "SCHEDULER_ERROR", trackId: "" });
    await expect(subject.poll([] as never)).resolves.toEqual({ kind: "SCHEDULER_ERROR", trackId: "" });
    await expect(subject.poll(new Proxy({}, { getPrototypeOf() { throw new Error("synthetic"); } }) as never)).resolves.toEqual({ kind: "SCHEDULER_ERROR", trackId: "" });
  });

  it("rejects throwing, nonfinite, unsafe, and regressing clock readings without extending the deadline", async () => {
    for (const now of [() => { throw new Error("synthetic"); }, () => Number.NaN, () => Number.MAX_SAFE_INTEGER + 1]) {
      await expect(scheduler({ now }).run()).resolves.toEqual({ kind: "SCHEDULER_ERROR", trackId: "track-188" });
    }
    let reads = 0;
    await expect(scheduler({ now: () => (++reads === 1 ? 0 : -1) }).run()).resolves.toEqual({ kind: "SCHEDULER_ERROR", trackId: "track-188" });
  });

  it("requires the monotonic clock to advance by every requested positive sleep", async () => {
    const frozenClock = scheduler({ now: () => 0, sleep: () => Promise.resolve() });
    await expect(frozenClock.run()).resolves.toEqual({ kind: "SCHEDULER_ERROR", trackId: "track-188" });
    expect(frozenClock.calls()).toBe(0);
    let reads = 0;
    const stalledClock = scheduler({ now: () => [0, 1000, 1000][reads++] as number, sleep: () => Promise.resolve(), consult: () => Promise.resolve(Object.freeze({ ok: true as const, value: pending })) });
    await expect(stalledClock.run()).resolves.toEqual({ kind: "SCHEDULER_ERROR", trackId: "track-188" });
    expect(stalledClock.calls()).toBe(1);
  });

  it("cancels before, during, and immediately before consultation, but preserves an in-flight result", async () => {
    const before = new AbortController(); before.abort();
    await expect(scheduler().run({ signal: before.signal })).resolves.toEqual({ kind: "CANCELLED", trackId: "track-188" });
    const during = new AbortController();
    await expect(scheduler({ sleep: () => { during.abort(); return Promise.resolve(); } }).run({ signal: during.signal })).resolves.toEqual({ kind: "CANCELLED", trackId: "track-188" });
    const race = new AbortController(); let racedCalls = 0;
    const raceScheduler = api.createDgiiResultPollingScheduler({ clock: () => 0, sleeper: () => new Promise<void>((resolve) => { queueMicrotask(() => { race.abort(); resolve(); }); }), random: () => 0.5, consultation: { consult: () => { racedCalls += 1; return Promise.resolve(Object.freeze({ ok: true as const, value: accepted })); } } });
    expect(raceScheduler.ok).toBe(true); if (!raceScheduler.ok) throw new Error("Expected scheduler.");
    await expect(raceScheduler.value.poll({ trackId: "track-188", receivedAt: 0, signal: race.signal })).resolves.toEqual({ kind: "CANCELLED", trackId: "track-188" });
    expect(racedCalls).toBe(0);
    const afterClock = new AbortController(); let clockReads = 0;
    await expect(scheduler({ now: () => { clockReads += 1; if (clockReads === 2) { afterClock.abort(); } return 1; } }).run({ signal: afterClock.signal })).resolves.toEqual({ kind: "CANCELLED", trackId: "track-188" });
    let signalReads = 0;
    const lateSignal = { get aborted() { signalReads += 1; return signalReads === 5; } } as AbortSignal;
    await expect(scheduler().run({ signal: lateSignal })).resolves.toEqual({ kind: "CANCELLED", trackId: "track-188" });
    const inFlight = new AbortController(); let calls = 0;
    await expect(scheduler({ consult: () => { calls += 1; inFlight.abort(); return Promise.resolve(Object.freeze({ ok: true as const, value: accepted })); } }).run({ signal: inFlight.signal })).resolves.toEqual({ kind: "TERMINAL", trackId: "track-188", evidence: accepted });
    expect(calls).toBe(1);
  });

  it("contains random, sleeper, consultation, and hostile result failures", async () => {
    const hostileThenable = Object.freeze(Object.defineProperty({ ok: true, value: accepted }, "then", { get() { throw new Error("synthetic"); } }));
    const hostileEvidence = new Proxy(accepted, { getPrototypeOf() { throw new Error("synthetic"); } });
    const sparseMensajes = Object.freeze(Object.assign(new Array<string>(2), { 0: "Rejected" }));
    const proxiedSparseMensajes = new Proxy(sparseMensajes, {});
    const invalidResults = [null, hostileThenable, Object.freeze({ ok: "yes" }), Object.freeze({ ok: true, value: { ...accepted } }), Object.freeze({ ok: true, value: Object.freeze({ ...accepted, mensajes: [] }) }), Object.freeze({ ok: true, value: Object.freeze({ ...accepted, mensajes: sparseMensajes }) }), Object.freeze({ ok: true, value: Object.freeze({ ...accepted, mensajes: proxiedSparseMensajes }) }), Object.freeze({ ok: true, value: Object.freeze({ ...accepted, rnc: "" }) }), Object.freeze({ ok: true, value: Object.freeze({ ...accepted, secuenciaUtilizada: "yes" }) }), Object.freeze({ ok: true, value: Object.freeze({ ...accepted, sequenceDisposition: "unknown" }) }), Object.freeze({ ok: true, value: Object.freeze({ ...accepted, codigo: 9 }) }), Object.freeze({ ok: true, value: hostileEvidence }), Object.freeze({ ok: false, error: Object.freeze({ code: "internal" }) }), new Proxy({}, { getPrototypeOf() { throw new Error("synthetic"); } })];
    for (const consult of invalidResults.map((result) => () => Promise.resolve(result))) await expect(scheduler({ consult }).run()).resolves.toEqual({ kind: "SCHEDULER_ERROR", trackId: "track-188" });
    await expect(scheduler({ random: () => -1 }).run()).resolves.toEqual({ kind: "SCHEDULER_ERROR", trackId: "track-188" });
    await expect(scheduler({ now: () => 120000 }).run()).resolves.toEqual({ kind: "PENDING_RECONCILIATION", trackId: "track-188" });
    await expect(scheduler({ sleep: () => Promise.reject(new Error("synthetic")) }).run()).resolves.toEqual({ kind: "SCHEDULER_ERROR", trackId: "track-188" });
    await expect(scheduler({ consult: () => Promise.reject(new Error("synthetic")) }).run()).resolves.toEqual({ kind: "SCHEDULER_ERROR", trackId: "track-188" });
  });
});

it("exports the scheduler from the package root", () => { expect(api.createDgiiResultPollingScheduler).toBeTypeOf("function"); });
