/**
 * TEMPORARY diagnostic — captures the literal DGII /validarsemilla response.
 *
 * The certificate password is read from a hidden TTY prompt. It never touches
 * argv, the environment, or the shell history, matching the secret-handling
 * posture of scripts/invoke-testecf-auth-smoke.ps1.
 *
 * Any bearer token in the response is redacted before printing, so the output
 * is safe to share.
 *
 * Requires a prior `pnpm build`.
 *
 * Usage: node scripts/testecf-diagnose-capture.mjs <absolute-p12-path> <rnc>
 */
import { readFileSync } from "node:fs";
import { createHash, createVerify, X509Certificate } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import forge from "node-forge";
import { C14nCanonicalization } from "xml-crypto/lib/c14n-canonicalization.js";
import * as xmlCryptoUtils from "xml-crypto/lib/utils.js";

import {
  getAuthenticatedCertificateMetadata,
  loadInMemoryPkcs12,
  serializeSignedXmlArtifact,
  signXmlWithAuthenticatedCertificate,
} from "../dist/index.js";

const AUTH_ROOT = "https://ecf.dgii.gov.do/testecf/autenticacion";
const SEED_URL = `${AUTH_ROOT}/api/autenticacion/semilla`;
const VALIDATE_URL = `${AUTH_ROOT}/api/autenticacion/validarsemilla`;
const DSIG = "http://www.w3.org/2000/09/xmldsig#";
const TIMEOUT_MS = 20_000;

const certificatePath = process.argv[2];
const rnc = process.argv[3];

if (typeof certificatePath !== "string" || typeof rnc !== "string" || !/^[0-9]{9}$/u.test(rnc)) {
  console.error("Usage: node scripts/testecf-diagnose-capture.mjs <absolute-p12-path> <rnc>");
  process.exit(1);
}

function log(message) {
  console.log(`[DIAG] ${message}`);
}

/** Redacts JWT-shaped values so the captured output can be shared safely. */
function redact(text) {
  return text.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu, "<REDACTED-JWT>");
}

function promptHiddenPassword(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error("stdin is not a TTY; run this from an interactive terminal."));
      return;
    }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buffer = "";
    const finish = (value) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n" || character === "\u0004") {
          finish(buffer);
          return;
        }
        if (character === "\u0003") {
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (character === "\u007f" || character === "\b") buffer = buffer.slice(0, -1);
        else buffer += character;
      }
    };
    stdin.on("data", onData);
  });
}

/** Reproduces what a .NET SignedXml verifier does: re-canonicalize, then check. */
function verifyLocally(signedXml) {
  const document = new DOMParser().parseFromString(signedXml, "text/xml");
  const signedInfo = document.getElementsByTagNameNS(DSIG, "SignedInfo")[0];
  const ancestorNamespaces = xmlCryptoUtils.findAncestorNs(document, "//*[local-name()='SignedInfo']");
  const canonicalSignedInfo = new C14nCanonicalization().process(signedInfo, { ancestorNamespaces });

  const signatureValue = signedXml.match(/<SignatureValue>([^<]+)<\/SignatureValue>/u)?.[1];
  const encodedCertificate = signedXml.match(/<X509Certificate>([^<]+)<\/X509Certificate>/u)?.[1];
  if (signatureValue === undefined || encodedCertificate === undefined) {
    return { signatureValid: false, digestValid: false, reason: "signature or certificate missing" };
  }
  const certificate = new X509Certificate(Buffer.from(encodedCertificate, "base64"));
  const verifier = createVerify("RSA-SHA256");
  verifier.update(Buffer.from(canonicalSignedInfo, "utf8"));
  const signatureValid = verifier.verify(certificate.publicKey, Buffer.from(signatureValue, "base64"));

  const enveloped = new DOMParser().parseFromString(signedXml, "text/xml");
  const signatureElement = enveloped.getElementsByTagNameNS(DSIG, "Signature")[0];
  signatureElement.parentNode.removeChild(signatureElement);
  const canonicalDocument = new C14nCanonicalization().process(enveloped.documentElement, {});
  const recomputedDigest = createHash("sha256").update(Buffer.from(canonicalDocument, "utf8")).digest("base64");
  const claimedDigest = signedXml.match(/<DigestValue>([^<]+)<\/DigestValue>/u)?.[1];

  return { signatureValid, digestValid: recomputedDigest === claimedDigest, claimedDigest, recomputedDigest };
}

/**
 * Reports which subject attribute carries the taxpayer identifier, without printing
 * personal data. Only the identifier-shaped run is revealed; other values stay hidden.
 */
function describeSubject(bytes, password) {
  const asn1 = forge.asn1.fromDer(Buffer.from(bytes).toString("binary"));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  const bagsByType = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  for (const bag of bagsByType) {
    if (bag.cert === undefined) continue;
    log("Subject attributes:");
    for (const attribute of bag.cert.subject.attributes) {
      const value = typeof attribute.value === "string" ? attribute.value : "";
      const identifier = /(?<![0-9])([0-9][0-9 -]{7,13}[0-9])(?![0-9])/u.exec(value)?.[1];
      // For the serialNumber attribute the exact FORMAT decides whether extraction succeeds, so its
      // shape is reported with letters masked as A: it shows surrounding prefixes without the content.
      const shape = value.replace(/[0-9]/gu, "9").replace(/[A-Za-z]/gu, "A");
      const shown = identifier === undefined
        ? `<hidden, ${value.length} chars>`
        : `identifier-shaped run "${identifier}", full value shape "${shape}"`;
      log(`  ${attribute.type} (${attribute.shortName ?? attribute.name ?? "?"}): ${shown}`);
    }
  }
}

async function main() {
  const bytes = readFileSync(certificatePath);
  const password = await promptHiddenPassword("Certificate password: ");

  log("Loading PKCS#12...");
  const material = loadInMemoryPkcs12({ bytes, password });
  if (!material.ok) {
    log(`FAILED to load certificate: ${JSON.stringify(material.error)}`);
    process.exit(1);
  }
  const metadata = getAuthenticatedCertificateMetadata(material.value);
  log(`Certificate identity : ${metadata?.identity.kind}=${metadata?.identity.value || "<none>"}`);
  log(`Certificate validity : ${metadata?.validFrom} -> ${metadata?.validTo}`);
  log(`Expected RNC         : ${rnc}`);
  log(`Identity matches RNC : ${metadata?.identity.value === rnc}`);
  const now = new Date();
  log(`Currently valid      : ${new Date(metadata?.validFrom) <= now && now <= new Date(metadata?.validTo)}`);
  try { describeSubject(bytes, password); } catch (error) { log(`Subject inspection failed: ${error instanceof Error ? error.message : String(error)}`); }

  log("GET semilla...");
  const seedResponse = await fetch(SEED_URL, { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const seedXml = await seedResponse.text();
  log(`  Status: ${seedResponse.status} ${seedResponse.headers.get("content-type") ?? ""}`);
  log(`  Body  : ${seedXml}`);
  if (!seedResponse.ok) process.exit(1);

  log("Signing semilla...");
  const signed = signXmlWithAuthenticatedCertificate({ xml: seedXml, certificateMaterial: material.value });
  if (!signed.ok) {
    log(`FAILED to sign: ${JSON.stringify(signed.error)}`);
    process.exit(1);
  }
  const serialized = serializeSignedXmlArtifact(signed.value);
  if (!serialized.ok) {
    log(`FAILED to serialize: ${JSON.stringify(serialized.error)}`);
    process.exit(1);
  }

  const local = verifyLocally(serialized.value);
  log(`Local signature valid: ${local.signatureValid}`);
  log(`Local digest valid   : ${local.digestValid}`);

  log("=== SIGNED XML (certificate body elided) ===");
  console.log(serialized.value.replace(/(<X509Certificate>)[^<]+/u, "$1<CERT-BODY-ELIDED>"));
  log("=== END SIGNED XML ===");

  log("POST validarsemilla (multipart/form-data, field \"xml\")...");
  const form = new FormData();
  form.set("xml", new Blob([serialized.value], { type: "text/xml" }), "semilla.xml");
  const validateResponse = await fetch(VALIDATE_URL, {
    method: "POST",
    headers: { accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const validateBody = await validateResponse.text();
  log(`  Status      : ${validateResponse.status} ${validateResponse.statusText}`);
  log(`  Content-Type: ${validateResponse.headers.get("content-type") ?? "<none>"}`);
  log(`  Body        : ${redact(validateBody)}`);
}

main().catch((error) => {
  console.error(`[DIAG] Fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
