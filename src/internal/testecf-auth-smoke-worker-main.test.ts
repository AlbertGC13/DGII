import { Readable } from "node:stream";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { bootstrap, bootstrapIfDirect, isDirectEntrypoint } from "./testecf-auth-smoke-worker-main.js";

function runtime() {
  const listeners = new Map<string, (() => void)[]>(); let text = "";
  return {
    stdin: Readable.from([]), stdout: { write: (line: string) => { text += line; } }, exitCode: undefined as number | undefined,
    on: (event: string, listener: () => void) => { listeners.set(event, [...(listeners.get(event) ?? []), listener]); },
    off: (event: string, listener: () => void) => { listeners.set(event, (listeners.get(event) ?? []).filter((value) => value !== listener)); },
    emit: (event: string) => { for (const listener of listeners.get(event) ?? []) listener(); },
    result: () => ({ text, listeners }),
  };
}

describe("testecf auth smoke worker main", () => {
  it("does not register handlers or write when imported", async () => {
    const uncaught = process.listenerCount("uncaughtException"); const rejected = process.listenerCount("unhandledRejection");
    // @ts-expect-error Vite query imports a distinct module instance.
    await import("./testecf-auth-smoke-worker-main.js?import-safe");
    expect([process.listenerCount("uncaughtException"), process.listenerCount("unhandledRejection")]).toEqual([uncaught, rejected]);
  });

  it("runs only direct entrypoints and cleans up after a fatal event", async () => {
    const host = runtime(); let execute = 0;
    const moduleUrl = pathToFileURL(resolve("/worker.mjs")).href;
    let starts = 0;
    expect(isDirectEntrypoint(moduleUrl, ["node", "/worker.mjs"])).toBe(true);
    expect(isDirectEntrypoint("file:///worker.mjs", ["node"])).toBe(false);
    expect(isDirectEntrypoint(moduleUrl, ["node", "/worker.mjs"], () => { throw new Error(); })).toBe(false);
    expect(bootstrapIfDirect(moduleUrl, ["node", "/worker.mjs"], () => { starts += 1; return Promise.resolve(); })).toBe(true);
    expect(starts).toBe(1);
    expect(bootstrapIfDirect(moduleUrl, ["node"], () => Promise.resolve())).toBe(false);
    const pending = bootstrap(host, (_input, output) => {
      execute += 1; output.write('{"ok":true,"code":"TESTECF_AUTH_SUCCEEDED"}\n'); host.emit("uncaughtException"); host.emit("unhandledRejection"); return Promise.resolve(0);
    });
    await pending;
    expect(execute).toBe(1);
    expect(host.exitCode).toBe(4);
    expect(host.result().text).toBe('{"ok":false,"code":"INTERNAL"}\n');
    expect([...host.result().listeners.values()].flat()).toEqual([]);
    const successful = runtime();
    await bootstrap(successful, (_input, output) => {
      output.write('{"ok":true,"code":"TESTECF_AUTH_SUCCEEDED"}\n'); output.write('{"ok":false,"code":"INTERNAL"}\n'); return Promise.resolve(0);
    });
    expect(successful.exitCode).toBe(0);
    expect(successful.result().text).toBe('{"ok":true,"code":"TESTECF_AUTH_SUCCEEDED"}\n');
    const silent = runtime();
    await bootstrap(silent, () => Promise.resolve(2));
    expect(silent.exitCode).toBe(2);
    expect(silent.result().text).toBe('{"ok":false,"code":"INTERNAL"}\n');
    const broken = runtime();
    await bootstrap(broken, () => Promise.reject(new Error()));
    expect(broken.result().text).toBe('{"ok":false,"code":"INTERNAL"}\n');
  });
});
