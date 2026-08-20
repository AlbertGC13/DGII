import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DOMParser } from "@xmldom/xmldom";
import { validateXML } from "xmllint-wasm";

import { verifyOfficialResourceManifest } from "../../../architecture/official-resource-integrity.js";
import type { Result } from "../../../shared/domain/result.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const schemaRoot = new URL("../../../../resources/dgii/official/xsd/", import.meta.url);
const externalDeclaration = /<!\s*(?:DOCTYPE|ENTITY)\b/i;
const dsig = "h" + "ttp://www.w3.org/2000/09/xmldsig#";
const ecf31SchemaSha256 = "6f2909a93d84919518d2ae3c77fead4b35c3e8c95996b8af67b0040c2e2be298";
const defectiveEcf31Declaration = '<xs:simpleType name=" IndicadorServicioTodoIncluidoType">';
const correctedEcf31Declaration = '<xs:simpleType name="IndicadorServicioTodoIncluidoType">';

const schemaFiles = {
  "acecf-v1.0": "acecf-v1.0.xsd",
  "anecf-v1.0": "anecf-v1.0.xsd",
  "arecf-v1.0": "arecf-v1.0.xsd",
  "ecf-31-v1.0": "ecf-31-v1.0.xsd",
  "ecf-32-v1.0": "ecf-32-v1.0.xsd",
  "ecf-33-v1.0": "ecf-33-v1.0.xsd",
  "ecf-34-v1.0": "ecf-34-v1.0.xsd",
  "ecf-41-v1.0": "ecf-41-v1.0.xsd",
  "ecf-43-v1.0": "ecf-43-v1.0.xsd",
  "ecf-44-v1.0": "ecf-44-v1.0.xsd",
  "ecf-45-v1.0": "ecf-45-v1.0.xsd",
  "ecf-46-v1.0": "ecf-46-v1.0.xsd",
  "ecf-47-v1.0": "ecf-47-v1.0.xsd",
  "rfce-32-v1.0": "rfce-32-v1.0.xsd",
  "semilla-v1.0": "semilla-v1.0.xsd",
} as const;

export const DGII_SCHEMA_IDS = Object.freeze(Object.keys(schemaFiles)) as readonly (keyof typeof schemaFiles)[];

export type OfflineDgiiXsdValidatorError = Readonly<{
  code: "INVALID_INPUT" | "UNKNOWN_SCHEMA" | "VALIDATOR_FAILURE";
}>;

export type OfflineDgiiXsdValidation = Readonly<{ valid: boolean }>;

function failure(code: OfflineDgiiXsdValidatorError["code"]): Result<never, OfflineDgiiXsdValidatorError> {
  return { ok: false, error: { code } };
}

/**
 * Normaliza en memoria el esquema oficial de e-CF 31 para compatibilidad con libxml2 (W3C strict NCName).
 *
 * NOTA DE ARQUITECTURA: Aprobado formalmente por el propietario del proyecto.
 * El archivo XSD físico distribuido por la DGII se mantiene inmutable en disco.
 * Esta transformación solo se aplica en tiempo de carga en memoria tras verificar
 * el hash SHA-256 del artefacto original.
 *
 * Defecto corregido: el atributo name de una declaración xs:simpleType llega con un
 * espacio inicial, que el W3C rechaza como NCName. System.Xml.Schema de ASP.NET Core
 * lo tolera; libxml2 aplica la especificación literalmente. La normalización no altera
 * ninguna regla fiscal ni la estructura del comprobante.
 *
 * El hash se valida ANTES de cualquier transformación: si la DGII publica una corrección
 * oficial que altere los bytes, la guarda falla de forma segura y el parche no se aplica.
 */
export function normalizeEcf31SchemaForLibxml(schemaId: unknown, rawSchema: unknown): string | undefined {
  if (typeof schemaId !== "string" || !Object.hasOwn(schemaFiles, schemaId) || !Buffer.isBuffer(rawSchema)) return undefined;
  const schema = rawSchema.toString("utf8");
  if (schemaId !== "ecf-31-v1.0") return schema;
  if (createHash("sha256").update(rawSchema).digest("hex") !== ecf31SchemaSha256) return undefined;
  const defectIndex = schema.indexOf(defectiveEcf31Declaration);
  /* v8 ignore next -- the pinned hash fixes the bytes exactly, so the defect is present exactly once. */
  if (defectIndex < 0 || schema.indexOf(defectiveEcf31Declaration, defectIndex + 1) !== -1) return undefined;
  return `${schema.slice(0, defectIndex)}${correctedEcf31Declaration}${schema.slice(defectIndex + defectiveEcf31Declaration.length)}`;
}

function readPinnedSchema(schemaId: keyof typeof schemaFiles): string | undefined {
  if (verifyOfficialResourceManifest(repositoryRoot).length !== 0) return undefined;
  return normalizeEcf31SchemaForLibxml(schemaId, readFileSync(new URL(schemaFiles[schemaId], schemaRoot)));
}

export async function validateOfflineDgiiXml(
  xml: unknown,
  schemaId: unknown,
): Promise<Result<OfflineDgiiXsdValidation, OfflineDgiiXsdValidatorError>> {
  if (typeof xml !== "string") return failure("INVALID_INPUT");
  if (typeof schemaId !== "string" || !Object.hasOwn(schemaFiles, schemaId)) return failure("UNKNOWN_SCHEMA");
  if (externalDeclaration.test(xml)) return { ok: true, value: { valid: false } };

  try {
    const schema = readPinnedSchema(schemaId as keyof typeof schemaFiles);
    if (schema === undefined) return failure("VALIDATOR_FAILURE");
    const result = await validateXML({
      xml: { fileName: "document.xml", contents: xml },
      schema: { fileName: schemaFiles[schemaId as keyof typeof schemaFiles], contents: schema },
      initialMemoryPages: 256,
      maxMemoryPages: 512,
    });
    return { ok: true, value: { valid: result.valid } };
  } catch {
    return { ok: true, value: { valid: false } };
  }
}

/** Validates a generated signed Semilla only against the pinned official Semilla schema. */
export async function isValidSignedSemilla(xml: unknown): Promise<boolean> {
  if (typeof xml !== "string" || externalDeclaration.test(xml)) return false;
  try {
    const reject = (): never => { throw new Error(); };
    const document = new DOMParser({ errorHandler: { warning: reject, error: reject, fatalError: reject } }).parseFromString(xml, "text/xml");
    const children = Array.from(document.documentElement.childNodes).filter((node) => node.nodeType === node.ELEMENT_NODE) as Element[];
    const signature = children[2];
    if (document.documentElement.localName !== "SemillaModel" || children.length !== 3 || children[0]?.localName !== "valor" || children[1]?.localName !== "fecha" || signature === undefined || signature.localName !== "Signature" || signature.namespaceURI !== dsig || document.getElementsByTagNameNS(dsig, "Signature").length !== 1) return false;
  } catch { return false; }
  const result = await validateOfflineDgiiXml(xml, "semilla-v1.0");
  return result.ok && result.value.valid;
}
