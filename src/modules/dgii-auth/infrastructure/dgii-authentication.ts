import { DOMParser } from "@xmldom/xmldom";

import { getAuthenticatedCertificateMetadata } from "../../certificate/index.js";
import type { AuthenticatedCertificateMaterial } from "../../certificate/index.js";
import type { DgiiEnvironment, DgiiHttpTransport } from "../../http-transport/index.js";
import { serializeSignedXmlArtifact, signXmlWithAuthenticatedCertificate } from "../../xml-signer/index.js";
import { isValidSignedSemilla } from "../../builder/index.js";
import type { Result } from "../../../shared/domain/result.js";

export type DgiiAuthenticationError = Readonly<{ code: "INVALID_DGII_AUTHENTICATION_CONFIGURATION" | "DGII_AUTHENTICATION_FAILED" }>;
export type DgiiAuthorization = object;
export type DgiiAuthentication = Readonly<{ authorize(): Promise<Result<DgiiAuthorization, DgiiAuthenticationError>>; authorizationHeader(authorization: unknown): string | undefined; invalidate(): void }>;

type Token = Readonly<{ value: string; expiresAt: number }>;
type Input = Readonly<{ environment: DgiiEnvironment; authenticationRoot: string; transport: DgiiHttpTransport; certificateMaterial: AuthenticatedCertificateMaterial; clock: () => Date }>;
const cache = new Map<string, Token>();
const flights = new Map<string, Readonly<{ generation: number; promise: Promise<Result<Token, DgiiAuthenticationError>> }>>();
const generations = new Map<string, number>();
const failure = (): Result<never, DgiiAuthenticationError> => ({ ok: false, error: Object.freeze({ code: "DGII_AUTHENTICATION_FAILED" }) });
const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)?$/u;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/u;

function input(value: unknown): Input | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const item = value as Record<string, unknown>; const metadata = getAuthenticatedCertificateMetadata(item["certificateMaterial"]);
    if (!metadata || (item["environment"] !== "TesteCF" && item["environment"] !== "CerteCF" && item["environment"] !== "production") || typeof item["authenticationRoot"] !== "string" || !/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/u.test(item["authenticationRoot"]) || typeof item["clock"] !== "function" || typeof item["transport"] !== "object" || item["transport"] === null || typeof (item["transport"] as Record<string, unknown>)["get"] !== "function" || typeof (item["transport"] as Record<string, unknown>)["postMultipart"] !== "function") return undefined;
    return Object.freeze({ environment: item["environment"], authenticationRoot: item["authenticationRoot"], transport: item["transport"] as DgiiHttpTransport, certificateMaterial: item["certificateMaterial"] as AuthenticatedCertificateMaterial, clock: item["clock"] as () => Date });
  } catch { return undefined; }
}

function validDate(value: string, pattern: RegExp): boolean {
  if (!pattern.test(value) || Number.isNaN(Date.parse(value))) return false;
  const year = Number(value.slice(0, 4)); const month = Number(value.slice(5, 7)); const day = Number(value.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day)).getUTCFullYear() === year && new Date(Date.UTC(year, month - 1, day)).getUTCMonth() === month - 1 && new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
}

function unsignedSemilla(xml: string): boolean {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml) || /<\?/u.test(xml.replace(/^\s*<\?xml\s[^?]*\?>/iu, ""))) return false;
  try {
    const reject = (): never => { throw new Error(); };
    const document = new DOMParser({ errorHandler: { warning: reject, error: reject, fatalError: reject } }).parseFromString(xml, "text/xml");
    const roots = Array.from(document.childNodes).filter((node) => node.nodeType === node.ELEMENT_NODE);
    const root = document.documentElement;
    const elements = Array.from(root.childNodes).filter((node) => node.nodeType === node.ELEMENT_NODE) as Element[];
    return roots.length === 1 && root.localName === "SemillaModel" && !root.namespaceURI && root.attributes.length === 0 && elements.length === 2 && elements[0]?.localName === "valor" && elements[1]?.localName === "fecha" && validDate(elements[1].textContent, dateTime) && Array.from(root.childNodes).every((node) => node.nodeType === node.ELEMENT_NODE || (node.nodeType === node.TEXT_NODE && !/\S/u.test(node.textContent ?? ""))) && elements.every((element) => element.attributes.length === 0 && Array.from(element.childNodes).every((node) => node.nodeType === node.TEXT_NODE || node.nodeType === node.CDATA_SECTION_NODE));
  } catch { return false; }
}

function token(body: string): Token | undefined {
  try {
    const value: unknown = JSON.parse(body);
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 3) return undefined;
    const record = value as Record<string, unknown>; const expiresAt = typeof record["expira"] === "string" && validDate(record["expira"], timestamp) ? Date.parse(record["expira"]) : Number.NaN; const issuedAt = typeof record["expedido"] === "string" && validDate(record["expedido"], timestamp) ? Date.parse(record["expedido"]) : Number.NaN;
    return Object.keys(record).every((key) => key === "token" || key === "expira" || key === "expedido") && typeof record["token"] === "string" && record["token"].length > 0 && Number.isFinite(expiresAt) && Number.isFinite(issuedAt) && expiresAt > issuedAt ? Object.freeze({ value: record["token"], expiresAt }) : undefined;
  } catch { return undefined; }
}

async function acquire(values: Input): Promise<Result<Token, DgiiAuthenticationError>> {
  try {
    const seed = await values.transport.get({ service: "ecf", path: "api/autenticacion/semilla" }, "xml");
    if (!seed.ok || seed.value.mediaType !== "application/xml" || !unsignedSemilla(seed.value.body)) return failure();
    const signed = signXmlWithAuthenticatedCertificate({ xml: seed.value.body, certificateMaterial: values.certificateMaterial });
    if (!signed.ok) return failure(); const xml = serializeSignedXmlArtifact(signed.value);
    if (!xml.ok || !(await isValidSignedSemilla(xml.value))) return failure();
    const response = await values.transport.postMultipart({ service: "ecf", path: "api/autenticacion/validarsemilla", accept: "json", file: { fieldName: "xml", mediaType: "text/xml", content: xml.value } });
    if (!response.ok || response.value.mediaType !== "application/json") return failure();
    const parsed = token(response.value.body); return parsed === undefined || parsed.expiresAt <= values.clock().getTime() ? failure() : { ok: true, value: parsed };
  } catch { return failure(); }
}

/** Creates an opaque, in-process Semilla authorization boundary. */
export function createDgiiAuthentication(inputValue: unknown): Result<DgiiAuthentication, DgiiAuthenticationError> {
  const values = input(inputValue);
  if (!values) return { ok: false, error: Object.freeze({ code: "INVALID_DGII_AUTHENTICATION_CONFIGURATION" }) };
  const fingerprint = getAuthenticatedCertificateMetadata(values.certificateMaterial)?.fingerprint256;
  if (fingerprint === undefined) return { ok: false, error: Object.freeze({ code: "INVALID_DGII_AUTHENTICATION_CONFIGURATION" }) };
  const key = `${values.environment}|${values.authenticationRoot}|${fingerprint}`;
  const authorizations = new WeakMap<DgiiAuthorization, string>();
  const authorization = (value: string): Result<DgiiAuthorization, never> => { const artifact = Object.freeze(Object.create(null)) as DgiiAuthorization; authorizations.set(artifact, `Bearer ${value}`); return { ok: true, value: artifact }; };
  return { ok: true, value: Object.freeze({
    async authorize() {
      try {
        const now = values.clock().getTime(); const existing = cache.get(key);
        if (existing && existing.expiresAt - now > 300_000) return authorization(existing.value);
        const generation = generations.get(key) ?? 0; let flight = flights.get(key);
        if (!flight || flight.generation !== generation) { const promise = acquire(values); flight = Object.freeze({ generation, promise }); flights.set(key, flight); }
        const result = await flight.promise;
        if (flights.get(key) === flight) flights.delete(key);
        if (result.ok && (generations.get(key) ?? 0) === flight.generation) cache.set(key, result.value);
        const current = values.clock().getTime();
        if (!result.ok && existing && existing.expiresAt > current) return authorization(existing.value);
        return result.ok ? authorization(result.value.value) : result;
      } catch { return failure(); }
    },
    authorizationHeader(value) { return typeof value === "object" && value !== null ? authorizations.get(value) : undefined; },
    invalidate() { cache.delete(key); flights.delete(key); generations.set(key, (generations.get(key) ?? 0) + 1); },
  }) };
}
