import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createNativeSmokeInput, nativeSmokeInput } from "./testecf-auth-smoke-native-adapter.js";
import { ExactReader, runWorker } from "./testecf-auth-smoke-worker.js";
import type { Adapter, Runner } from "./testecf-auth-smoke-worker.js";

const secret = "synthetic-worker-password";
const valid = { path: "/outside/SYNTHETIC.P12", rnc: "000000000", password: secret };

function frame(value = valid, trailing = Buffer.alloc(0)): Buffer {
  const fields = [Buffer.from(value.path), Buffer.from(value.rnc), Buffer.from(value.password)];
  const header = Buffer.alloc(16);
  header.write("DGS1");
  fields.forEach((field, index) => { header.writeUInt32LE(field.length, 4 + index * 4); });
  return Buffer.concat([header, ...fields, trailing]);
}

async function invoke(chunks: readonly Buffer[], runner: Runner = () => Promise.resolve({ code: "PASS", durationMs: 0 }), adapter: Adapter = (value) => value) {
  let text = "";
  const exit = await runWorker(Readable.from(chunks), { write: (line: string) => { text += line; } }, runner, adapter);
  return { exit, lines: text.split("\n").filter(Boolean) };
}

describe("runWorker", () => {
  it("parses bounded DGS1 input across partial chunks and maps a core pass", async () => {
    const bytes = frame();
    const received: unknown[] = [];
    const result = await invoke([...bytes].map((byte) => Buffer.from([byte])), (input) => { received.push(input); return Promise.resolve({ code: "PASS", durationMs: 7 }); });
    expect(result).toEqual({ exit: 0, lines: ['{"ok":true,"code":"TESTECF_AUTH_SUCCEEDED"}'] });
    expect(received).toEqual([valid]);
  });

  it("rejects every malformed DGS1 boundary without leaking its password", async () => {
    const badUtf8 = frame({ ...valid, path: "x" });
    badUtf8[16] = 0xff;
    const oversized = frame();
    oversized.writeUInt32LE(4097, 4);
    for (const input of [
      Buffer.alloc(0), Buffer.from("DGS0"), frame().subarray(0, 20), frame(valid, Buffer.from("x")), oversized,
      frame({ ...valid, path: "x".repeat(4097) }), frame({ ...valid, path: "\0/outside.p12" }),
      frame({ ...valid, path: "/outside/not-a-cert.pem" }), frame({ ...valid, rnc: "00000000x" }),
      frame({ ...valid, password: "\0password" }), badUtf8,
    ]) {
      const result = await invoke([input]);
      expect(result).toEqual({ exit: 2, lines: ['{"ok":false,"code":"INPUT_REJECTED"}'] });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(await invoke([frame(), Buffer.from("x")])).toEqual({ exit: 2, lines: ['{"ok":false,"code":"INPUT_REJECTED"}'] });
    const brokenStream: AsyncIterable<Buffer> = { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error()) }) };
    expect(await runWorker(brokenStream as unknown as Readable, { write: () => undefined })).toBe(2);
    let reads = 0;
    const brokenEof: AsyncIterable<Buffer> = { [Symbol.asyncIterator]: () => ({ next: () => reads++ === 0 ? Promise.resolve({ done: false, value: frame() }) : Promise.reject(new Error()) }) };
    expect(await runWorker(brokenEof as unknown as Readable, { write: () => undefined })).toBe(2);
  });

  it("clears a partially copied destination before rejecting incomplete input", async () => {
    for (const input of [
      Readable.from([Buffer.from("masked-input")]),
      { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: false, value: "not-a-buffer" }) }) },
      { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error()) }) },
    ]) {
      const discarded: Buffer[] = [];
      const reader = new ExactReader(input as Readable, (value) => discarded.push(value));
      expect(await reader.read(32)).toBeUndefined();
      expect(discarded).toHaveLength(1);
      expect(discarded[0]?.every((byte) => byte === 0)).toBe(true);
    }
  });

  it("maps core failure and an unexpected throw to their closed one-line schemas", async () => {
    const failed = await invoke([frame()], () => Promise.resolve({ code: "FAIL", durationMs: 0 }));
    const broken = await invoke([frame()], () => Promise.reject(new Error(secret)));
    const unknown = await invoke([frame()], () => Promise.resolve({ code: "UNKNOWN", durationMs: 0 }));
    expect(failed).toEqual({ exit: 3, lines: ['{"ok":false,"code":"TESTECF_AUTH_FAILED"}'] });
    expect(broken).toEqual({ exit: 4, lines: ['{"ok":false,"code":"INTERNAL"}'] });
    expect(unknown).toEqual({ exit: 4, lines: ['{"ok":false,"code":"INTERNAL"}'] });
    expect(JSON.stringify(broken)).not.toContain(secret);
    expect(await runWorker(Readable.from([frame()]), { write: () => { throw new Error(); } }, () => Promise.resolve({ code: "PASS", durationMs: 0 }))).toBe(4);
  });

  it("builds the core input from a fixed synthetic native adapter without network access", async () => {
    const calls: string[] = [];
    const adapter = createNativeSmokeInput({
      cwd: () => "/repository",
      env: { SAFE: "1" }, execArgv: [], nodeVersion: "24.2.0", clock: () => 1,
      fs: { realpath: (path) => Promise.resolve(path), stat: () => Promise.resolve({ size: 1, isFile: () => true }), readFile: () => Promise.resolve(Buffer.from([1])) },
      fetch: (request) => { calls.push(request.url); return Promise.resolve(new Response()); },
    });
    const result = await invoke([frame()], (input) => {
      const core = input as ReturnType<typeof adapter>;
      return core.executor(new Request("https://synthetic.invalid")).then(() => ({ code: "PASS", durationMs: 0 }));
    }, adapter);
    expect(result.exit).toBe(0);
    expect(calls).toEqual(["https://synthetic.invalid/"]);
    expect(nativeSmokeInput(valid).secret).toEqual({ certificatePath: valid.path, password: secret, rnc: valid.rnc });
  });
});
