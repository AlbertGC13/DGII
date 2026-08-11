import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import forge from "node-forge";

const projectDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = join(projectDirectory, "test", "fixtures", "certificates");
const fixturePath = join(fixtureDirectory, "synthetic-test-certificate.p12");
const password = "synthetic-test-password";
const subject = [
  { name: "commonName", value: "Synthetic PKCS#12 Fixture - Not a Real Identity" },
  { name: "organizationName", value: "Synthetic Test Data Only" },
  { type: "2.5.4.5", value: "000000000" },
];

const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 });
const certificate = forge.pki.createCertificate();
certificate.publicKey = keys.publicKey;
certificate.serialNumber = `00${forge.util.bytesToHex(forge.random.getBytesSync(16))}`;
certificate.validity.notBefore = new Date();
certificate.validity.notAfter = new Date(certificate.validity.notBefore);
certificate.validity.notAfter.setFullYear(certificate.validity.notBefore.getFullYear() + 1);
certificate.setSubject(subject);
certificate.setIssuer(subject);
certificate.setExtensions([
  { name: "basicConstraints", cA: false },
  { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
  { name: "subjectKeyIdentifier" },
]);
certificate.sign(keys.privateKey, forge.md.sha256.create());

const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], password, {
  friendlyName: "synthetic-pkcs12-fixture",
});

await mkdir(fixtureDirectory, { recursive: true });
await writeFile(fixturePath, Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"));
console.log(`Generated ${fixturePath}. Update its documented SHA-256 before committing.`);
