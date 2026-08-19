import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { Readable } from "node:stream";

import { runWorker } from "./testecf-auth-smoke-worker.js";
import type { Output } from "./testecf-auth-smoke-worker.js";

type Runtime = {
  stdin: Readable;
  stdout: Output;
  exitCode: number | string | null | undefined;
  on: (event: string, listener: () => void) => unknown;
  off: (event: string, listener: () => void) => unknown;
};

type Worker = (input: Readable, output: Output) => Promise<0 | 2 | 3 | 4>;

export function isDirectEntrypoint(
  moduleUrl: string,
  argv: readonly string[] = process.argv,
  toFileUrl: (path: string) => string = (path) => pathToFileURL(resolve(path)).href,
): boolean {
  const entrypoint = argv[1];
  if (entrypoint === undefined || entrypoint.length === 0) return false;
  try { return moduleUrl === toFileUrl(entrypoint); } catch { return false; }
}

export async function bootstrap(runtime: Runtime = process, execute: Worker = runWorker): Promise<void> {
  let written = false; const status = { failed: false }; let workerLine: string | undefined;
  const write = (line: string): void => { if (!written) { written = true; runtime.stdout.write(line); } };
  const fail = (): void => { status.failed = true; write('{"ok":false,"code":"INTERNAL"}\n'); runtime.exitCode = 4; };

  runtime.on("uncaughtException", fail);
  runtime.on("unhandledRejection", fail);
  try {
    const exit = await execute(runtime.stdin, { write: (line) => { if (workerLine === undefined) workerLine = line; } });
    if (!status.failed) { write(workerLine ?? '{"ok":false,"code":"INTERNAL"}\n'); runtime.exitCode = exit; }
  } catch { fail(); } finally {
    runtime.off("uncaughtException", fail);
    runtime.off("unhandledRejection", fail);
  }
}

export function bootstrapIfDirect(
  moduleUrl: string,
  argv: readonly string[] = process.argv,
  start: () => Promise<void> = bootstrap,
): boolean {
  if (!isDirectEntrypoint(moduleUrl, argv)) return false;
  void start();
  return true;
}

void bootstrapIfDirect(import.meta.url);
