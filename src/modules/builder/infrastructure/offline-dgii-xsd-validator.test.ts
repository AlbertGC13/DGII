import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import * as rootApi from "../../../index.js";
import {
  DGII_SCHEMA_IDS,
  isValidSignedSemilla,
  validateOfflineDgiiXml,
} from "./offline-dgii-xsd-validator.js";

const unsignedSeed = "<SemillaModel><valor>synthetic-seed-142</valor><fecha>2026-08-10T12:00:00Z</fecha></SemillaModel>";
const fixturePath = fileURLToPath(new URL("../../../../test/fixtures/certificates/synthetic-test-certificate.p12", import.meta.url));

async function signedSemilla(): Promise<string> {
  const identity = rootApi.parseTaxpayerIdentifier("000000000");
  if (!identity.ok) throw new Error("Expected a synthetic identity.");
  const loaded = rootApi.loadInMemoryPkcs12({ bytes: await readFile(fixturePath), password: "synthetic-test-password", expectedIdentity: identity.value });
  if (!loaded.ok) throw new Error("Expected a synthetic certificate.");
  const certificateMaterial = loaded.value;
  const outcome = rootApi.signXmlWithAuthenticatedCertificate({ xml: unsignedSeed, certificateMaterial });
  if (!outcome.ok) throw new Error("Expected a synthetic signed Semilla.");
  const serialized = rootApi.serializeSignedXmlArtifact(outcome.value);
  if (!serialized.ok) throw new Error("Expected a synthetic signed XML artifact.");
  return serialized.value;
}

describe("offline DGII XSD validator", () => {
  it("loads every closed, byte-preserved DGII schema through the validator", async () => {
    expect(DGII_SCHEMA_IDS).toHaveLength(15);

    for (const schemaId of DGII_SCHEMA_IDS) {
      const result = await validateOfflineDgiiXml("<WrongRoot />", schemaId);
      expect(result, schemaId).toEqual({ ok: true, value: { valid: false } });
    }
  }, 30_000);

  it("rejects unsigned Semilla documents because XMLDSig must occupy the required wildcard", async () => {
    await expect(validateOfflineDgiiXml(unsignedSeed, "semilla-v1.0")).resolves.toEqual({ ok: true, value: { valid: false } });
    await expect(validateOfflineDgiiXml("<ACECF />", "semilla-v1.0")).resolves.toEqual({ ok: true, value: { valid: false } });
    await expect(validateOfflineDgiiXml("<SemillaModel>", "semilla-v1.0")).resolves.toEqual({ ok: true, value: { valid: false } });
    await expect(validateOfflineDgiiXml("<!DOCTYPE SemillaModel SYSTEM 'https://example.invalid/entity.dtd'><SemillaModel />", "semilla-v1.0")).resolves.toEqual({ ok: true, value: { valid: false } });
  });

  it("accepts a generated XMLDSig Semilla document through the official wildcard", async () => {
    await expect(signedSemilla().then((xml) => validateOfflineDgiiXml(xml, "semilla-v1.0"))).resolves.toEqual({ ok: true, value: { valid: true } });
    await expect(signedSemilla().then(isValidSignedSemilla)).resolves.toBe(true);
  });

  it("requires the sole wildcard to be one final direct XMLDSig Signature", async () => {
    const xml = await signedSemilla();
    const signature = xml.match(/<Signature[\s\S]*<\/Signature>/u)?.[0];
    if (signature === undefined) throw new Error("Expected signature.");
    for (const candidate of [xml.replace(signature, "<Synthetic/>").replace("<Synthetic/>", "<Synthetic/>"), xml.replace(signature, `<Synthetic/>${signature}`), xml.replace(signature, `${signature}<Synthetic/>`), xml.replace(signature, `${signature}${signature}`), xml.replace(signature, `<holder>${signature}</holder>`)]) await expect(isValidSignedSemilla(candidate)).resolves.toBe(false);
    await expect(isValidSignedSemilla("<")).resolves.toBe(false);
    await expect(isValidSignedSemilla(null)).resolves.toBe(false);
    await expect(isValidSignedSemilla("<!DOCTYPE SemillaModel><SemillaModel/>" )).resolves.toBe(false);
  });

  it("rejects unknown identifiers and non-string input with safe catalog errors", async () => {
    await expect(validateOfflineDgiiXml(unsignedSeed, "../semilla-v1.0")).resolves.toEqual({ ok: false, error: { code: "UNKNOWN_SCHEMA" } });
    await expect(validateOfflineDgiiXml(unsignedSeed, "unknown")).resolves.toEqual({ ok: false, error: { code: "UNKNOWN_SCHEMA" } });
    await expect(validateOfflineDgiiXml({ xml: unsignedSeed }, "semilla-v1.0")).resolves.toEqual({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("fails safely when the pinned authority root fails integrity verification", async () => {
    vi.resetModules();
    vi.doMock("../../../architecture/official-resource-integrity.js", () => ({
      verifyOfficialResourceManifest: () => [{ code: "vendored-sha256-mismatch" }],
    }));
    const validator = await import("./offline-dgii-xsd-validator.js");

    await expect(validator.validateOfflineDgiiXml(unsignedSeed, "semilla-v1.0")).resolves.toEqual({ ok: false, error: { code: "VALIDATOR_FAILURE" } });
    vi.doUnmock("../../../architecture/official-resource-integrity.js");
  });

  it("keeps validation internal and prevents raw diagnostics, discovery, and external entities", () => {
    const builderIndex = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    const rootIndex = readFileSync(new URL("../../../index.ts", import.meta.url), "utf8");
    const source = readFileSync(new URL("./offline-dgii-xsd-validator.ts", import.meta.url), "utf8");

    expect(`${builderIndex}\n${rootIndex}`).not.toMatch(/validateOfflineDgiiXml/);
    expect(source).not.toMatch(/rawOutput|rawMessage|readdir|glob|fetch|http|https/i);
    expect(source).toMatch(/DOCTYPE/);
  });
});
