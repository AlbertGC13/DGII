import { types } from "node:util";

import type { Result } from "../../../shared/domain/result.js";
import { createXmlParentElement, createXmlTextElement, serializeXmlDocument } from "./xml-writer.js";
import { mapEcf31DetallesItemsXmlElement } from "./ecf31-detalles-items-xml-mapper.js";
import { mapEcf31EncabezadoXmlElement } from "./ecf31-encabezado-xml-mapper.js";

export type Ecf31XmlAssemblerError = Readonly<{
  code: "INVALID_ECF31_XML_ASSEMBLER_INPUT" | "ECF31_XML_ASSEMBLER_LINEAGE_MISMATCH" | "INVALID_ECF31_XML_ASSEMBLER_SIGNING_TIMESTAMP" | "ECF31_XML_ASSEMBLER_MAPPING_FAILED";
}>;

type Input = Readonly<{
  issuanceEvidence: unknown;
  draft: unknown;
  derivedHeaderTotalsEvidence: unknown;
  detallesItemsEvidence: unknown;
  fechaHoraFirma: string;
  priceInclusionEvidence?: unknown;
}>;

const timestamp = /^(3[01]|[12][0-9]|0[1-9])-(1[0-2]|0[1-9])-((19|20)\d{2}) (2[0-3]|[01]?[0-9]):([0-5]?[0-9]):([0-5]?[0-9])$/u;
const failure = (code: Ecf31XmlAssemblerError["code"]): Result<never, Ecf31XmlAssemblerError> => ({ ok: false, error: Object.freeze({ code }) });

function input(value: unknown): Input | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(value);
    const hasPriceInclusionEvidence = keys.includes("priceInclusionEvidence");
    const expected = ["issuanceEvidence", "draft", "derivedHeaderTotalsEvidence", "detallesItemsEvidence", "fechaHoraFirma"];
    if (keys.length !== expected.length + Number(hasPriceInclusionEvidence) || !expected.every((key) => keys.includes(key)) || keys.some((key) => !expected.includes(key as string) && key !== "priceInclusionEvidence")) return undefined;
    const read = (key: keyof Input): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true ? descriptor.value : undefined;
    };
    const issuanceEvidence = read("issuanceEvidence");
    const draft = read("draft");
    const derivedHeaderTotalsEvidence = read("derivedHeaderTotalsEvidence");
    const detallesItemsEvidence = read("detallesItemsEvidence");
    const fechaHoraFirma = read("fechaHoraFirma");
    if (issuanceEvidence === undefined || draft === undefined || derivedHeaderTotalsEvidence === undefined || detallesItemsEvidence === undefined || typeof fechaHoraFirma !== "string") return undefined;
    return Object.freeze({ issuanceEvidence, draft, derivedHeaderTotalsEvidence, detallesItemsEvidence, fechaHoraFirma, ...(hasPriceInclusionEvidence ? { priceInclusionEvidence: read("priceInclusionEvidence") } : {}) });
  } catch {
    /* v8 ignore next -- proxies are rejected above, so descriptor reads cannot throw. */
    return undefined;
  }
}

/** Assembles only the XSD-required e-CF 31 precursor; XMLDSig is appended by the signer. */
export function assembleEcf31Xml(inputValue: unknown): Result<string, Ecf31XmlAssemblerError> {
  const values = input(inputValue);
  if (values === undefined) return failure("INVALID_ECF31_XML_ASSEMBLER_INPUT");
  if (values.fechaHoraFirma.length > 19 || !timestamp.test(values.fechaHoraFirma)) return failure("INVALID_ECF31_XML_ASSEMBLER_SIGNING_TIMESTAMP");
  const encabezado = mapEcf31EncabezadoXmlElement({ issuanceEvidence: values.issuanceEvidence, draft: values.draft, derivedHeaderTotalsEvidence: values.derivedHeaderTotalsEvidence, ...(values.priceInclusionEvidence === undefined ? {} : { priceInclusionEvidence: values.priceInclusionEvidence }) });
  const detalles = mapEcf31DetallesItemsXmlElement({ evidence: values.detallesItemsEvidence });
  if (!encabezado.ok || !detalles.ok) return failure("ECF31_XML_ASSEMBLER_MAPPING_FAILED");
  const detailsEvidence = values.detallesItemsEvidence as Readonly<{ draft?: unknown }>;
  if (detailsEvidence.draft !== values.draft) return failure("ECF31_XML_ASSEMBLER_LINEAGE_MISMATCH");
  const signedAt = createXmlTextElement("FechaHoraFirma", values.fechaHoraFirma);
  /* v8 ignore next -- the fixed name and the regex-validated timestamp are writer-safe. */
  if (!signedAt.ok) return failure("ECF31_XML_ASSEMBLER_MAPPING_FAILED");
  const root = createXmlParentElement("ECF", [encabezado.value, detalles.value, signedAt.value]);
  /* v8 ignore next -- the fixed name and three freshly created child elements are writer-safe. */
  if (!root.ok) return failure("ECF31_XML_ASSEMBLER_MAPPING_FAILED");
  const serialized = serializeXmlDocument(root.value);
  /* v8 ignore next -- a freshly created registered root always serializes. */
  return serialized.ok ? { ok: true, value: serialized.value } : failure("ECF31_XML_ASSEMBLER_MAPPING_FAILED");
}
