import { isAbsolute, relative } from "node:path";

import { getAuthenticatedCertificateMetadata, loadInMemoryPkcs12 } from "../modules/certificate/index.js";
import { createDgiiAuthentication } from "../modules/dgii-auth/index.js";
import { parseTaxpayerIdentifier } from "../modules/fiscal-identity/index.js";
import { createDgiiHttpTransport } from "../modules/http-transport/index.js";

type Code = "PASS" | "FAIL";
type Values = Readonly<{ secret: Readonly<{ certificatePath: string; password: string; rnc: string }>; fs: Readonly<{ realpath: (path: string) => Promise<string>; stat: (path: string) => Promise<{ size: number; isFile: () => boolean }>; readFile: (path: string) => Promise<Buffer | Uint8Array> }>; repositoryRoot: string; nodeVersion: string; env: object; execArgv: readonly string[]; clock: () => number; executor: (request: Request) => Promise<Response>; signal?: AbortSignal }>;

const AUTH_ROOT = "https://ecf.dgii.gov.do/testecf/autenticacion";
const RFCE_ROOT = "https://fc.dgii.gov.do/testecf/recepcionfc";
const SEED_URL = `${AUTH_ROOT}/api/autenticacion/semilla`;
const VALIDATE_URL = `${AUTH_ROOT}/api/autenticacion/validarsemilla`;
const MAX_P12_BYTES = 10_485_760;
const DEADLINE_MS = 30_000;
const HAZARDS = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "NODE_USE_ENV_PROXY", "GLOBAL_AGENT_HTTP_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_OPTIONS"];

function plain(value: unknown): value is object { try { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; } catch { return false; } }
function own(value: object, key: string): unknown { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined; }
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0 && !Array.from(value).some((character) => { const code = character.charCodeAt(0); return code < 32 || code === 127; }); }
function within(root: string, target: string): boolean { const path = relative(root, target); return path === "" || (!path.startsWith("..") && !isAbsolute(path)); }

function values(input: unknown): Values | undefined {
  try {
    if (!plain(input)) return undefined;
    const secret = own(input, "secret"); const fs = own(input, "fs");
    const repositoryRoot = own(input, "repositoryRoot"); const nodeVersion = own(input, "nodeVersion"); const env = own(input, "env"); const execArgv = own(input, "execArgv"); const clock = own(input, "clock"); const executor = own(input, "executor"); const signal = own(input, "signal");
    if (!plain(secret) || !plain(fs) || !text(repositoryRoot) || !text(nodeVersion) || !plain(env) || !Array.isArray(execArgv) || typeof clock !== "function" || typeof executor !== "function" || (signal !== undefined && !(signal instanceof AbortSignal))) return undefined;
    const certificatePath = own(secret, "certificatePath"); const password = own(secret, "password"); const rnc = own(secret, "rnc"); const realpath = own(fs, "realpath"); const stat = own(fs, "stat"); const readFile = own(fs, "readFile");
    return text(certificatePath) && text(password) && text(rnc) && typeof realpath === "function" && typeof stat === "function" && typeof readFile === "function" && execArgv.every((item) => typeof item === "string")
      ? Object.freeze({ secret: Object.freeze({ certificatePath, password, rnc }), fs: Object.freeze({ realpath: realpath as Values["fs"]["realpath"], stat: stat as Values["fs"]["stat"], readFile: readFile as Values["fs"]["readFile"] }), repositoryRoot, nodeVersion, env, execArgv, clock: clock as Values["clock"], executor: executor as Values["executor"], ...(signal === undefined ? {} : { signal }) }) : undefined;
  } catch { return undefined; }
}

function safeRuntime(value: Values): boolean {
  try { return Number(value.nodeVersion.split(".", 1)[0]) === 24 && value.execArgv.length === 0 && HAZARDS.every((key) => Object.getOwnPropertyDescriptor(value.env, key) === undefined); } catch { return false; }
}
function succeeded(value: unknown): boolean { return plain(value) && own(value, "ok") === true; }

function result(code: Code, clock: (() => number) | undefined, start: number): Readonly<{ code: Code; durationMs: number }> {
  let durationMs = 0;
  try { const end = clock?.(); if (typeof end === "number" && Number.isFinite(end)) durationMs = Math.max(0, end - start); } catch { /* Safe catalog output deliberately omits diagnostics. */ }
  return Object.freeze({ code, durationMs });
}

async function bounded<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let reject!: (reason?: unknown) => void;
  const aborted = new Promise<never>((_, fail) => { reject = fail; });
  const onAbort = () => { reject(new Error()); };
  signal.addEventListener("abort", onAbort, { once: true });
  try { return await Promise.race([Promise.resolve().then(operation), aborted]); } finally { signal.removeEventListener("abort", onAbort); }
}

async function authorise(authentication: { authorize(signal: AbortSignal): Promise<unknown> }, signal: AbortSignal): Promise<unknown> {
  return bounded(() => authentication.authorize(signal), signal);
}

/** Password strings are used only by the synchronous PKCS#12 boundary; callers own their lifecycle because JavaScript strings cannot be cleared. */
export async function runTesteCfAuthSmoke(input: unknown): Promise<Readonly<{ code: Code; durationMs: number }>> {
  const configured = values(input); let start = 0; let bytes: Buffer | undefined;
  try {
    if (configured === undefined || configured.signal?.aborted || !safeRuntime(configured)) return result("FAIL", undefined, start);
    const signal = AbortSignal.any([AbortSignal.timeout(DEADLINE_MS), ...(configured.signal === undefined ? [] : [configured.signal])]);
    start = configured.clock();
    if (!Number.isFinite(start) || !isAbsolute(configured.secret.certificatePath) || !/\.p12$/u.test(configured.secret.certificatePath)) return result("FAIL", configured.clock, start);
    const [repositoryRoot, certificatePath] = await Promise.all([bounded(() => configured.fs.realpath(configured.repositoryRoot), signal), bounded(() => configured.fs.realpath(configured.secret.certificatePath), signal)]);
    const info = await bounded(() => configured.fs.stat(certificatePath), signal);
    if (!text(repositoryRoot) || !text(certificatePath) || within(repositoryRoot, certificatePath) || !info.isFile() || !Number.isSafeInteger(info.size) || info.size < 1 || info.size > MAX_P12_BYTES) return result("FAIL", configured.clock, start);
    const loaded = await bounded(() => configured.fs.readFile(certificatePath), signal);
    bytes = Buffer.isBuffer(loaded) ? loaded : Buffer.from(loaded);
    if (bytes.length !== info.size) return result("FAIL", configured.clock, start);
    const identity = parseTaxpayerIdentifier(configured.secret.rnc);
    if (!identity.ok || identity.value.kind !== "rnc") return result("FAIL", configured.clock, start);
    const material = loadInMemoryPkcs12({ bytes, password: configured.secret.password, expectedIdentity: identity.value });
    if (!material.ok) return result("FAIL", configured.clock, start);
    const metadata = getAuthenticatedCertificateMetadata(material.value);
    const now = configured.clock();
    if (metadata === undefined || !Number.isFinite(now) || Date.parse(metadata.validFrom) > now || now >= Date.parse(metadata.validTo)) return result("FAIL", configured.clock, start);
    let requests = 0;
    const transport = createDgiiHttpTransport({ environment: "TesteCF", roots: { ecf: AUTH_ROOT, rfce: RFCE_ROOT }, executor: async (request: Request) => {
      const expected = requests++ === 0 ? ["GET", SEED_URL] : requests === 2 ? ["POST", VALIDATE_URL] : undefined;
      if (expected === undefined || request.method !== expected[0] || request.url !== expected[1] || request.headers.has("authorization")) throw new Error();
      signal.throwIfAborted();
      const response = await bounded(() => configured.executor(request), signal);
      if (!(response instanceof Response) || response.redirected || response.status >= 300 && response.status < 400) throw new Error();
      return response;
    } });
    if (!transport.ok) return result("FAIL", configured.clock, start);
    const auth = createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: AUTH_ROOT, transport: transport.value, certificateMaterial: material.value,
      clock: () => new Date(configured.clock()) });
    if (!auth.ok) return result("FAIL", configured.clock, start);
    auth.value.invalidate();
    try { const first = await authorise(auth.value, signal); const second = await authorise(auth.value, signal); return succeeded(first) && succeeded(second) && requests === 2 ? result("PASS", configured.clock, start) : result("FAIL", configured.clock, start); } finally { auth.value.invalidate(); }
  } catch { return result("FAIL", configured?.clock, start); } finally { bytes?.fill(0); }
}
