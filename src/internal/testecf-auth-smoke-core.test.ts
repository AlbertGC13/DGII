import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { runTesteCfAuthSmoke } from "./testecf-auth-smoke-core.js";

const fixturePath = fileURLToPath(new URL("../../test/fixtures/certificates/synthetic-test-certificate.p12", import.meta.url));
const secret = "synthetic-test-password";
const now = 1_800_000_000_000;
const root = "C:/repository";
const certificatePath = "C:/outside/synthetic.p12";
const seed = '<SemillaModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><valor>synthetic</valor><fecha>2026-08-10T12:00:00Z</fecha></SemillaModel>';
const failure = Object.freeze({ code: "FAIL", durationMs: 0 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function nextTurn() { await Promise.resolve(); await Promise.resolve(); }
async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 32; attempt += 1) { if (condition()) return; await nextTurn(); }
  throw new Error("Synthetic operation did not start.");
}
async function expectSafeFailure(value: unknown, withheld = secret) {
  const result = await runTesteCfAuthSmoke(value);
  expect(result).toEqual(failure);
  expect(JSON.stringify(result)).not.toContain(withheld);
}
async function withFakeDeadline(test: () => Promise<void>) {
  vi.useFakeTimers();
  const deadline = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    const controller = new AbortController(); setTimeout(() => { controller.abort(); }, milliseconds); return controller.signal;
  });
  try { await test(); } finally { deadline.mockRestore(); vi.useRealTimers(); }
}

async function input(overrides: Record<string, unknown> = {}) {
  const bytes = Buffer.from(await readFile(fixturePath));
  const requests: Request[] = [];
  return { requests, bytes, value: {
    secret: { certificatePath, password: secret, rnc: "000000000" },
    fs: { realpath: (path: string) => Promise.resolve(path === root ? root : certificatePath), stat: () => Promise.resolve({ size: bytes.length, isFile: () => true }), readFile: () => Promise.resolve(bytes) },
    repositoryRoot: root, nodeVersion: "24.1.0", env: {}, execArgv: [], clock: () => now,
    executor: (request: Request) => {
      requests.push(request);
      return Promise.resolve(request.method === "GET" ? new Response(seed, { headers: { "content-type": "application/xml" } }) : new Response('{"token":"synthetic-token","expira":"2027-08-10T13:00:00Z","expedido":"2026-08-10T12:00:00Z"}', { headers: { "content-type": "application/json" } }));
    },
    signal: new AbortController().signal,
    ...overrides,
  } };
}

describe("runTesteCfAuthSmoke", () => {
  it("uses only the official two-request TesteCF flow, caches authorize, and clears the P12 buffer", async () => {
    const configured = await input();
    const result = await runTesteCfAuthSmoke(configured.value);
    expect(result).toEqual(Object.freeze({ code: "PASS", durationMs: 0 }));
    expect(Object.isFrozen(result)).toBe(true);
    expect(configured.requests.map((request) => [request.method, request.url, request.headers.has("authorization")])).toEqual([
      ["GET", "https://ecf.dgii.gov.do/testecf/autenticacion/api/autenticacion/semilla", false],
      ["POST", "https://ecf.dgii.gov.do/testecf/autenticacion/api/autenticacion/validarsemilla", false],
    ]);
    expect(configured.bytes.every((byte) => byte === 0)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("contains invalid certificates, date windows, paths, runtime hazards, aborted work, and executor failures", async () => {
    const aborted = new AbortController(); aborted.abort();
    let calls = 0;
    for (const overrides of [
      { secret: { certificatePath, password: "wrong", rnc: "000000000" } }, { secret: { certificatePath, password: secret, rnc: "invalid" } },
      { secret: { certificatePath: "C:/outside/\u0000.p12", password: secret, rnc: "000000000" } },
      { fs: { realpath: () => Promise.resolve(root), stat: () => Promise.resolve({ size: 1, isFile: () => true }), readFile: () => Promise.resolve(Buffer.from("x")) } },
      { fs: { realpath: (path: string) => Promise.resolve(path === root ? root : `${root}/inside.p12`), stat: () => Promise.resolve({ size: 1, isFile: () => true }), readFile: () => Promise.resolve(Buffer.alloc(1)) } },
      { fs: { realpath: (path: string) => Promise.resolve(path === root ? root : certificatePath), stat: () => Promise.resolve({ size: 10_485_761, isFile: () => true }), readFile: () => Promise.resolve(Buffer.alloc(1)) } },
      { fs: { realpath: (path: string) => Promise.resolve(path === root ? root : certificatePath), stat: () => Promise.resolve({ size: 1, isFile: () => false }), readFile: () => Promise.resolve(Buffer.alloc(1)) } },
      { fs: { realpath: (path: string) => Promise.resolve(path === root ? root : certificatePath), stat: () => Promise.resolve({ size: 1, isFile: () => true }), readFile: () => Promise.resolve(Buffer.alloc(2)) } },
      { env: { HTTPS_PROXY: "http://proxy.invalid" } }, { env: new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(secret); } }) }, { execArgv: ["--inspect"] }, { execArgv: [1] },
      { nodeVersion: "25.0.0" }, { clock: () => { throw new Error(secret); } }, { clock: () => 1 }, { clock: () => 4_102_444_800_000 },
      { signal: aborted.signal }, { executor: () => Promise.resolve(new Response(null, { status: 302, headers: { location: "https://other.invalid" } })) }, { executor: () => Promise.reject(new Error(secret)) }, { executor: () => Promise.resolve({} as Response) },
      { executor: (request: Request) => Promise.resolve(request.method === "GET" ? new Response(seed, { headers: { "content-type": "application/xml" } }) : new Response(calls++ === 0 ? "{}" : "bad", { headers: { "content-type": "application/json" } })) },
    ]) {
      const configured = await input(overrides);
      await expectSafeFailure(configured.value);
    }
  });
  it("rejects malformed and unexpected guarded requests without leaking their diagnostics", async () => {
    const configured = await input({ executor: () => Promise.resolve(new Response("bad", { headers: { "content-type": "text/plain" } })) });
    await expectSafeFailure(configured.value, "bad");
  });

  it("contains hostile descriptors and an in-flight abort without diagnostics", async () => {
    const hostile = await input();
    const controller = new AbortController();
    const aborted = await input({ signal: controller.signal, executor: () => Promise.resolve().then(() => { controller.abort(); return new Response(seed, { headers: { "content-type": "application/xml" } }); }) });
    for (const value of [new Proxy(hostile.value, { getOwnPropertyDescriptor() { throw new Error(secret); } }), aborted.value]) {
      await expectSafeFailure(value);
    }
  });

  it("contains absent fields, relative paths, and Uint8Array reads", async () => {
    const typed = await input();
    const safe = await runTesteCfAuthSmoke({ ...typed.value, fs: { ...typed.value.fs, readFile: () => Promise.resolve(new Uint8Array(typed.bytes)) } });
    for (const value of [null, new Proxy({}, { getPrototypeOf() { throw new Error(secret); } }), { ...typed.value, env: null }, { ...typed.value, secret: { certificatePath, password: secret } }, { ...typed.value, secret: { certificatePath: "relative.p12", password: secret, rnc: "000000000" } }]) {
      expect(await runTesteCfAuthSmoke(value)).toEqual(Object.freeze({ code: "FAIL", durationMs: 0 }));
    }
    expect(safe).toEqual(Object.freeze({ code: "PASS", durationMs: 0 }));
  });
  it("contains package factory failures", async () => {
    for (const [module, factory] of [["../modules/http-transport/index.js", () => ({ createDgiiHttpTransport: () => ({ ok: false }) })], ["../modules/dgii-auth/index.js", () => ({ createDgiiAuthentication: () => ({ ok: false }) })]] as const) {
      const configured = await input();
      vi.resetModules(); vi.doMock(module, factory);
      const subject = await import("./testecf-auth-smoke-core.js");
      expect(await subject.runTesteCfAuthSmoke(configured.value)).toEqual(Object.freeze({ code: "FAIL", durationMs: 0 }));
      vi.doUnmock(module);
    }
  });

  it("enforces the non-extendable 30 second deadline at its exact boundary", async () => {
    await withFakeDeadline(async () => {
      const stalledFs = await input({ signal: undefined, fs: { realpath: () => new Promise<string>(() => undefined), stat: () => Promise.resolve({ size: 1, isFile: () => true }), readFile: () => Promise.resolve(Buffer.alloc(1)) } });
      let fsResult: unknown;
      void runTesteCfAuthSmoke(stalledFs.value).then((value) => { fsResult = value; });
      await nextTurn();
      await vi.advanceTimersByTimeAsync(29_999);
      expect(fsResult).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(fsResult).toEqual(Object.freeze({ code: "FAIL", durationMs: 0 }));

      const pendingGet = deferred<Response>(); const getRequests: Request[] = [];
      const stalledGet = await input({ executor: (request: Request) => { getRequests.push(request); return request.method === "GET" ? pendingGet.promise : Promise.resolve(new Response()); } });
      let getResult: unknown;
      void runTesteCfAuthSmoke(stalledGet.value).then((value) => { getResult = value; });
      await waitFor(() => getRequests.length === 1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getResult).toEqual(Object.freeze({ code: "FAIL", durationMs: 0 }));
      expect(getRequests[0]?.signal.aborted).toBe(true);
      pendingGet.resolve(new Response(seed, { headers: { "content-type": "application/xml" } })); await nextTurn();
      expect(getRequests).toHaveLength(1);
      const retryRequests: Request[] = [];
      const retry = await input({ executor: (request: Request) => {
        retryRequests.push(request);
        return Promise.resolve(request.method === "GET"
          ? new Response(seed, { headers: { "content-type": "application/xml" } })
          : new Response('{"token":"synthetic-token","expira":"2027-08-10T13:00:00Z","expedido":"2026-08-10T12:00:00Z"}', { headers: { "content-type": "application/json" } }));
      } });
      await expect(runTesteCfAuthSmoke(retry.value)).resolves.toEqual(Object.freeze({ code: "PASS", durationMs: 0 }));
      expect(retryRequests).toHaveLength(2);
    });
  });

  it("honors an earlier caller abort without allowing later work", async () => {
    await withFakeDeadline(async () => {
      const caller = new AbortController(); const pendingGet = deferred<Response>(); const requests: Request[] = [];
      const configured = await input({ signal: caller.signal, executor: (request: Request) => { requests.push(request); return pendingGet.promise; } });
      const run = runTesteCfAuthSmoke(configured.value);
      await waitFor(() => requests.length === 1);
      await vi.advanceTimersByTimeAsync(1_000); caller.abort();
      await expect(run).resolves.toEqual(Object.freeze({ code: "FAIL", durationMs: 0 }));
      expect(requests[0]?.signal.aborted).toBe(true);
      pendingGet.resolve(new Response(seed, { headers: { "content-type": "application/xml" } })); await nextTurn();
      expect(requests).toHaveLength(1);
    });
  });

  it("fails safely when caller aborts at the post-token clock boundary", async () => {
    const caller = new AbortController(); let clockCalls = 0;
    const configured = await input({ signal: caller.signal, clock: () => { clockCalls += 1; if (clockCalls === 5) caller.abort(); return now; } });
    await expectSafeFailure(configured.value, "synthetic-token");
    expect(configured.requests.map((request) => request.method)).toEqual(["GET", "POST"]);
  });

  it("bounds hostile work with one caller signal and prevents late auth side effects", async () => {
    const stalledFs = await input();
    const fsAbort = new AbortController();
    const stalled = runTesteCfAuthSmoke({ ...stalledFs.value, signal: fsAbort.signal, fs: { ...stalledFs.value.fs, realpath: () => new Promise<string>(() => undefined) } });
    await nextTurn(); fsAbort.abort();
    await expect(stalled).resolves.toEqual(Object.freeze({ code: "FAIL", durationMs: 0 }));

    const betweenFsAbort = new AbortController(); let statCalls = 0;
    const betweenFs = await input({ signal: betweenFsAbort.signal, fs: { realpath: (path: string) => Promise.resolve().then(() => { betweenFsAbort.abort(); return path === root ? root : certificatePath; }), stat: () => { statCalls += 1; return Promise.resolve({ size: 1, isFile: () => true }); }, readFile: () => Promise.resolve(Buffer.alloc(1)) } });
    await expect(runTesteCfAuthSmoke(betweenFs.value)).resolves.toEqual(Object.freeze({ code: "FAIL", durationMs: 0 }));
    expect(statCalls).toBe(0);

    const getAbort = new AbortController(); const pendingGet = deferred<Response>(); const getRequests: Request[] = [];
    const afterGetAbort = await input({ signal: getAbort.signal, executor: (request: Request) => { getRequests.push(request); return request.method === "GET" ? pendingGet.promise : Promise.resolve(new Response()); } });
    const getRun = runTesteCfAuthSmoke(afterGetAbort.value);
    await waitFor(() => getRequests.length === 1); getAbort.abort();
    await expect(getRun).resolves.toEqual(Object.freeze({ code: "FAIL", durationMs: 0 }));
    expect(getRequests).toHaveLength(1); expect(getRequests[0]?.signal.aborted).toBe(true);
    pendingGet.resolve(new Response(seed, { headers: { "content-type": "application/xml" } }));
    await nextTurn(); expect(getRequests).toHaveLength(1);

    const betweenAbort = new AbortController(); const betweenRequests: Request[] = [];
    const between = await input({ signal: betweenAbort.signal, executor: (request: Request) => { betweenRequests.push(request); if (request.method === "GET") betweenAbort.abort(); return Promise.resolve(new Response(seed, { headers: { "content-type": "application/xml" } })); } });
    await expect(runTesteCfAuthSmoke(between.value)).resolves.toEqual(Object.freeze({ code: "FAIL", durationMs: 0 }));
    expect(betweenRequests).toHaveLength(1);

    const postAbort = new AbortController(); const pendingPost = deferred<Response>(); const validation = deferred<boolean>(); const postRequests: Request[] = []; let cancelled = false;
    const duringPost = await input({ signal: postAbort.signal, executor: (request: Request) => { postRequests.push(request); request.signal.addEventListener("abort", () => { cancelled = true; }); return request.method === "GET" ? Promise.resolve(new Response(seed, { headers: { "content-type": "application/xml" } })) : pendingPost.promise; } });
    vi.resetModules(); vi.doMock("../modules/builder/index.js", () => ({ isValidSignedSemilla: () => validation.promise }));
    const postRun = (await import("./testecf-auth-smoke-core.js")).runTesteCfAuthSmoke(duringPost.value);
    await waitFor(() => postRequests.length === 1); validation.resolve(true);
    await waitFor(() => postRequests.length === 2);
    postAbort.abort();
    await expect(postRun).resolves.toEqual(Object.freeze({ code: "FAIL", durationMs: 0 }));
    expect(postRequests.map((request) => request.signal.aborted)).toEqual([true, true]);
    expect(cancelled).toBe(true);
    pendingPost.resolve(new Response('{"token":"synthetic-token","expira":"2027-08-10T13:00:00Z","expedido":"2026-08-10T12:00:00Z"}', { headers: { "content-type": "application/json" } })); await nextTurn();
    expect(postRequests).toHaveLength(2);
    vi.doUnmock("../modules/builder/index.js");
  });
});
