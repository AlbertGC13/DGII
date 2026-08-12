import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";

const fixturePath = fileURLToPath(new URL("../../../../test/fixtures/certificates/synthetic-test-certificate.p12", import.meta.url));
const password = "synthetic-test-password";

async function signedXml(): Promise<string> {
  const identity = rootApi.parseTaxpayerIdentifier("000000000");
  if (!identity.ok) throw new Error("Synthetic identity did not parse.");
  const loaded = rootApi.loadInMemoryPkcs12({ bytes: await readFile(fixturePath), password, expectedIdentity: identity.value });
  if (!loaded.ok) throw new Error("Synthetic certificate did not load.");
  const signed = rootApi.signXmlWithAuthenticatedCertificate({ xml: "<ECF><Documento attribute=\"synthetic\">value</Documento></ECF>", certificateMaterial: loaded.value });
  if (!signed.ok) throw new Error("Fixture XML did not sign.");
  const serialized = rootApi.serializeSignedXmlArtifact(signed.value);
  if (!serialized.ok) throw new Error("Fixture XML did not serialize.");
  return serialized.value;
}

function verified(result: ReturnType<typeof rootApi.verifyDgiiXmlSignature>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected verification, received ${result.error.code}`);
  return result.value;
}

describe("verifyDgiiXmlSignature", () => {
  it("verifies the production signer output and exposes only authenticated unsigned XML", async () => {
    const artifact = verified(rootApi.verifyDgiiXmlSignature({ xml: await signedXml() }));
    expect(rootApi.isVerifiedSignedXmlArtifact(artifact)).toBe(true);
    const serialized = rootApi.serializeAuthenticatedXml(artifact);
    expect(serialized).toMatchObject({ ok: true });
    if (serialized.ok) {
      expect(serialized.value).toContain('<Documento attribute="synthetic">value</Documento>');
      expect(serialized.value).not.toContain("Signature");
    }
    expect(Object.keys(artifact)).toEqual([]);
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(rootApi.serializeAuthenticatedXml({ ...artifact })).toMatchObject({ ok: false });
    expect(rootApi.serializeAuthenticatedXml(new Proxy(artifact, {}))).toMatchObject({ ok: false });
  });

  it("rejects tampering and malformed or unsafe inputs with safe catalog errors", async () => {
    const xml = await signedXml();
    const hostile = Proxy.revocable({}, {}); hostile.revoke();
    const invalid: unknown[] = [
      null, [], {}, { xml: "" }, { xml: "<ECF>" }, { xml: "<!DOCTYPE ECF><ECF/>" },
      { xml: "<?unexpected value?><ECF/>" }, { xml: "<ECF/><other/>" }, hostile.proxy,
      { xml: xml.replace("value", "changed") }, { xml: xml.replace('attribute="synthetic"', 'attribute="changed"') },
      { xml: xml.replace("<Documento", "\n<Documento") }, { xml: xml.replace(/<DigestValue>([^<])/u, "<DigestValue>x") },
      { xml: xml.replace(/<SignatureValue>([^<])/u, "<SignatureValue>x") },
      { xml: xml.replace(/<X509Certificate>([^<])/u, "<X509Certificate>x") },
    ];
    for (const input of invalid) {
      expect(() => rootApi.verifyDgiiXmlSignature(input)).not.toThrow();
      const result = rootApi.verifyDgiiXmlSignature(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toMatch(/^(INVALID_XML_DSIG_VERIFICATION_INPUT|UNSAFE_XML_DSIG_INPUT|INVALID_XML_DSIG_PROFILE|XML_DSIG_VERIFICATION_FAILED)$/u);
    }
  });

  it("rejects profile, wrapping, duplicate ID, and hostile-proxy variants before verification", async () => {
    const xml = await signedXml();
    const signature = xml.match(/<Signature[\s\S]*<\/Signature>/u)?.[0];
    if (signature === undefined) throw new Error("Fixture signature was absent.");
    const variants = [
      xml.replace("</KeyInfo></Signature>", "</KeyInfo><Object/></Signature>"),
      xml.replace("</Signature></ECF>", `</Signature>${signature}</ECF>`),
      xml.replace("<ECF", '<ECF Id="one" ID="one"'),
      xml.replace('<Reference URI="">', '<Reference URI="#wrapped">'),
      xml.replace("</Transforms>", '</Transforms><Transform Algorithm="urn:extra"/>'),
      xml.replace("</ECF>", "<other/></ECF>"),
    ];
    for (const candidate of variants) expect(rootApi.verifyDgiiXmlSignature({ xml: candidate })).toMatchObject({ ok: false, error: { code: "INVALID_XML_DSIG_PROFILE" } });
    expect(rootApi.verifyDgiiXmlSignature(new Proxy({ xml }, { getOwnPropertyDescriptor: () => { throw new Error("secret"); } }))).toMatchObject({ ok: false });
  });
});

it("exports the XMLDSig verifier from the package root", () => {
  expect(rootApi.verifyDgiiXmlSignature).toBeTypeOf("function");
  expect(rootApi.isVerifiedSignedXmlArtifact).toBeTypeOf("function");
  expect(rootApi.serializeAuthenticatedXml).toBeTypeOf("function");
});
