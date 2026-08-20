import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import type { SignatureAlgorithm } from "xml-crypto/lib/types.js";

import { getAuthenticatedCertificateKeyInfoContent, isAuthenticatedCertificateMaterial, signWithAuthenticatedCertificate } from "../../certificate/index.js";
import type { AuthenticatedCertificateMaterial } from "../../certificate/index.js";
import type { Result } from "../../../shared/domain/result.js";

export type XmlDsigSigningError = Readonly<{ code: "INVALID_XML_DSIG_SIGNING_INPUT" | "UNSAFE_XML_DSIG_INPUT" | "XML_DSIG_ALREADY_PRESENT" | "XML_DSIG_SIGNING_FAILED" }>;
export type SignedXmlArtifact = object;

type Input = Readonly<{ xml: string; certificateMaterial: AuthenticatedCertificateMaterial }>;

const c14n = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const enveloped = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const rsaSha256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const sha256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const dsig = "http://www.w3.org/2000/09/xmldsig#";
const artifacts = new WeakSet<SignedXmlArtifact>();
const artifactXml = new WeakMap<SignedXmlArtifact, string>();

function failure(code: XmlDsigSigningError["code"]): Result<never, XmlDsigSigningError> {
  return { ok: false, error: Object.freeze({ code }) };
}

function input(inputValue: unknown): Input | undefined {
  try {
    if (typeof inputValue !== "object" || inputValue === null || Array.isArray(inputValue) || Object.getPrototypeOf(inputValue) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(inputValue);
    if (keys.length !== 2 || !["xml", "certificateMaterial"].every((key) => keys.includes(key))) return undefined;
    const xml = Object.getOwnPropertyDescriptor(inputValue, "xml");
    const certificateMaterial = Object.getOwnPropertyDescriptor(inputValue, "certificateMaterial");
    if (xml === undefined || certificateMaterial === undefined || !("value" in xml) || !("value" in certificateMaterial) || !xml.enumerable || !certificateMaterial.enumerable
      || typeof xml.value !== "string" || xml.value.trim().length === 0 || !isAuthenticatedCertificateMaterial(certificateMaterial.value)) return undefined;
    return Object.freeze({ xml: xml.value, certificateMaterial: certificateMaterial.value });
  } catch { return undefined; }
}

function hasUnsafeSyntax(xml: string): boolean {
  if (/<!(?:DOCTYPE|ENTITY)\b/iu.test(xml)) return true;
  const withoutDeclaration = xml.replace(/^\s*<\?xml\s[^?]*\?>/iu, "");
  return /<\?/u.test(withoutDeclaration);
}

function parse(xml: string): Document | undefined {
  if (hasUnsafeSyntax(xml)) return undefined;
  try {
    const reject = (): never => { throw new Error("XML parse rejected."); };
    const document = new DOMParser({ errorHandler: { warning: reject, error: reject, fatalError: reject } }).parseFromString(xml, "text/xml");
    const roots = Array.from(document.childNodes).filter((node) => node.nodeType === node.ELEMENT_NODE);
    return roots.length !== 1 ? undefined : document;
  } catch { return undefined; }
}

function containsSignature(node: Node): boolean {
  const element = node as Element;
  if (node.nodeType === node.ELEMENT_NODE && element.namespaceURI === dsig && element.localName === "Signature") return true;
  const children = node.childNodes as unknown as NodeListOf<ChildNode> | null;
  return children !== null && Array.from(children).some(containsSignature);
}

function hasReservedSemillaWildcard(document: Document): boolean {
  if (document.documentElement.localName !== "SemillaModel") return false;
  return Array.from(document.documentElement.childNodes).some((node) => node.nodeType === node.ELEMENT_NODE && (node as Element).localName === "SyntheticIdentity");
}

/** Applies the DGII preserveWhitespace=false source parsing semantic; XMLDSig canonicalization remains xml-crypto's responsibility. */
function removeInsignificantWhitespace(node: Node): void {
  const nodeChildren = node.childNodes as unknown as NodeListOf<ChildNode> | null;
  if (nodeChildren === null) return;
  for (const child of Array.from(nodeChildren)) removeInsignificantWhitespace(child);
  const children = Array.from(nodeChildren);
  const hasMeaningfulText = children.some((child) => (child.nodeType === child.TEXT_NODE || child.nodeType === child.CDATA_SECTION_NODE) && /\S/u.test((child as CharacterData).data));
  if (hasMeaningfulText) return;
  for (const child of children) if (child.nodeType === child.TEXT_NODE && !/\S/u.test((child as CharacterData).data)) node.removeChild(child);
}

function normalizedXml(xml: string): Result<string, XmlDsigSigningError> {
  const document = parse(xml);
  if (document === undefined) return failure("UNSAFE_XML_DSIG_INPUT");
  if (containsSignature(document) || hasReservedSemillaWildcard(document)) return failure("XML_DSIG_ALREADY_PRESENT");
  try {
    removeInsignificantWhitespace(document);
    return { ok: true, value: new XMLSerializer().serializeToString(document, false, undefined, { requireWellFormed: true }) };
  } catch { return failure("UNSAFE_XML_DSIG_INPUT"); }
}

function signatureAlgorithm(material: AuthenticatedCertificateMaterial): new () => SignatureAlgorithm {
  return class {
    getSignature(signedInfo: string): string {
      // xml-crypto hands over the Inclusive C14N form of SignedInfo, which is the exact
      // byte sequence a verifier reconstructs from the emitted signature. It is signed as-is.
      const signed = signWithAuthenticatedCertificate({ material, data: signedInfo });
      if (!signed.ok) throw new Error("Certificate signing failed.");
      return signed.value;
    }

    getAlgorithmName(): string { return rsaSha256; }

    verifySignature(): boolean { return false; }
  };
}

/**
 * Signs one XML root after DGII preserveWhitespace=false source normalization.
 *
 * Whitespace-only text nodes in element-only content are removed before signing;
 * non-whitespace text and attributes are preserved. This is not manual C14N.
 */
export function signXmlWithAuthenticatedCertificate(inputValue: unknown): Result<SignedXmlArtifact, XmlDsigSigningError> {
  const values = input(inputValue);
  if (values === undefined) return failure("INVALID_XML_DSIG_SIGNING_INPUT");
  const normalized = normalizedXml(values.xml);
  if (!normalized.ok) return normalized;
  const keyInfo = getAuthenticatedCertificateKeyInfoContent(values.certificateMaterial);
  if (!keyInfo.ok) return failure("XML_DSIG_SIGNING_FAILED");
  try {
    // The sentinel satisfies xml-crypto dispatch but is never passed to the opaque signing capability.
    const signed = new SignedXml({ privateKey: "opaque-certificate-capability", canonicalizationAlgorithm: c14n, signatureAlgorithm: rsaSha256, getKeyInfoContent: () => keyInfo.value });
    signed.SignatureAlgorithms[rsaSha256] = signatureAlgorithm(values.certificateMaterial);
    // The canonicalization algorithm must terminate the Reference transform chain. xml-crypto applies
    // only the listed transforms, and the enveloped transform yields a DOM node, so without a trailing
    // C14N transform the digest would be taken over xmldom's serializer output instead of canonical XML.
    signed.addReference({ xpath: "/*", transforms: [enveloped, c14n], digestAlgorithm: sha256, isEmptyUri: true });
    signed.computeSignature(normalized.value, { location: { reference: "/*", action: "append" } });
    const xml = signed.getSignedXml();
    const artifact = Object.freeze(Object.create(null)) as SignedXmlArtifact;
    artifacts.add(artifact); artifactXml.set(artifact, xml);
    return { ok: true, value: artifact };
  } catch { return failure("XML_DSIG_SIGNING_FAILED"); }
}

export function isSignedXmlArtifact(inputValue: unknown): inputValue is SignedXmlArtifact {
  return typeof inputValue === "object" && inputValue !== null && artifacts.has(inputValue);
}

export function serializeSignedXmlArtifact(inputValue: unknown): Result<string, XmlDsigSigningError> {
  if (!isSignedXmlArtifact(inputValue)) return failure("INVALID_XML_DSIG_SIGNING_INPUT");
  const xml = artifactXml.get(inputValue);
  return xml === undefined ? failure("INVALID_XML_DSIG_SIGNING_INPUT") : { ok: true, value: xml };
}
