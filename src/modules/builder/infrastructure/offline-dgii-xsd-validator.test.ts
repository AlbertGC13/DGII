import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  DGII_SCHEMA_IDS,
  validateOfflineDgiiXml,
} from "./offline-dgii-xsd-validator.js";

const validSeed = "<SemillaModel><valor>synthetic-seed-142</valor><fecha>2026-08-10T12:00:00Z</fecha><SyntheticIdentity>synthetic-142</SyntheticIdentity></SemillaModel>";

describe("offline DGII XSD validator", () => {
  it("loads every closed, byte-preserved DGII schema through the validator", async () => {
    expect(DGII_SCHEMA_IDS).toHaveLength(15);

    for (const schemaId of DGII_SCHEMA_IDS) {
      const result = await validateOfflineDgiiXml("<WrongRoot />", schemaId);
      expect(result, schemaId).toEqual({ ok: true, value: { valid: false } });
    }
  }, 30_000);

  it("accepts a valid synthetic Semilla document and rejects its invalid forms", async () => {
    await expect(validateOfflineDgiiXml(validSeed, "semilla-v1.0")).resolves.toEqual({ ok: true, value: { valid: true } });
    await expect(validateOfflineDgiiXml("<SemillaModel><valor>synthetic-seed-142</valor><fecha>2026-08-10T12:00:00Z</fecha></SemillaModel>", "semilla-v1.0")).resolves.toEqual({ ok: true, value: { valid: false } });
    await expect(validateOfflineDgiiXml("<ACECF />", "semilla-v1.0")).resolves.toEqual({ ok: true, value: { valid: false } });
    await expect(validateOfflineDgiiXml("<SemillaModel>", "semilla-v1.0")).resolves.toEqual({ ok: true, value: { valid: false } });
    await expect(validateOfflineDgiiXml("<!DOCTYPE SemillaModel SYSTEM 'https://example.invalid/entity.dtd'><SemillaModel />", "semilla-v1.0")).resolves.toEqual({ ok: true, value: { valid: false } });
  });

  it("rejects unknown identifiers and non-string input with safe catalog errors", async () => {
    await expect(validateOfflineDgiiXml(validSeed, "../semilla-v1.0")).resolves.toEqual({ ok: false, error: { code: "UNKNOWN_SCHEMA" } });
    await expect(validateOfflineDgiiXml(validSeed, "unknown")).resolves.toEqual({ ok: false, error: { code: "UNKNOWN_SCHEMA" } });
    await expect(validateOfflineDgiiXml({ xml: validSeed }, "semilla-v1.0")).resolves.toEqual({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("fails safely when the pinned authority root fails integrity verification", async () => {
    vi.resetModules();
    vi.doMock("../../../architecture/official-resource-integrity.js", () => ({
      verifyOfficialResourceManifest: () => [{ code: "vendored-sha256-mismatch" }],
    }));
    const validator = await import("./offline-dgii-xsd-validator.js");

    await expect(validator.validateOfflineDgiiXml(validSeed, "semilla-v1.0")).resolves.toEqual({ ok: false, error: { code: "VALIDATOR_FAILURE" } });
    vi.doUnmock("../../../architecture/official-resource-integrity.js");
  });

  it("keeps validation internal and prevents raw diagnostics, discovery, and external entities", () => {
    const builderIndex = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    const rootIndex = readFileSync(new URL("../../../index.ts", import.meta.url), "utf8");
    const source = readFileSync(new URL("./offline-dgii-xsd-validator.ts", import.meta.url), "utf8");

    expect(`${builderIndex}\n${rootIndex}`).not.toMatch(/offline-dgii-xsd-validator|validateOfflineDgiiXml/);
    expect(source).not.toMatch(/rawOutput|rawMessage|readdir|glob|fetch|http|https/i);
    expect(source).toMatch(/DOCTYPE/);
  });
});
