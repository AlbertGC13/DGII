import { createPrivateKey, X509Certificate } from "node:crypto";
import forge from "node-forge";

import { isTaxpayerIdentifier, parseTaxpayerIdentifier } from "../../fiscal-identity/index.js";
import type { ParsedTaxpayerIdentifier } from "../../fiscal-identity/index.js";
import type { Result } from "../../../shared/domain/result.js";

export type CertificateLoadError = Readonly<{ code: "INVALID_CERTIFICATE_INPUT" | "PKCS12_DECODE_REJECTED" | "PKCS12_MATERIAL_MISSING" | "PKCS12_MATERIAL_AMBIGUOUS" | "PKCS12_KEY_CERTIFICATE_MISMATCH" | "CERTIFICATE_IDENTITY_MISMATCH" }>;
export type AuthenticatedCertificateMaterial = object;
export type AuthenticatedCertificateMetadata = Readonly<{ identity: Readonly<{ kind: "rnc" | "cedula"; value: string }>; validFrom: string; validTo: string; fingerprint256: string }>;
type Candidate = Readonly<{ certificate: X509Certificate; privateKey: ReturnType<typeof createPrivateKey>; identity: ParsedTaxpayerIdentifier | undefined }>;
type CertificateBag = forge.pkcs12.Bag & Readonly<{ cert: forge.pki.Certificate }>;
type KeyBag = forge.pkcs12.Bag & Readonly<{ key: forge.pki.PrivateKey }>;

const materials = new WeakSet<AuthenticatedCertificateMaterial>();
const metadata = new WeakMap<AuthenticatedCertificateMaterial, AuthenticatedCertificateMetadata>();
const nativeMaterials = new WeakMap<AuthenticatedCertificateMaterial, Readonly<{ certificate: X509Certificate; privateKey: ReturnType<typeof createPrivateKey> }>>();
const failure = (code: CertificateLoadError["code"]): Result<never, CertificateLoadError> => ({ ok: false, error: Object.freeze({ code }) });
const certBagType = forge.pki.oids["certBag"] as string;
const shroudedKeyBagType = forge.pki.oids["pkcs8ShroudedKeyBag"] as string;
const keyBagType = forge.pki.oids["keyBag"] as string;

function input(input: unknown): Readonly<{ bytes: Buffer; password: string; expectedIdentity: ParsedTaxpayerIdentifier }> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 3 || !["bytes", "password", "expectedIdentity"].every((key) => keys.includes(key))) return undefined;
    const values: unknown[] = [];
    for (const key of ["bytes", "password", "expectedIdentity"]) {
      const value = Object.getOwnPropertyDescriptor(input, key);
      if (value === undefined || !("value" in value) || !value.enumerable) return undefined;
      values.push(value.value as unknown);
    }
    const [bytes, password, expectedIdentity] = values;
    if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) || bytes.byteLength === 0 || typeof password !== "string" || !isTaxpayerIdentifier(expectedIdentity)) return undefined;
    return Object.freeze({ bytes: Buffer.from(bytes), password, expectedIdentity });
  } catch { return undefined; }
}

function bags(p12: forge.pkcs12.Pkcs12Pfx, type: string): forge.pkcs12.Bag[] {
  return p12.getBags({ bagType: type })[type] ?? [];
}

function attribute(bag: forge.pkcs12.Bag, name: "localKeyId" | "friendlyName"): string | undefined {
  const attributes = bag.attributes as Readonly<Record<string, readonly unknown[]>> | undefined;
  const value = attributes?.[name]?.[0];
  return typeof value === "string" && value.length > 0 ? (name === "localKeyId" ? Buffer.from(value, "binary").toString("hex") : value) : undefined;
}

function correlates(certificate: forge.pkcs12.Bag, key: forge.pkcs12.Bag): boolean {
  for (const name of ["localKeyId", "friendlyName"] as const) {
    const left = attribute(certificate, name); const right = attribute(key, name);
    if (left !== undefined && right !== undefined && left !== right) return false;
  }
  return true;
}

function subjectIdentity(certificate: forge.pki.Certificate): ParsedTaxpayerIdentifier | undefined {
  const serialNumbers = certificate.subject.attributes
    .filter((attribute) => attribute.type === "2.5.4.5" && typeof attribute.value === "string")
    .map((attribute) => attribute.value as string);
  if (serialNumbers.length !== 1) return undefined;
  const normalized = serialNumbers[0]?.replace(/[ -]/g, "");
  const parsed = parseTaxpayerIdentifier(normalized);
  return parsed.ok ? parsed.value : undefined;
}

export function loadInMemoryPkcs12(inputValue: unknown): Result<AuthenticatedCertificateMaterial, CertificateLoadError> {
  const values = input(inputValue);
  if (values === undefined) return failure("INVALID_CERTIFICATE_INPUT");
  let p12: forge.pkcs12.Pkcs12Pfx;
  try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(values.bytes.toString("binary")), values.password); } catch { return failure("PKCS12_DECODE_REJECTED"); }
  const certificates = bags(p12, certBagType).filter((bag): bag is CertificateBag => bag.cert !== undefined);
  const keys = [...bags(p12, shroudedKeyBagType), ...bags(p12, keyBagType)].filter((bag): bag is KeyBag => bag.key !== undefined);
  if (certificates.length === 0 || keys.length === 0) return failure("PKCS12_MATERIAL_MISSING");
  const candidates: Candidate[] = [];
  for (const certificateBag of certificates) for (const keyBag of keys) {
    if (!correlates(certificateBag, keyBag)) continue;
    try {
      const certificate = new X509Certificate(forge.pki.certificateToPem(certificateBag.cert));
      const privateKey = createPrivateKey(forge.pki.privateKeyToPem(keyBag.key));
      if (certificate.checkPrivateKey(privateKey)) candidates.push({ certificate, privateKey, identity: subjectIdentity(certificateBag.cert) });
    } catch { /* Candidate conversion failures are indistinguishable from a nonmatching pair. */ }
  }
  if (candidates.length === 0) return failure("PKCS12_KEY_CERTIFICATE_MISMATCH");
  if (candidates.length !== 1) return failure("PKCS12_MATERIAL_AMBIGUOUS");
  const selected = candidates[0] as Candidate;
  const actualIdentity = selected.identity;
  if (actualIdentity === undefined || actualIdentity.kind !== values.expectedIdentity.kind || actualIdentity.value !== values.expectedIdentity.value) return failure("CERTIFICATE_IDENTITY_MISMATCH");
  const material = Object.freeze(Object.create(null)) as AuthenticatedCertificateMaterial;
  const safeMetadata = Object.freeze({ identity: Object.freeze({ kind: actualIdentity.kind, value: actualIdentity.value }),
    validFrom: new Date(selected.certificate.validFrom).toISOString(), validTo: new Date(selected.certificate.validTo).toISOString(), fingerprint256: selected.certificate.fingerprint256 });
  materials.add(material); metadata.set(material, safeMetadata); nativeMaterials.set(material, selected);
  return { ok: true, value: material };
}

export function isAuthenticatedCertificateMaterial(input: unknown): input is AuthenticatedCertificateMaterial {
  return typeof input === "object" && input !== null && materials.has(input);
}

export function getAuthenticatedCertificateMetadata(input: unknown): AuthenticatedCertificateMetadata | undefined {
  return typeof input === "object" && input !== null ? metadata.get(input) : undefined;
}
