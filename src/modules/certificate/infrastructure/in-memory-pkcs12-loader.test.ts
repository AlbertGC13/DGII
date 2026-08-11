import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import forge from "node-forge";
import { describe, expect, it, vi } from "vitest";

import * as rootApi from "../../../index.js";

const fixturePath = fileURLToPath(new URL("../../../../test/fixtures/certificates/synthetic-test-certificate.p12", import.meta.url));
const password = "synthetic-test-password";

function identity(value = "000000000") {
  const parsed = rootApi.parseTaxpayerIdentifier(value);
  if (!parsed.ok) throw new Error("Expected a synthetic fiscal identity.");
  return parsed.value;
}

function certificate(key: forge.pki.rsa.PrivateKey, serialNumbers: readonly string[] = ["000000000"]) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2030-01-01T00:00:00.000Z");
  cert.validity.notAfter = new Date("2031-01-01T00:00:00.000Z");
  cert.setSubject(serialNumbers.map((value) => ({ type: "2.5.4.5", value })));
  cert.setIssuer([{ type: "2.5.4.5", value: "000000000" }]);
  cert.sign(key);
  return cert;
}

function container(key: forge.pki.rsa.PrivateKey | null, certificates: forge.pki.Certificate[] | null) {
  return Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(key, certificates as never, password, certificates === null ? { generateLocalKeyId: false } : undefined)).getBytes(), "binary");
}

describe("loadInMemoryPkcs12", () => {
  it("loads the checked-in synthetic fixture and exposes only safe metadata", async () => {
    const bytes = await readFile(fixturePath);
    const outcome = rootApi.loadInMemoryPkcs12({ bytes, password, expectedIdentity: identity() });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const metadata = rootApi.getAuthenticatedCertificateMetadata(outcome.value);
    expect(metadata?.identity).toEqual({ kind: "rnc", value: "000000000" });
    expect(metadata?.fingerprint256).toMatch(/^[A-F0-9:]+$/);
    expect(rootApi.isAuthenticatedCertificateMaterial(outcome.value)).toBe(true);
    expect(Object.getOwnPropertyNames(outcome.value)).toEqual([]);
    expect(JSON.stringify(outcome.value)).toBe("{}");
    expect(rootApi.loadInMemoryPkcs12({ bytes: new Uint8Array(bytes), password, expectedIdentity: identity() }).ok).toBe(true);
  });

  it("rejects hostile or invalid input without evaluating getters", () => {
    const accessor = {};
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const inconsistent = new Proxy({}, { getOwnPropertyDescriptor: () => undefined, ownKeys: () => ["bytes", "password", "expectedIdentity"] });
    Object.defineProperty(accessor, "bytes", { enumerable: true, get: () => { throw new Error("secret"); } });
    for (const input of [null, [], {}, { bytes: Buffer.alloc(0), password, expectedIdentity: identity() },
      { bytes: Buffer.from("x"), password: null, expectedIdentity: identity() },
      { bytes: Buffer.from("x"), password, expectedIdentity: { kind: "rnc", value: "000000000" } }, accessor, revoked.proxy, inconsistent]) {
      expect(() => rootApi.loadInMemoryPkcs12(input)).not.toThrow();
      expect(rootApi.loadInMemoryPkcs12(input)).toMatchObject({ ok: false, error: { code: "INVALID_CERTIFICATE_INPUT" } });
    }
  });

  it("returns catalog failures for malformed bytes and a wrong password", async () => {
    for (const input of [Buffer.from("not a p12"), await readFile(fixturePath)]) {
      const outcome = rootApi.loadInMemoryPkcs12({ bytes: input, password: input.length === 9 ? password : "wrong", expectedIdentity: identity() });
      expect(outcome).toMatchObject({ ok: false, error: { code: "PKCS12_DECODE_REJECTED" } });
      expect(JSON.stringify(outcome)).not.toContain("forge");
    }
  });

  it("rejects a selected pair whose subject identity does not match", () => {
    const key = forge.pki.rsa.generateKeyPair({ bits: 512 }).privateKey;
    for (const serialNumber of ["000000000", "not-domestic"]) expect(rootApi.loadInMemoryPkcs12({ bytes: container(key, [certificate(key, [serialNumber])]), password, expectedIdentity: identity("00000000000") }))
      .toMatchObject({ ok: false, error: { code: "CERTIFICATE_IDENTITY_MISMATCH" } });
  });

  it("requires exactly one structured subject serialNumber and conservatively normalizes it", () => {
    const key = forge.pki.rsa.generateKeyPair({ bits: 512 }).privateKey;
    for (const serialNumbers of [[], ["000000000", "000000000"]]) expect(rootApi.loadInMemoryPkcs12({ bytes: container(key, [certificate(key, serialNumbers)]), password, expectedIdentity: identity() }))
      .toMatchObject({ ok: false, error: { code: "CERTIFICATE_IDENTITY_MISMATCH" } });
    const outcome = rootApi.loadInMemoryPkcs12({ bytes: container(key, [certificate(key, ["000 - 000 000"])]), password, expectedIdentity: identity() });
    expect(outcome.ok).toBe(true);
  });

  it("does not pair bags when their available correlation attributes disagree", async () => {
    const bytes = await readFile(fixturePath);
    const decoded = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(bytes.toString("binary")), password);
    const certBagType = forge.pki.oids["certBag"] as string;
    const keyBagType = forge.pki.oids["pkcs8ShroudedKeyBag"] as string;
    const certificateBag = decoded.getBags({ bagType: certBagType })[certBagType]?.[0];
    const keyBag = decoded.getBags({ bagType: keyBagType })[keyBagType]?.[0];
    if (certificateBag === undefined || keyBag === undefined) throw new Error("Expected fixture bags.");
    (certificateBag.attributes as Record<string, string[]>)["friendlyName"] = ["certificate"];
    (keyBag.attributes as Record<string, string[]>)["friendlyName"] = ["key"];
    vi.spyOn(forge.pkcs12, "pkcs12FromAsn1").mockReturnValueOnce(decoded);
    expect(rootApi.loadInMemoryPkcs12({ bytes, password, expectedIdentity: identity() })).toMatchObject({ ok: false, error: { code: "PKCS12_KEY_CERTIFICATE_MISMATCH" } });
  });

  it("rejects missing, ambiguous, and cryptographically mismatched material", () => {
    const first = forge.pki.rsa.generateKeyPair({ bits: 512 }).privateKey;
    const second = forge.pki.rsa.generateKeyPair({ bits: 512 }).privateKey;
    expect(rootApi.loadInMemoryPkcs12({ bytes: container(first, null), password, expectedIdentity: identity() }))
      .toMatchObject({ ok: false, error: { code: "PKCS12_MATERIAL_MISSING" } });
    expect(rootApi.loadInMemoryPkcs12({ bytes: container(null, [certificate(first)]), password, expectedIdentity: identity() }))
      .toMatchObject({ ok: false, error: { code: "PKCS12_MATERIAL_MISSING" } });
    expect(rootApi.loadInMemoryPkcs12({ bytes: container(first, [certificate(first), certificate(first)]), password, expectedIdentity: identity() }))
      .toMatchObject({ ok: false, error: { code: "PKCS12_MATERIAL_AMBIGUOUS" } });
    expect(rootApi.loadInMemoryPkcs12({ bytes: container(first, [certificate(second)]), password, expectedIdentity: identity() }))
      .toMatchObject({ ok: false, error: { code: "PKCS12_KEY_CERTIFICATE_MISMATCH" } });
  });

  it("treats omitted decoder bag arrays as missing material", async () => {
    vi.spyOn(forge.pkcs12, "pkcs12FromAsn1").mockReturnValueOnce({ getBags: () => ({}) } as unknown as forge.pkcs12.Pkcs12Pfx);
    expect(rootApi.loadInMemoryPkcs12({ bytes: await readFile(fixturePath), password, expectedIdentity: identity() }))
      .toMatchObject({ ok: false, error: { code: "PKCS12_MATERIAL_MISSING" } });
  });
});

describe("certificate module exports", () => {
  it("exposes the same public API from the certificate module and package root", async () => {
    const certificateApi = await import("../index.js");
    expect(certificateApi.loadInMemoryPkcs12).toBe(rootApi.loadInMemoryPkcs12);
    expect(rootApi.getAuthenticatedCertificateMetadata(null)).toBeUndefined();
  });
});
