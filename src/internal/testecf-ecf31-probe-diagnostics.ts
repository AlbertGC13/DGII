export type TesteCfEcf31ProbeField = Readonly<{ field: "FAILURE_STAGE" | "HTTP_STATUS" | "RESPONSE_MEDIA_TYPE" | "RESPONSE_SHAPE" | "RESPONSE_KEY_COUNT" | "UNKNOWN_KEY_COUNT" | "DUPLICATE_KEY_COUNT" | "TRACK_ID_KEY" | "TRACK_ID_STATE" | "ERROR_KEY" | "ERROR_STATE" | "MESSAGE_KEY" | "MESSAGE_STATE" | "RESPONSE_SUCCESS_COMPATIBLE" | "DGII_ERROR" | "DGII_MESSAGE"; value: string }>;
export type TesteCfEcf31ProbeDiagnostics = Readonly<{
  observeAuthorization(result: unknown): void;
  observeReceptionTransport(result: unknown): void;
  fields(): readonly TesteCfEcf31ProbeField[];
}>;

type HttpResponse = Readonly<{ status: number; mediaType: string; body: string }>;
type HttpFailure = Readonly<{ status: number; mediaType: string }>;
type DgiiResponse = Readonly<{ error: string | null; mensaje: string | null }>;
type KeyState = "EXACT" | "NONCANONICAL" | "MISSING";
type ValueState = "MISSING" | "NULL" | "STRING_BLANK" | "STRING_NONBLANK" | "INVALID_TYPE" | "OVER_LIMIT";

const MAX_FIELD_LENGTH = 256;
const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu;
const JWT_DETECT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u;
const CONTROL = /\p{Cc}/u;
const SAFE_DIAGNOSTIC_TEXT = /^[\p{L}\p{N} .,;:!?()/_+%#&'"-]+$/u;
const SENSITIVE_ASSIGNMENT = /\b(?:password|pass|pwd|credential|secret|token|api[-_ ]?key|authorization|header)\b\s*(?:=|:)\s*\S+/iu;
const BEARER = /\bbearer\s+\S+/iu;
const PEM = /-----BEGIN(?: [A-Z0-9 ]+)? (?:PRIVATE KEY|CERTIFICATE)-----/iu;
const EXPECTED_KEYS = ["trackId", "error", "mensaje"] as const;

function text(value: unknown): string | undefined {
  try { return typeof value === "string" ? value : String(value); } catch { return undefined; }
}

function sensitive(value: string): boolean {
  return CONTROL.test(value) || SENSITIVE_ASSIGNMENT.test(value) || BEARER.test(value) || PEM.test(value);
}

export function redactTesteCfProbeOutput(value: unknown): string {
  const output = text(value);
  if (output === undefined || sensitive(output)) return "<REDACTED-SENSITIVE>";
  return output.replace(JWT, "<REDACTED-JWT>");
}

function record(value: unknown): Record<string, unknown> | undefined {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function own(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor && descriptor.enumerable ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function mediaType(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && MEDIA_TYPE.test(value) && !CONTROL.test(value);
}

function status(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 100 && value <= 599;
}

function httpResponse(value: unknown): HttpResponse | undefined {
  const result = record(value); const response = result === undefined ? undefined : own(result, "value"); const item = record(response);
  return own(result ?? {}, "ok") === true && item !== undefined && status(own(item, "status")) && mediaType(own(item, "mediaType")) && typeof own(item, "body") === "string" && (own(item, "body") as string).length <= 65_536
    ? Object.freeze({ status: own(item, "status") as number, mediaType: own(item, "mediaType") as string, body: own(item, "body") as string })
    : undefined;
}

function httpFailure(value: unknown): HttpFailure | undefined {
  const result = record(value); const error = result === undefined ? undefined : record(own(result, "error"));
  return own(result ?? {}, "ok") === false && error !== undefined && own(error, "code") === "HTTP_TRANSPORT_HTTP_FAILED" && status(own(error, "status")) && mediaType(own(error, "mediaType"))
    ? Object.freeze({ status: own(error, "status") as number, mediaType: own(error, "mediaType") as string })
    : undefined;
}

function safeDgiiText(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_FIELD_LENGTH || sensitive(value) || JWT_DETECT.test(value)) return undefined;
  const sanitized = value.trim();
  return sanitized.length > 0 && SAFE_DIAGNOSTIC_TEXT.test(sanitized) ? sanitized : undefined;
}

function duplicateKeyCount(body: string): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const match of body.matchAll(/"(?:\\.|[^"\\])*"\s*:/gu)) {
    const key = JSON.parse(match[0].slice(0, match[0].lastIndexOf(":"))) as string;
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

function structuralFields(response: HttpResponse): readonly TesteCfEcf31ProbeField[] {
  if (response.mediaType.toLowerCase() !== "application/json") return Object.freeze([]);
  let parsed: unknown;
  try { parsed = JSON.parse(response.body); } catch { return Object.freeze([Object.freeze({ field: "RESPONSE_SHAPE", value: "INVALID_JSON" })]); }
  if (Array.isArray(parsed)) return Object.freeze([Object.freeze({ field: "RESPONSE_SHAPE", value: "ARRAY" })]);
  const item = record(parsed);
  if (item === undefined) return Object.freeze([Object.freeze({ field: "RESPONSE_SHAPE", value: "NON_OBJECT" })]);

  const keys = Object.keys(item);
  const fields: TesteCfEcf31ProbeField[] = [
    Object.freeze({ field: "RESPONSE_SHAPE", value: "OBJECT" }),
    Object.freeze({ field: "RESPONSE_KEY_COUNT", value: String(keys.length) }),
    Object.freeze({ field: "UNKNOWN_KEY_COUNT", value: String(keys.filter((key) => !EXPECTED_KEYS.includes(key as never)).length) }),
    Object.freeze({ field: "DUPLICATE_KEY_COUNT", value: String(duplicateKeyCount(response.body)) }),
  ];
  let successCompatible = keys.length === EXPECTED_KEYS.length && keys.every((key) => EXPECTED_KEYS.includes(key as never)) && duplicateKeyCount(response.body) === 0;
  for (const [key, keyField, valueField] of [["trackId", "TRACK_ID_KEY", "TRACK_ID_STATE"], ["error", "ERROR_KEY", "ERROR_STATE"], ["mensaje", "MESSAGE_KEY", "MESSAGE_STATE"]] as const) {
    const exact = keys.includes(key); const noncanonical = exact ? undefined : keys.find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const keyState: KeyState = exact ? "EXACT" : noncanonical === undefined ? "MISSING" : "NONCANONICAL";
    const value = exact ? own(item, key) : noncanonical === undefined ? undefined : own(item, noncanonical);
    const valueState: ValueState = value === undefined ? "MISSING" : value === null ? "NULL" : typeof value !== "string" ? "INVALID_TYPE" : value.length > MAX_FIELD_LENGTH ? "OVER_LIMIT" : value.trim().length === 0 ? "STRING_BLANK" : "STRING_NONBLANK";
    fields.push(Object.freeze({ field: keyField, value: keyState }), Object.freeze({ field: valueField, value: valueState }));
    if (key === "trackId") successCompatible = successCompatible && keyState === "EXACT" && valueState === "STRING_NONBLANK";
    else successCompatible = successCompatible && keyState === "EXACT" && (valueState === "NULL" || valueState === "STRING_BLANK");
  }
  fields.push(Object.freeze({ field: "RESPONSE_SUCCESS_COMPATIBLE", value: successCompatible ? "YES" : "NO" }));
  return Object.freeze(fields);
}

function dgiiResponse(response: HttpResponse): DgiiResponse | undefined {
  if (response.mediaType.toLowerCase() !== "application/json") return undefined;
  try {
    const item = record(JSON.parse(response.body));
    if (item === undefined || Reflect.ownKeys(item).length !== 3 || !Reflect.ownKeys(item).every((key) => key === "trackId" || key === "error" || key === "mensaje")) return undefined;
    const trackId = own(item, "trackId"); const error = own(item, "error"); const message = own(item, "mensaje");
    return typeof trackId === "string" && trackId.length <= MAX_FIELD_LENGTH && (typeof error === "string" || error === null) && (typeof message === "string" || message === null) && (error === null || error.length <= MAX_FIELD_LENGTH) && (message === null || message.length <= MAX_FIELD_LENGTH)
      ? Object.freeze({ error, mensaje: message })
      : undefined;
  } catch {
    return undefined;
  }
}

export function createTesteCfEcf31ProbeDiagnostics(): TesteCfEcf31ProbeDiagnostics {
  let authorizationFailed = false;
  let reception: HttpResponse | HttpFailure | undefined;
  let receptionObserved = false;

  return Object.freeze({
    observeAuthorization(result) {
      authorizationFailed = own(record(result) ?? {}, "ok") !== true;
    },
    observeReceptionTransport(result) {
      receptionObserved = true;
      reception = httpResponse(result) ?? httpFailure(result);
    },
    fields() {
      const values: TesteCfEcf31ProbeField[] = [];
      if (!receptionObserved && authorizationFailed) values.push(Object.freeze({ field: "FAILURE_STAGE", value: "AUTHORIZATION" }));
      else if (!receptionObserved || reception === undefined) values.push(Object.freeze({ field: "FAILURE_STAGE", value: "RECEPTION_NO_RESPONSE" }));
      else {
        values.push(Object.freeze({ field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" }));
        values.push(Object.freeze({ field: "HTTP_STATUS", value: String(reception.status) }));
        values.push(Object.freeze({ field: "RESPONSE_MEDIA_TYPE", value: reception.mediaType }));
        if ("body" in reception) {
          values.push(...structuralFields(reception));
          const dgii = dgiiResponse(reception); const error = dgii === undefined ? undefined : safeDgiiText(dgii.error); const message = dgii === undefined ? undefined : safeDgiiText(dgii.mensaje);
          if (error !== undefined) values.push(Object.freeze({ field: "DGII_ERROR", value: error }));
          if (message !== undefined) values.push(Object.freeze({ field: "DGII_MESSAGE", value: message }));
        }
      }
      return Object.freeze(values);
    },
  });
}
