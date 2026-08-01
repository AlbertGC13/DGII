import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreHeader } from "../domain/ecf31-core-header.js";
import type { Ecf31CoreHeader } from "../domain/ecf31-core-header.js";
import { createXmlParentElement, createXmlTextElement } from "./xml-writer.js";
import type { XmlElement } from "./xml-writer.js";

export type Ecf31PartyXmlMapperErrorCode =
  | "INVALID_ECF31_PARTY_XML_INPUT"
  | "INVALID_ECF31_PARTY_XML_HEADER"
  | "ECF31_PARTY_XML_MAPPING_FAILED";

export type Ecf31PartyXmlMapperError = Readonly<{
  code: Ecf31PartyXmlMapperErrorCode;
  message: string;
}>;

type Input = Readonly<{ header: unknown }>;
type PartyElements = Readonly<{ emisor: XmlElement; comprador: XmlElement }>;

const MESSAGES: Readonly<Record<Ecf31PartyXmlMapperErrorCode, string>> = Object.freeze({
  INVALID_ECF31_PARTY_XML_INPUT: "e-CF 31 party XML mapper input is invalid.",
  INVALID_ECF31_PARTY_XML_HEADER: "e-CF 31 party XML mapper requires a genuine core header.",
  ECF31_PARTY_XML_MAPPING_FAILED: "e-CF 31 party XML mapping failed.",
});

function failure(code: Ecf31PartyXmlMapperErrorCode): Result<never, Ecf31PartyXmlMapperError> {
  return { ok: false, error: Object.freeze({ code, message: MESSAGES[code] }) };
}

function readInput(input: unknown): Input | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
      return undefined;
    }
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 1 || keys[0] !== "header") return undefined;
    const header = Object.getOwnPropertyDescriptor(input, "header");
    if (header === undefined || !("value" in header) || !header.enumerable) return undefined;
    return Object.freeze({ header: header.value as unknown });
  } catch {
    return undefined;
  }
}

function textElement(name: string, content: string): XmlElement {
  const result = createXmlTextElement(name, content);
  if (!result.ok) throw new Error("XML mapping failed.");
  return result.value;
}

function parentElement(name: string, children: XmlElement[]): XmlElement {
  const result = createXmlParentElement(name, children);
  if (!result.ok) throw new Error("XML mapping failed.");
  return result.value;
}

function mapParties(header: Ecf31CoreHeader): PartyElements {
  const emisor = parentElement("Emisor", [
    textElement("RNCEmisor", header.issuer.taxpayerIdentifier.value),
    textElement("RazonSocialEmisor", header.issuer.legalName),
    textElement("DireccionEmisor", header.issuer.address),
    textElement("FechaEmision", header.issueDate),
  ]);
  const comprador = parentElement("Comprador", [
    textElement("RNCComprador", header.buyer.taxpayerIdentifier.value),
    textElement("RazonSocialComprador", header.buyer.legalName),
  ]);
  return Object.freeze({ emisor, comprador });
}

export function mapEcf31PartyXmlElements(input: unknown): Result<PartyElements, Ecf31PartyXmlMapperError> {
  const candidate = readInput(input);
  if (candidate === undefined) return failure("INVALID_ECF31_PARTY_XML_INPUT");
  if (!isEcf31CoreHeader(candidate.header)) return failure("INVALID_ECF31_PARTY_XML_HEADER");
  try {
    return { ok: true, value: mapParties(candidate.header) };
  } catch {
    return failure("ECF31_PARTY_XML_MAPPING_FAILED");
  }
}
