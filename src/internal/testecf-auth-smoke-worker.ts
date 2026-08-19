import type { Readable } from "node:stream";

import { nativeSmokeInput } from "./testecf-auth-smoke-native-adapter.js";
import type { WorkerSecret } from "./testecf-auth-smoke-native-adapter.js";
import { runTesteCfAuthSmoke } from "./testecf-auth-smoke-core.js";

export type Output = Readonly<{ write: (line: string) => void }>;
export type CoreResult = Readonly<{ code: string; durationMs: number }>;
export type Runner = (input: unknown) => Promise<CoreResult>;
export type Adapter = (secret: WorkerSecret) => unknown;

const MAX_PATH_BYTES = 4096;
const RNC_BYTES = 9;
const MAX_PASSWORD_BYTES = 1024;
const HEADER_BYTES = 16;
const MAX_FRAME_BYTES = HEADER_BYTES + MAX_PATH_BYTES + RNC_BYTES + MAX_PASSWORD_BYTES;
const decoder = new TextDecoder("utf-8", { fatal: true });

export class ExactReader {
  #current: Buffer | undefined;
  #offset = 0;
  readonly #iterator: AsyncIterator<Buffer | string>;
  readonly #onDiscardedDestination: ((value: Buffer) => void) | undefined;

  constructor(input: Readable, onDiscardedDestination?: (value: Buffer) => void) {
    this.#iterator = input[Symbol.asyncIterator]() as AsyncIterator<Buffer | string>;
    this.#onDiscardedDestination = onDiscardedDestination;
  }

  #discard(output: Buffer): void {
    output.fill(0);
    try { this.#onDiscardedDestination?.(output); } catch { /* Observers must not affect secret cleanup. */ }
  }

  async read(length: number): Promise<Buffer | undefined> {
    const output = Buffer.alloc(length); let written = 0;
    try {
      while (written < length) {
        if (this.#current === undefined || this.#offset === this.#current.length) {
          const next = await this.#iterator.next();
          if (next.done || !Buffer.isBuffer(next.value)) { this.#discard(output); return undefined; }
          this.#current = next.value; this.#offset = 0;
        }
        const chunk = this.#current;
        const count = Math.min(length - written, chunk.length - this.#offset);
        chunk.copy(output, written, this.#offset, this.#offset + count);
        chunk.subarray(this.#offset, this.#offset + count).fill(0);
        written += count; this.#offset += count;
      }
      return output;
    } catch { this.#discard(output); return undefined; }
  }

  async eof(): Promise<boolean> {
    if (this.#current !== undefined && this.#offset < this.#current.length) return false;
    const next = await this.#iterator.next();
    if (!next.done && Buffer.isBuffer(next.value)) next.value.fill(0);
    return next.done === true;
  }

  clear(): void { this.#current?.fill(0); }
}

function decode(bytes: Buffer): string | undefined {
  try { const value = decoder.decode(bytes); return value.includes("\0") ? undefined : value; } catch { return undefined; }
}

async function parse(input: Readable): Promise<WorkerSecret | undefined> {
  const reader = new ExactReader(input); let header: Buffer | undefined; let path: Buffer | undefined; let rnc: Buffer | undefined; let password: Buffer | undefined;
  try {
    header = await reader.read(HEADER_BYTES);
    if (header === undefined || header.subarray(0, 4).toString("ascii") !== "DGS1") return undefined;
    const lengths = [header.readUInt32LE(4), header.readUInt32LE(8), header.readUInt32LE(12)];
    const total = lengths.reduce((sum, length) => sum + length, HEADER_BYTES);
    if (!Number.isSafeInteger(total) || total > MAX_FRAME_BYTES || lengths[0] === undefined || lengths[1] === undefined || lengths[2] === undefined
      || lengths[0] < 1 || lengths[0] > MAX_PATH_BYTES || lengths[1] !== RNC_BYTES || lengths[2] < 1 || lengths[2] > MAX_PASSWORD_BYTES) return undefined;
    path = await reader.read(lengths[0]); rnc = await reader.read(lengths[1]); password = await reader.read(lengths[2]);
    const values = path === undefined || rnc === undefined || password === undefined ? undefined : [decode(path), decode(rnc), decode(password)];
    if (values === undefined || values.some((value) => value === undefined) || !await reader.eof()) return undefined;
    const [certificatePath, taxpayerRnc, certificatePassword] = values as [string, string, string];
    return taxpayerRnc.match(/^[0-9]{9}$/u) !== null && certificatePath.toLowerCase().endsWith(".p12")
      ? Object.freeze({ path: certificatePath, rnc: taxpayerRnc, password: certificatePassword }) : undefined;
  } catch { return undefined; } finally { header?.fill(0); path?.fill(0); rnc?.fill(0); password?.fill(0); reader.clear(); }
}

export async function runWorker(input: Readable, output: Output, runSmoke: Runner = runTesteCfAuthSmoke, adapt: Adapter = nativeSmokeInput): Promise<0 | 2 | 3 | 4> {
  let written = false;
  const write = (value: Readonly<{ ok: boolean; code: string }>): void => { if (!written) { written = true; output.write(`${JSON.stringify(value)}\n`); } };
  try {
    const secret = await parse(input);
    if (secret === undefined) { write({ ok: false, code: "INPUT_REJECTED" }); return 2; }
    // Password strings cross the synchronous PKCS#12 boundary and cannot be cleared by JavaScript.
    const result = await runSmoke(adapt(secret));
    if (result.code === "PASS") { write({ ok: true, code: "TESTECF_AUTH_SUCCEEDED" }); return 0; }
    if (result.code === "FAIL") { write({ ok: false, code: "TESTECF_AUTH_FAILED" }); return 3; }
    write({ ok: false, code: "INTERNAL" }); return 4;
  } catch { write({ ok: false, code: "INTERNAL" }); return 4; }
}
