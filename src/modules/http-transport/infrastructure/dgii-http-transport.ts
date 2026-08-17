import type { Result } from "../../../shared/domain/result.js";

export type DgiiEnvironment = "TesteCF" | "CerteCF" | "production";
export type DgiiService = "ecf" | "rfce";
export type DgiiHttpExecutor = (request: Request) => Promise<Response>;
type DgiiHttpTransportCatalogErrorCode = "INVALID_HTTP_TRANSPORT_CONFIGURATION" | "INVALID_HTTP_TRANSPORT_REQUEST" | "HTTP_TRANSPORT_EXECUTION_FAILED" | "HTTP_TRANSPORT_RESPONSE_TOO_LARGE";
export type DgiiHttpTransportError = Readonly<{ code: DgiiHttpTransportCatalogErrorCode }>
  | Readonly<{ code: "HTTP_TRANSPORT_HTTP_FAILED"; status: number; mediaType: string }>;
export type DgiiHttpResponse = Readonly<{ status: number; mediaType: string; body: string }>;
export type DgiiHttpTransport = Readonly<{
  get(target: DgiiHttpTarget, accept: "xml" | "json", bearerToken?: string, signal?: AbortSignal): Promise<Result<DgiiHttpResponse, DgiiHttpTransportError>>;
  postMultipart(input: DgiiMultipartPost, signal?: AbortSignal): Promise<Result<DgiiHttpResponse, DgiiHttpTransportError>>;
}>;
export type DgiiHttpTarget = Readonly<{ service: DgiiService; path: string; query?: string }>;
export type DgiiMultipartPost = Readonly<{
  service: DgiiService;
  path: string;
  accept: "xml" | "json";
  file: Readonly<{ fieldName: "xml"; mediaType: "text/xml"; content: string; fileName?: string }>;
  bearerToken?: string;
}>;

type Configuration = Readonly<{
  environment: DgiiEnvironment;
  roots: Readonly<Record<DgiiService, string>>;
  executor: DgiiHttpExecutor;
}>;

const MAX_RESPONSE_BYTES = 1_048_576;
const MEDIA_TYPE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

function failure(code: DgiiHttpTransportCatalogErrorCode): Result<never, DgiiHttpTransportError> {
  return { ok: false, error: Object.freeze({ code }) };
}

function mediaType(response: Response): string {
  const value = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  return value.length <= 128 && MEDIA_TYPE.test(value) ? value : "";
}

async function body(response: Response): Promise<Result<string, DgiiHttpTransportError>> {
  if (response.body === null) return { ok: true, value: "" };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let value = "";
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return { ok: true, value: value + decoder.decode() };
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return failure("HTTP_TRANSPORT_RESPONSE_TOO_LARGE");
      }
      value += decoder.decode(next.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

function configuration(inputValue: unknown): Configuration | undefined {
  try {
    if (!isPlainRecord(inputValue) || !isEnvironment(inputValue["environment"]) || typeof inputValue["executor"] !== "function" || !isPlainRecord(inputValue["roots"])) return undefined;
    const { ecf, rfce } = inputValue["roots"];
    if (!isHttpsRoot(ecf) || !isHttpsRoot(rfce)) return undefined;
    return Object.freeze({ environment: inputValue["environment"], roots: Object.freeze({ ecf, rfce }), executor: inputValue["executor"] as DgiiHttpExecutor });
  } catch { return undefined; }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isEnvironment(value: unknown): value is DgiiEnvironment {
  return value === "TesteCF" || value === "CerteCF" || value === "production";
}

function isAccept(value: unknown): value is "xml" | "json" {
  return value === "xml" || value === "json";
}

function isHttpsRoot(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "" && parsed.search === "" && parsed.hash === "";
  } catch { return false; }
}

function url(roots: Readonly<Record<DgiiService, string>>, target: unknown): URL | undefined {
  try {
    if (!isPlainRecord(target) || (target["service"] !== "ecf" && target["service"] !== "rfce") || typeof target["path"] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9/_-]*$/u.test(target["path"]) || (target["query"] !== undefined && (typeof target["query"] !== "string" || !/^(?:[A-Za-z0-9._~-]+=[A-Za-z0-9._~%+-]*)(?:&[A-Za-z0-9._~-]+=[A-Za-z0-9._~%+-]*)*$/u.test(target["query"])))) return undefined;
    return new URL(`${target["path"]}${target["query"] === undefined ? "" : `?${target["query"]}`}`, `${roots[target["service"]].replace(/\/$/u, "")}/`);
  } catch { return undefined; }
}

function multipart(inputValue: unknown): DgiiMultipartPost | undefined {
  try {
    if (!isPlainRecord(inputValue) || typeof inputValue["path"] !== "string" || (inputValue["service"] !== "ecf" && inputValue["service"] !== "rfce") || !isPlainRecord(inputValue["file"])) return undefined;
    const { fieldName, mediaType, content, fileName } = inputValue["file"];
    const bearerToken = inputValue["bearerToken"];
    if (fieldName !== "xml" || mediaType !== "text/xml" || typeof content !== "string" || content.length === 0 || (fileName !== undefined && (typeof fileName !== "string" || !/^[0-9]{9,11}E[0-9]{12}\.xml$/u.test(fileName))) || !isAccept(inputValue["accept"]) || (bearerToken !== undefined && (typeof bearerToken !== "string" || bearerToken.length === 0 || /[\r\n]/u.test(bearerToken)))) return undefined;
    return Object.freeze({ service: inputValue["service"], path: inputValue["path"], accept: inputValue["accept"], file: Object.freeze({ fieldName, mediaType, content, ...(fileName === undefined ? {} : { fileName }) }), ...(bearerToken === undefined ? {} : { bearerToken }) });
  } catch { return undefined; }
}

async function execute(executor: DgiiHttpExecutor, request: Request, signal?: AbortSignal): Promise<Result<DgiiHttpResponse, DgiiHttpTransportError>> {
  try {
    if (signal?.aborted) return failure("HTTP_TRANSPORT_EXECUTION_FAILED");
    const response: unknown = await executor(request);
    if (!(response instanceof Response)) return failure("HTTP_TRANSPORT_EXECUTION_FAILED");
    if (signal?.aborted) { await response.body?.cancel().catch(() => undefined); return failure("HTTP_TRANSPORT_EXECUTION_FAILED"); }
    const responseMediaType = mediaType(response);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, error: Object.freeze({ code: "HTTP_TRANSPORT_HTTP_FAILED", status: response.status, mediaType: responseMediaType }) };
    }
    const responseBody = await body(response);
    return responseBody.ok
      ? { ok: true, value: Object.freeze({ status: response.status, mediaType: responseMediaType, body: responseBody.value }) }
      : responseBody;
  } catch { return failure("HTTP_TRANSPORT_EXECUTION_FAILED"); }
}

/** Creates an independent, executor-injected boundary for documented DGII HTTPS requests. */
export function createDgiiHttpTransport(inputValue: unknown): Result<DgiiHttpTransport, DgiiHttpTransportError> {
  const values = configuration(inputValue);
  if (values === undefined) return failure("INVALID_HTTP_TRANSPORT_CONFIGURATION");
  const requestUrl = (target: unknown): URL | undefined => url(values.roots, target);
  return {
    ok: true,
    value: Object.freeze({
      async get(target, accept, bearerToken, signal) {
        const destination = requestUrl(target);
        if (destination === undefined || !isAccept(accept) || (bearerToken !== undefined && (typeof bearerToken !== "string" || bearerToken.length === 0 || /[\r\n]/u.test(bearerToken)))) return failure("INVALID_HTTP_TRANSPORT_REQUEST");
        return execute(values.executor, new Request(destination, { headers: { accept: accept === "xml" ? "application/xml" : "application/json", ...(bearerToken === undefined ? {} : { authorization: `Bearer ${bearerToken}` }) }, signal: signal ?? null }), signal);
      },
      async postMultipart(input, signal) {
        const values_ = multipart(input);
        const destination = values_ === undefined ? undefined : requestUrl(values_);
        if (values_ === undefined || destination === undefined) return failure("INVALID_HTTP_TRANSPORT_REQUEST");
        const form = new FormData();
        form.set("xml", new Blob([values_.file.content], { type: "text/xml" }), values_.file.fileName ?? "document.xml");
        const headers = { accept: values_.accept === "xml" ? "application/xml" : "application/json", ...(values_.bearerToken === undefined ? {} : { authorization: `Bearer ${values_.bearerToken}` }) };
        return execute(values.executor, new Request(destination, { method: "POST", headers, body: form, signal: signal ?? null }), signal);
      },
    }),
  };
}
