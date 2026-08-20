import { DOMParser } from "@xmldom/xmldom";

import { parseENcf, parseTaxpayerIdentifier } from "../../fiscal-identity/index.js";
import type { DgiiAuthentication } from "../../dgii-auth/index.js";
import { isVerifiedSignedXmlArtifact, serializeAuthenticatedXml, serializeVerifiedSignedXml } from "../../xml-signer/index.js";
import type { Result } from "../../../shared/domain/result.js";

export type DgiiReceptionError = Readonly<{ code: "INVALID_DGII_RECEPTION_CONFIGURATION" | "DGII_RECEPTION_FAILED" }>;
export type DgiiReception = Readonly<{ submit(artifact: unknown): Promise<Result<Readonly<{ trackId: string }>, DgiiReceptionError>> }>;
type Response = Readonly<{ status: number; mediaType: string; body: string }>;
type Input = Readonly<{ authentication: Pick<DgiiAuthentication, "authorize" | "postMultipart"> }>;
const receptionPath = "api/facturaselectronicas";
const MAX_TRACK_ID_LENGTH = 256;
const MAX_RESPONSE_BODY_LENGTH = 65_536;
const failed = (): Result<never, DgiiReceptionError> => ({ ok: false, error: Object.freeze({ code: "DGII_RECEPTION_FAILED" }) });

function input(value: unknown): Input | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    if (Reflect.ownKeys(value).length !== 1) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "authentication"); const authentication = descriptor !== undefined && "value" in descriptor && descriptor.enumerable ? descriptor.value as unknown : undefined;
    if (typeof authentication !== "object" || authentication === null) return undefined;
    const capability = authentication as Record<string, unknown>;
    if (typeof capability["authorize"] !== "function" || typeof capability["postMultipart"] !== "function") return undefined;
    return Object.freeze({ authentication: capability as Pick<DgiiAuthentication, "authorize" | "postMultipart"> });
  } catch { return undefined; }
}

function identity(xml: string): Readonly<{ fileName: string }> | undefined {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  const child = (parent: Element, name: string): Element | undefined => {
    const children = Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === node.ELEMENT_NODE && (node as Element).localName === name);
    return children.length === 1 ? children[0] : undefined;
  };
  const root = document.documentElement;
  /* v8 ignore next 3 -- verified artifacts have one ECF root; retain defense at this public boundary. */
  if (root.localName !== "ECF" || Array.from(document.childNodes).filter((node) => node.nodeType === node.ELEMENT_NODE).length !== 1) return undefined;
  const header = child(root, "Encabezado");
  /* v8 ignore next -- verifier/XSD rejects a verified ECF without its direct header. */
  if (!header) return undefined;
  const issuer = child(header, "Emisor"); const documentIdentity = child(header, "IdDoc");
  if (!issuer || !documentIdentity) return undefined;
  const rnc = child(issuer, "RNCEmisor")?.textContent;
  const eNcf = child(documentIdentity, "eNCF")?.textContent;
  const parsedRnc = parseTaxpayerIdentifier(rnc); const parsedENcf = parseENcf(eNcf);
  return parsedRnc.ok && parsedENcf.ok ? Object.freeze({ fileName: `${parsedRnc.value.value}${parsedENcf.value.value}.xml` }) : undefined;
}

function response(value: unknown): Response | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const item = value as Record<string, unknown>;
  return typeof item["status"] === "number" && typeof item["mediaType"] === "string" && item["mediaType"].length <= 128 && typeof item["body"] === "string" && item["body"].length <= MAX_RESPONSE_BODY_LENGTH ? item as Response : undefined;
}

function trackId(value: Response): string | undefined {
  try {
    if (value.status !== 200 || value.mediaType !== "application/json") return undefined;
    const item: unknown = JSON.parse(value.body);
    if (typeof item !== "object" || item === null || Array.isArray(item) || Object.keys(item).length !== 3) return undefined;
    const record = item as Record<string, unknown>;
    const error = record["error"]; const message = record["mensaje"]; const receivedTrackId = record["trackId"];
    if (!Object.keys(record).every((key) => key === "trackId" || key === "error" || key === "mensaje") || typeof receivedTrackId !== "string" || receivedTrackId.length > MAX_TRACK_ID_LENGTH || typeof error !== "string" && error !== null || typeof message !== "string" && message !== null || (typeof error === "string" && error.length > MAX_TRACK_ID_LENGTH) || (typeof message === "string" && message.length > MAX_TRACK_ID_LENGTH) || error?.trim() || message?.trim()) return undefined;
    const id = receivedTrackId.trim(); return id.length > 0 && id.length <= MAX_TRACK_ID_LENGTH ? id : undefined;
  } catch { return undefined; }
}

/** Accepts a verifier capability, derives upload identity from authenticated XML, and contains all boundary failures. */
export function createDgiiReception(inputValue: unknown): Result<DgiiReception, DgiiReceptionError> {
  const values = input(inputValue);
  if (!values) return { ok: false, error: Object.freeze({ code: "INVALID_DGII_RECEPTION_CONFIGURATION" }) };
  return { ok: true, value: Object.freeze({ async submit(artifact) {
    try {
      if (!isVerifiedSignedXmlArtifact(artifact)) return failed();
      const authenticated = serializeAuthenticatedXml(artifact); const signed = serializeVerifiedSignedXml(artifact);
      const unsigned = authenticated as Readonly<{ ok: true; value: string }>;
      const derived = identity(unsigned.value);
      if (!derived) return failed();
      const original = signed as Readonly<{ ok: true; value: string }>;
       const authorization = await values.authentication.authorize();
       if (!authorization.ok) return failed();
       const upstream = await values.authentication.postMultipart(authorization.value, { service: "ecf", path: receptionPath, accept: "json", file: { fieldName: "xml", mediaType: "text/xml", fileName: derived.fileName, content: original.value } });
       const posted = upstream.ok ? response(upstream.value) : undefined;
      const id = posted === undefined ? undefined : trackId(posted);
      return id === undefined ? failed() : { ok: true, value: Object.freeze({ trackId: id }) };
    } catch { return failed(); }
  } }) };
}
