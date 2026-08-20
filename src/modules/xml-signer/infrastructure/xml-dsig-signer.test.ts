import { readFile } from "node:fs/promises";
import { X509Certificate, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { C14nCanonicalization } from "xml-crypto/lib/c14n-canonicalization.js";
import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";

const fixturePath = fileURLToPath(new URL("../../../../test/fixtures/certificates/synthetic-test-certificate.p12", import.meta.url));
const password = "synthetic-test-password";
const c14n = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const enveloped = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const rsaSha256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const sha256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const dsig = "http://www.w3.org/2000/09/xmldsig#";

async function material() {
  const identity = rootApi.parseTaxpayerIdentifier("000000000");
  if (!identity.ok) throw new Error("Synthetic identity did not parse.");
  const loaded = rootApi.loadInMemoryPkcs12({ bytes: await readFile(fixturePath), password, expectedSignerIdentity: identity.value });
  if (!loaded.ok) throw new Error("Synthetic certificate did not load.");
  return loaded.value;
}

function serialized(result: ReturnType<typeof rootApi.serializeSignedXmlArtifact>) {
  if (!result.ok) throw new Error("Expected a signed XML artifact.");
  return result.value;
}

describe("signXmlWithAuthenticatedCertificate", () => {
  it("signs structural Semilla-like and e-CF-like XML using the exact ADR 0008 profile", async () => {
    const certificateMaterial = await material();
    for (const xml of [
      '<Semilla xmlns="https://dgii.gov.do/semilla"><Valor>synthetic</Valor></Semilla>',
      '<ECF xmlns="https://dgii.gov.do/ecf"><Encabezado><IdDoc>synthetic</IdDoc></Encabezado></ECF>',
    ]) {
      const outcome = rootApi.signXmlWithAuthenticatedCertificate({ xml, certificateMaterial });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(rootApi.isSignedXmlArtifact(outcome.value)).toBe(true);
      const output = serialized(rootApi.serializeSignedXmlArtifact(outcome.value));
      const document = new DOMParser().parseFromString(output, "text/xml");
      const signature = document.getElementsByTagNameNS(dsig, "Signature")[0];
      if (signature === undefined) throw new Error("Missing signature.");
      expect(document.documentElement.lastChild).toBe(signature);
      expect(output).toContain(`<CanonicalizationMethod Algorithm="${c14n}"/>`);
      expect(output).toContain(`<SignatureMethod Algorithm="${rsaSha256}"/>`);
      expect(output).toContain('<Reference URI="">');
      expect(output).toContain(`<Transforms><Transform Algorithm="${enveloped}"/><Transform Algorithm="${c14n}"/></Transforms>`);
      expect(output).toContain(`<DigestMethod Algorithm="${sha256}"/>`);
      expect(output).toContain("<KeyInfo><X509Data><X509Certificate>");
      expect(output).not.toContain("KeyValue");
      expect(output).not.toContain("<Object");

      const encodedCertificate = /<X509Certificate>([^<]+)<\/X509Certificate>/u.exec(output)?.[1];
      if (encodedCertificate === undefined) throw new Error("Missing controlled certificate.");
      const verifier = new SignedXml({ publicCert: new X509Certificate(Buffer.from(encodedCertificate, "base64")).toString(), getCertFromKeyInfo: () => null });
      verifier.loadSignature(new XMLSerializer().serializeToString(signature));
      expect(verifier.checkSignature(output)).toBe(true);
      expect(verifier.getSignedReferences()).toHaveLength(1);
    }
  });

  it("digests the canonical form when namespace declarations are not in canonical order", async () => {
    // Reproduces the DGII semilla shape: xsi is declared before xsd, so a serializer that preserves
    // source order diverges from Inclusive C14N, which sorts namespace declarations by prefix.
    const xml = '<SemillaModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><valor>synthetic</valor><fecha>2026-08-19T22:54:46.7869709-04:00</fecha></SemillaModel>';
    const outcome = rootApi.signXmlWithAuthenticatedCertificate({ xml, certificateMaterial: await material() });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const output = serialized(rootApi.serializeSignedXmlArtifact(outcome.value));

    const stripped = new DOMParser().parseFromString(output, "text/xml");
    const signature = stripped.getElementsByTagNameNS(dsig, "Signature")[0];
    if (signature === undefined) throw new Error("Missing signature.");
    signature.parentNode?.removeChild(signature);
    const canonical = new C14nCanonicalization().process(stripped.documentElement, {});

    // Inclusive C14N sorts namespace declarations by prefix regardless of source order.
    expect(canonical).toContain('<SemillaModel xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">');
    const expectedDigest = createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("base64");
    expect(output).toContain(`<DigestValue>${expectedDigest}</DigestValue>`);
  });

  it("implements preserveWhitespace=false before XMLDSig processing without changing meaningful text", async () => {
    const outcome = rootApi.signXmlWithAuthenticatedCertificate({
      xml: '<ECF atributo="  preserved  ">\n  <Contenido> text kept </Contenido>\n  <Grupo>\n    <Valor>value</Valor>\n  </Grupo>\n</ECF>',
      certificateMaterial: await material(),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const output = serialized(rootApi.serializeSignedXmlArtifact(outcome.value));
    expect(output).toContain("<Contenido> text kept </Contenido>");
    expect(output).toContain('atributo="  preserved  "');
    expect(output).toContain("<Grupo><Valor>value</Valor></Grupo>");
    expect(output).not.toContain("\n");
  });

  it("rejects unsafe XML and hostiles without exposing parser or signing diagnostics", async () => {
    const certificateMaterial = await material();
    const accessor = { certificateMaterial };
    Object.defineProperty(accessor, "xml", { enumerable: true, get: () => { throw new Error("secret"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const invalid: unknown[] = [
      null, [], {}, { xml: "", certificateMaterial }, { xml: "<ECF/>", certificateMaterial: {} },
      { xml: "<ECF>", certificateMaterial },
      { xml: '<!DOCTYPE ECF SYSTEM "https://example.invalid/dtd"><ECF/>', certificateMaterial },
      { xml: '<!DOCTYPE ECF [<!ENTITY x "x">]><ECF>&x;</ECF>', certificateMaterial },
      { xml: "<?ambiguous value?><ECF/>", certificateMaterial },
      { xml: "<ECF/><other/>", certificateMaterial },
      { xml: `<ECF><child><ds:Signature xmlns:ds="${dsig}"/></child></ECF>`, certificateMaterial },
      { xml: "<SemillaModel><valor>synthetic-seed-142</valor><fecha>2026-08-10T12:00:00Z</fecha><SyntheticIdentity>synthetic-142</SyntheticIdentity></SemillaModel>", certificateMaterial },
      accessor, revoked.proxy, new Proxy({}, { ownKeys: () => { throw new Error("secret"); } }),
    ];
    for (const input of invalid) {
      expect(() => rootApi.signXmlWithAuthenticatedCertificate(input)).not.toThrow();
      const result = rootApi.signXmlWithAuthenticatedCertificate(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toMatch(/^[A-Z_]+$/u);
    }
  });

  it("keeps artifacts opaque, immutable, and unforgeable", async () => {
    const signed = rootApi.signXmlWithAuthenticatedCertificate({ xml: "<ECF><Valor>synthetic</Valor></ECF>", certificateMaterial: await material() });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(Object.keys(signed.value)).toEqual([]);
    expect(Object.isFrozen(signed.value)).toBe(true);
    expect(rootApi.isSignedXmlArtifact({ ...signed.value })).toBe(false);
    expect(rootApi.serializeSignedXmlArtifact({ ...signed.value })).toMatchObject({ ok: false });
    expect(rootApi.serializeSignedXmlArtifact(new Proxy(signed.value, {}))).toMatchObject({ ok: false });
  });
});

it("exports the XMLDSig signer from the package root", () => {
  expect(rootApi.signXmlWithAuthenticatedCertificate).toBeTypeOf("function");
  expect(rootApi.isSignedXmlArtifact).toBeTypeOf("function");
  expect(rootApi.serializeSignedXmlArtifact).toBeTypeOf("function");
});
