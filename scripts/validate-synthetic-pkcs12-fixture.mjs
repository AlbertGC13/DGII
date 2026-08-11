import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import forge from "node-forge";

const projectDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(projectDirectory, "test", "fixtures", "certificates", "synthetic-test-certificate.p12");
const readmePath = join(projectDirectory, "test", "fixtures", "certificates", "README.md");
const password = "synthetic-test-password";
const subjectSerialNumber = "000000000";
const commonName = "Synthetic PKCS#12 Fixture - Not a Real Identity";

function bags(p12, bagType) {
  return p12.getBags({ bagType })[bagType] ?? [];
}

function publicKeyFingerprint(publicKey) {
  return forge.pki.getPublicKeyFingerprint(publicKey, { encoding: "hex", type: "SubjectPublicKeyInfo" });
}

const [fixture, readme] = await Promise.all([readFile(fixturePath), readFile(readmePath, "utf8")]);
const documentedHash = /SHA-256:\s*`([a-f0-9]{64})`/u.exec(readme)?.[1];
const actualHash = createHash("sha256").update(fixture).digest("hex");

if (documentedHash === undefined || documentedHash !== actualHash) {
  throw new Error("Synthetic PKCS#12 fixture hash does not match its documentation.");
}

const p12 = forge.pkcs12.pkcs12FromAsn1(
  forge.asn1.fromDer(fixture.toString("binary")),
  password,
);
const certificateBags = bags(p12, forge.pki.oids.certBag);
const keyBags = bags(p12, forge.pki.oids.pkcs8ShroudedKeyBag);

if (certificateBags.length !== 1 || keyBags.length !== 1
  || certificateBags[0]?.cert === undefined || keyBags[0]?.key === undefined) {
  throw new Error("Synthetic PKCS#12 fixture must contain exactly one certificate and one private key.");
}

const certificate = certificateBags[0].cert;
const privateKey = keyBags[0].key;
const serialNumber = certificate.subject.getField({ type: "2.5.4.5" })?.value;

if (serialNumber !== subjectSerialNumber) {
  throw new Error("Synthetic PKCS#12 fixture has an unexpected subject serialNumber.");
}
if (certificate.subject.getField("CN")?.value !== commonName || certificate.publicKey.n.bitLength() !== 2048) {
  throw new Error("Synthetic PKCS#12 fixture certificate subject or RSA key size is unexpected.");
}
if (!certificate.verify(certificate)) {
  throw new Error("Synthetic PKCS#12 fixture certificate is not self-signed.");
}

const privateKeyFingerprint = publicKeyFingerprint(forge.pki.rsa.setPublicKey(privateKey.n, privateKey.e));
if (publicKeyFingerprint(certificate.publicKey) !== privateKeyFingerprint) {
  throw new Error("Synthetic PKCS#12 fixture certificate and private key do not match.");
}

console.log(`Validated synthetic PKCS#12 fixture: ${actualHash}`);
