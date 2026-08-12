import { SignedXml } from "xml-crypto";
import forge from "node-forge";

const c14n = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const enveloped = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const rsaSha256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const sha256 = "http://www.w3.org/2001/04/xmlenc#sha256";

const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 });
const certificate = forge.pki.createCertificate();
certificate.publicKey = keys.publicKey;
certificate.serialNumber = "01";
certificate.validity.notBefore = new Date();
certificate.validity.notAfter = new Date(Date.now() + 60_000);
certificate.setSubject([{ name: "commonName", value: "Synthetic XMLDSig Compatibility Smoke" }]);
certificate.setIssuer(certificate.subject.attributes);
certificate.sign(keys.privateKey, forge.md.sha256.create());

const certificatePem = forge.pki.certificateToPem(certificate);
const certificateDer = Buffer.from(certificatePem
  .replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\r|\n/g, ""), "base64").toString("base64");
const signature = new SignedXml({
  privateKey: forge.pki.privateKeyToPem(keys.privateKey),
  canonicalizationAlgorithm: c14n,
  signatureAlgorithm: rsaSha256,
  getKeyInfoContent: () => `<X509Data><X509Certificate>${certificateDer}</X509Certificate></X509Data>`,
});

signature.addReference({
  xpath: "/*",
  transforms: [enveloped],
  digestAlgorithm: sha256,
  isEmptyUri: true,
});
signature.computeSignature("<ECF><Documento>synthetic</Documento></ECF>", {
  location: { reference: "/*", action: "append" },
});
const signedXml = signature.getSignedXml();

for (const expected of [
  `<CanonicalizationMethod Algorithm="${c14n}"/>`,
  `<SignatureMethod Algorithm="${rsaSha256}"/>`,
  '<Reference URI="">',
  `<Transform Algorithm="${enveloped}"/>`,
  `<DigestMethod Algorithm="${sha256}"/>`,
  "<KeyInfo><X509Data><X509Certificate>",
]) {
  if (!signedXml.includes(expected)) throw new Error(`Expected XMLDSig profile fragment is absent: ${expected}`);
}
if (!signedXml.endsWith("</Signature></ECF>")) throw new Error("Signature is not the final root child.");

const verifier = new SignedXml({ publicCert: certificatePem, getCertFromKeyInfo: () => null });
verifier.loadSignature(signature.getSignatureXml());
if (!verifier.checkSignature(signedXml)) throw new Error("Synthetic XMLDSig profile did not verify.");
if (verifier.getSignedReferences().length !== 1) throw new Error("Authenticated reference was not returned.");

console.log("Verified xml-crypto 6.1.2 DGII profile capability smoke.");
