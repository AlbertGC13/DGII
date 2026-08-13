import type { DgiiAuthentication } from "../../dgii-auth/index.js";
import type { Result } from "../../../shared/domain/result.js";

export type DgiiResultConsultationError = Readonly<{ code: "INVALID_DGII_RESULT_CONSULTATION_CONFIGURATION" | "DGII_RESULT_CONSULTATION_FAILED" }>;
export type DgiiResultConsultation = Readonly<{ consult(trackId: string): Promise<Result<DgiiResultEvidence, DgiiResultConsultationError>> }>;
export type DgiiResultEvidence = Readonly<{ trackId: string; codigo: 0 | 1 | 2 | 3 | 4; classification: "indeterminate" | "accepted" | "rejected" | "in-process" | "accepted-conditional"; estado: string; rnc: string | null; eNCF: string | null; fechaRecepcion: string | null; mensajes: readonly string[]; secuenciaUtilizada: boolean | null; sequenceDisposition: "consumed-non-reusable" | "potentially-reusable-no-blind-resend" | null }>;
type Input = Readonly<{ authentication: Pick<DgiiAuthentication, "authorize" | "get"> }>;
type Response = Readonly<{ status: number; mediaType: string; body: string }>;
const MAX = 256;
const failure = (): Result<never, DgiiResultConsultationError> => ({ ok: false, error: Object.freeze({ code: "DGII_RESULT_CONSULTATION_FAILED" }) });
const own = (value: object, key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
const requiredText = (value: unknown): string | undefined => typeof value === "string" && Array.from(value).length <= MAX && value.trim().length > 0 && !Array.from(value).some((character) => { const point = character.codePointAt(0); return point !== undefined && (point <= 31 || point === 127); }) ? value : undefined;
const optionalText = (value: unknown): string | null | undefined => value === null ? null : requiredText(value);

function input(value: unknown): Input | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 1) return undefined;
    const authentication = own(value, "authentication");
    if (typeof authentication !== "object" || authentication === null || typeof own(authentication, "authorize") !== "function" || typeof own(authentication, "get") !== "function") return undefined;
    return Object.freeze({ authentication: authentication as Pick<DgiiAuthentication, "authorize" | "get"> });
  } catch { return undefined; }
}

function response(value: unknown): Response | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const status = own(value, "status"); const mediaType = own(value, "mediaType"); const body = own(value, "body");
    return typeof status === "number" && typeof mediaType === "string" && typeof body === "string" && body.length <= 65_536 ? { status, mediaType, body } : undefined;
  } catch { return undefined; }
}

function parse(body: string, requestedTrackId: string): DgiiResultEvidence | undefined {
  try {
    const rawKeys: string[] = [];
    for (const match of body.matchAll(/"(?:\\.|[^"\\])*"\s*:/gu)) {
      rawKeys.push(JSON.parse(match[0].slice(0, match[0].lastIndexOf(":"))) as string);
    }
    if (new Set(rawKeys).size !== rawKeys.length) return undefined;
    const item: unknown = JSON.parse(body);
    if (typeof item !== "object" || item === null || Array.isArray(item) || Object.getPrototypeOf(item) !== Object.prototype) return undefined;
    const keys = Object.keys(item); const allowed = new Set(["trackId", "codigo", "estado", "rnc", "eNCF", "encf", "fechaRecepcion", "mensajes", "secuenciaUtilizada"]);
    if (!keys.every((key) => allowed.has(key)) || new Set(keys).size !== keys.length || (keys.includes("eNCF") && keys.includes("encf"))) return undefined;
    const trackId = requiredText(own(item, "trackId")); const estado = requiredText(own(item, "estado")); const rawCode = own(item, "codigo");
    const rawCodigo = typeof rawCode === "number" && Number.isInteger(rawCode) ? rawCode : typeof rawCode === "string" && /^(?:0|[1-4])$/u.test(rawCode) ? Number(rawCode) : -1;
    if (trackId !== requestedTrackId || estado === undefined || rawCodigo < 0 || rawCodigo > 4) return undefined;
    const codigo = rawCodigo as 0 | 1 | 2 | 3 | 4;
    const classification = ["indeterminate", "accepted", "rejected", "in-process", "accepted-conditional"] as const;
    if (codigo === 0 || codigo === 3) return Object.freeze({ trackId, codigo, classification: classification[codigo], estado, rnc: null, eNCF: null, fechaRecepcion: null, mensajes: Object.freeze([]), secuenciaUtilizada: null, sequenceDisposition: null });
    const rnc = own(item, "rnc") === undefined ? null : optionalText(own(item, "rnc")); const eNCF = own(item, "eNCF") === undefined && own(item, "encf") === undefined ? null : optionalText(own(item, "eNCF") ?? own(item, "encf")); const fechaRecepcion = own(item, "fechaRecepcion") === undefined ? null : optionalText(own(item, "fechaRecepcion")); const rawMessages = own(item, "mensajes");
    if (rnc === undefined || eNCF === undefined || fechaRecepcion === undefined || (rawMessages !== undefined && (!Array.isArray(rawMessages) || rawMessages.length > 100 || rawMessages.some((message) => requiredText(message) === undefined)))) return undefined;
    const secuenciaUtilizada = own(item, "secuenciaUtilizada");
    if (codigo === 2 && typeof secuenciaUtilizada !== "boolean") return undefined;
    if (codigo !== 2 && secuenciaUtilizada !== undefined && secuenciaUtilizada !== null && typeof secuenciaUtilizada !== "boolean") return undefined;
    const mensajes = rawMessages === undefined ? [] : (rawMessages as unknown[]).map((message) => requiredText(message) as string);
    return Object.freeze({ trackId, codigo, classification: classification[codigo], estado, rnc, eNCF, fechaRecepcion, mensajes: Object.freeze(mensajes), secuenciaUtilizada: typeof secuenciaUtilizada === "boolean" ? secuenciaUtilizada : null, sequenceDisposition: codigo !== 2 ? null : secuenciaUtilizada ? "consumed-non-reusable" : "potentially-reusable-no-blind-resend" });
  } catch { return undefined; }
}

/** Queries one TrackId through the authorization owner and returns bounded immutable evidence. */
export function createDgiiResultConsultation(inputValue: unknown): Result<DgiiResultConsultation, DgiiResultConsultationError> {
  const values = input(inputValue);
  if (!values) return { ok: false, error: Object.freeze({ code: "INVALID_DGII_RESULT_CONSULTATION_CONFIGURATION" }) };
  return { ok: true, value: Object.freeze({ async consult(trackId) {
    try {
      if (requiredText(trackId) === undefined) return failure();
      const authorization = await values.authentication.authorize(); if (!authorization.ok) return failure();
      const upstream = await values.authentication.get(authorization.value, { service: "ecf", path: "api/consultas/estado", trackId, accept: "json" });
      const received = upstream.ok ? response(upstream.value) : undefined;
      const evidence = received !== undefined && received.status === 200 && received.mediaType === "application/json" ? parse(received.body, trackId) : undefined;
      return evidence === undefined ? failure() : { ok: true, value: evidence };
    } catch { return failure(); }
  } }) };
}
