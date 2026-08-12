import { X509Certificate } from "node:crypto";
import { SignedXml } from "xml-crypto";
import forge from "node-forge";

import { getAuthenticatedCertificateKeyInfoContent, loadInMemoryPkcs12, parseTaxpayerIdentifier, signWithAuthenticatedCertificate } from "../dist/index.js";

const c14n = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const enveloped = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const rsaSha256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const sha256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const password = "synthetic-xml-crypto-smoke-password";

const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 });
const certificate = forge.pki.createCertificate();
certificate.publicKey = keys.publicKey;
certificate.serialNumber = "01";
certificate.validity.notBefore = new Date();
certificate.validity.notAfter = new Date(Date.now() + 60_000);
certificate.setSubject([{ type: "2.5.4.5", value: "000000000" }]);
certificate.setIssuer(certificate.subject.attributes);
certificate.sign(keys.privateKey, forge.md.sha256.create());
const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], password);
const identity = parseTaxpayerIdentifier("000000000");
if (!identity.ok) throw new Error("Synthetic identity did not parse.");
const loaded = loadInMemoryPkcs12({ bytes: Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"), password, expectedIdentity: identity.value });
if (!loaded.ok) throw new Error(`Synthetic certificate loading failed: ${loaded.error.code}`);
const keyInfo = getAuthenticatedCertificateKeyInfoContent(loaded.value);
if (!keyInfo.ok) throw new Error(`Synthetic KeyInfo retrieval failed: ${keyInfo.error.code}`);

function OpaqueRsaSha256() {
  this.getSignature = (signedInfo) => {
    const signed = signWithAuthenticatedCertificate({ material: loaded.value, data: signedInfo });
    if (!signed.ok) throw new Error(`Opaque certificate signing failed: ${signed.error.code}`);
    return signed.value;
  };
  this.getAlgorithmName = () => rsaSha256;
}

// xml-crypto checks only for a truthy privateKey before dispatching; this sentinel is not key material and is ignored.
const signature = new SignedXml({ privateKey: "opaque-certificate-capability", canonicalizationAlgorithm: c14n, signatureAlgorithm: rsaSha256, getKeyInfoContent: () => keyInfo.value });
signature.SignatureAlgorithms[rsaSha256] = OpaqueRsaSha256;
signature.addReference({ xpath: "/*", transforms: [enveloped], digestAlgorithm: sha256, isEmptyUri: true });
signature.computeSignature("<ECF><Documento>synthetic</Documento></ECF>", { location: { reference: "/*", action: "append" } });
const signedXml = signature.getSignedXml();

for (const expected of [`<CanonicalizationMethod Algorithm="${c14n}"/>`, `<SignatureMethod Algorithm="${rsaSha256}"/>`, '<Reference URI="">', `<Transform Algorithm="${enveloped}"/>`, `<DigestMethod Algorithm="${sha256}"/>`, "<KeyInfo><X509Data><X509Certificate>"]) {
  if (!signedXml.includes(expected)) throw new Error(`Expected XMLDSig profile fragment is absent: ${expected}`);
}
if (!signedXml.endsWith("</Signature></ECF>")) throw new Error("Signature is not the final root child.");

const encodedCertificate = keyInfo.value.match(/<X509Certificate>([^<]+)<\/X509Certificate>/)?.[1];
if (encodedCertificate === undefined) throw new Error("Opaque KeyInfo has no certificate.");
const verifier = new SignedXml({ publicCert: new X509Certificate(Buffer.from(encodedCertificate, "base64")).toString(), getCertFromKeyInfo: () => null });
verifier.loadSignature(signature.getSignatureXml());
if (!verifier.checkSignature(signedXml)) throw new Error("Synthetic XMLDSig profile did not verify.");
if (verifier.getSignedReferences().length !== 1) throw new Error("Authenticated reference was not returned.");

console.log("Verified xml-crypto 6.1.2 DGII profile through opaque certificate signing.");
