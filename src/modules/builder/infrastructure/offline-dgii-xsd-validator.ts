import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { validateXML } from "xmllint-wasm";

import { verifyOfficialResourceManifest } from "../../../architecture/official-resource-integrity.js";
import type { Result } from "../../../shared/domain/result.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const schemaRoot = new URL("../../../../resources/dgii/official/xsd/", import.meta.url);
const externalDeclaration = /<!\s*(?:DOCTYPE|ENTITY)\b/i;

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

function readPinnedSchema(schemaId: keyof typeof schemaFiles): string | undefined {
  if (verifyOfficialResourceManifest(repositoryRoot).length !== 0) return undefined;
  return readFileSync(new URL(schemaFiles[schemaId], schemaRoot), "utf8");
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
