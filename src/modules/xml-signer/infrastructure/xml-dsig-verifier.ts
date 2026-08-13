import { X509Certificate } from "node:crypto";

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

import type { Result } from "../../../shared/domain/result.js";

export type XmlDsigVerificationError = Readonly<{ code: "INVALID_XML_DSIG_VERIFICATION_INPUT" | "UNSAFE_XML_DSIG_INPUT" | "INVALID_XML_DSIG_PROFILE" | "XML_DSIG_VERIFICATION_FAILED" }>;
export type VerifiedSignedXmlArtifact = object;

type Input = Readonly<{ xml: string }>;

const c14n = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const enveloped = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const rsaSha256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const sha256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const dsig = "http://www.w3.org/2000/09/xmldsig#";
const xml = "http://www.w3.org/XML/1998/namespace";
const artifacts = new WeakSet<VerifiedSignedXmlArtifact>();
const artifactXml = new WeakMap<VerifiedSignedXmlArtifact, string>();
const artifactSignedXml = new WeakMap<VerifiedSignedXmlArtifact, string>();

function failure(code: XmlDsigVerificationError["code"]): Result<never, XmlDsigVerificationError> {
  return { ok: false, error: Object.freeze({ code }) };
}

function input(inputValue: unknown): Input | undefined {
  try {
    if (typeof inputValue !== "object" || inputValue === null || Array.isArray(inputValue) || Object.getPrototypeOf(inputValue) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(inputValue);
    if (keys.length !== 1 || keys[0] !== "xml") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(inputValue, "xml");
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "string" || descriptor.value.trim().length === 0) return undefined;
    return Object.freeze({ xml: descriptor.value });
  } catch { return undefined; }
}

function hasUnsafeSyntax(value: string): boolean {
  if (/<!(?:DOCTYPE|ENTITY)\b/iu.test(value)) return true;
  const withoutDeclaration = value.replace(/^\s*<\?xml\s[^?]*\?>/iu, "");
  return /<\?/u.test(withoutDeclaration);
}

function parse(value: string): Document | undefined {
  if (hasUnsafeSyntax(value)) return undefined;
  try {
    const reject = (): never => { throw new Error("XML parse rejected."); };
    const document = new DOMParser({ errorHandler: { warning: reject, error: reject, fatalError: reject } }).parseFromString(value, "text/xml");
    const roots = Array.from(document.childNodes).filter((node) => node.nodeType === node.ELEMENT_NODE);
    return roots.length === 1 ? document : undefined;
  } catch { return undefined; }
}

function directElements(element: Element): Element[] {
  return Array.from(element.childNodes).filter((node): node is Element => node.nodeType === node.ELEMENT_NODE);
}

function hasOnlyWhitespaceText(element: Element): boolean {
  return Array.from(element.childNodes).every((node) => node.nodeType === node.ELEMENT_NODE || (node.nodeType === node.TEXT_NODE && !/\S/u.test(node.nodeValue ?? "")));
}

function isDsig(element: Element, name: string): boolean {
  return element.namespaceURI === dsig && element.localName === name;
}

function hasAttributes(element: Element, expected: Readonly<Record<string, string>> = {}): boolean {
  const actual = Array.from(element.attributes).filter((attribute) => attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/");
  return actual.length === Object.keys(expected).length && actual.every((attribute) => expected[attribute.name] === attribute.value);
}

function exactChildren(element: Element, names: readonly string[]): boolean {
  const children = directElements(element);
  return hasOnlyWhitespaceText(element) && children.length === names.length && children.every((child, index) => {
    const expected = names[index];
    return expected !== undefined && isDsig(child, expected);
  });
}

function singleTextChild(element: Element): boolean {
  const children = Array.from(element.childNodes);
  const child = children[0];
  return children.length === 1 && child !== undefined && child.nodeType === child.TEXT_NODE && /\S/u.test(child.nodeValue ?? "") && hasAttributes(element);
}

function hasDuplicateIds(document: Document): boolean {
  const identifiers = new Set<string>();
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const idName = attribute.name === "Id" || attribute.name === "ID" || attribute.name === "id" || (attribute.namespaceURI === xml && attribute.localName === "id");
      if (idName && identifiers.has(attribute.value)) return true;
      if (idName) identifiers.add(attribute.value);
    }
  }
  return false;
}

function signature(document: Document): Element | undefined {
  const signatures = Array.from(document.getElementsByTagNameNS(dsig, "Signature"));
  if (signatures.length !== 1) return undefined;
  const candidate = signatures[0];
  if (candidate === undefined) return undefined;
  return candidate.parentNode === document.documentElement && document.documentElement.lastChild === candidate ? candidate : undefined;
}

function profile(signatureElement: Element): string | undefined {
  if (!hasAttributes(signatureElement) || !exactChildren(signatureElement, ["SignedInfo", "SignatureValue", "KeyInfo"])) return undefined;
  const [signedInfo, signatureValue, keyInfo] = directElements(signatureElement);
  if (signedInfo === undefined || signatureValue === undefined || keyInfo === undefined || !hasAttributes(signedInfo) || !singleTextChild(signatureValue) || !exactChildren(signedInfo, ["CanonicalizationMethod", "SignatureMethod", "Reference"]) || !exactChildren(keyInfo, ["X509Data"])) return undefined;
  const [canonicalizationMethod, signatureMethod, reference] = directElements(signedInfo);
  if (canonicalizationMethod === undefined || signatureMethod === undefined || reference === undefined || !hasAttributes(canonicalizationMethod, { Algorithm: c14n }) || !hasAttributes(signatureMethod, { Algorithm: rsaSha256 }) || !hasAttributes(reference, { URI: "" }) || !exactChildren(reference, ["Transforms", "DigestMethod", "DigestValue"])) return undefined;
  const [transforms, digestMethod, digestValue] = directElements(reference);
  const transform = transforms === undefined ? undefined : directElements(transforms)[0];
  if (transforms === undefined || digestMethod === undefined || digestValue === undefined || transform === undefined || !exactChildren(transforms, ["Transform"]) || !hasAttributes(transform, { Algorithm: enveloped }) || !hasAttributes(digestMethod, { Algorithm: sha256 }) || !singleTextChild(digestValue)) return undefined;
  const x509Data = directElements(keyInfo)[0];
  if (x509Data === undefined || !hasAttributes(x509Data) || !exactChildren(x509Data, ["X509Certificate"])) return undefined;
  const certificate = directElements(x509Data)[0];
  return certificate !== undefined && singleTextChild(certificate) ? certificate.textContent.trim() : undefined;
}

function authenticatedXml(value: string): string | undefined {
  const document = parse(value);
  if (document === undefined || document.getElementsByTagNameNS(dsig, "Signature").length !== 0) return undefined;
  return value;
}

/** Verifies only the fixed DGII XMLDSig profile and retains xml-crypto's authenticated whole-document reference. */
export function verifyDgiiXmlSignature(inputValue: unknown): Result<VerifiedSignedXmlArtifact, XmlDsigVerificationError> {
  const values = input(inputValue);
  if (values === undefined) return failure("INVALID_XML_DSIG_VERIFICATION_INPUT");
  const document = parse(values.xml);
  if (document === undefined) return failure("UNSAFE_XML_DSIG_INPUT");
  if (hasDuplicateIds(document)) return failure("INVALID_XML_DSIG_PROFILE");
  const selectedSignature = signature(document);
  if (selectedSignature === undefined) return failure("INVALID_XML_DSIG_PROFILE");
  const certificate = profile(selectedSignature);
  if (certificate === undefined) return failure("INVALID_XML_DSIG_PROFILE");
  try {
    const publicCert = new X509Certificate(Buffer.from(certificate, "base64")).toString();
    const verifier = new SignedXml({ publicCert, getCertFromKeyInfo: () => null });
    verifier.loadSignature(new XMLSerializer().serializeToString(selectedSignature));
    if (!verifier.checkSignature(values.xml)) return failure("XML_DSIG_VERIFICATION_FAILED");
    const references = verifier.getSignedReferences();
    if (references.length !== 1) return failure("XML_DSIG_VERIFICATION_FAILED");
    const reference = references[0];
    if (reference === undefined) return failure("XML_DSIG_VERIFICATION_FAILED");
    const unsigned = authenticatedXml(reference);
    if (unsigned === undefined) return failure("XML_DSIG_VERIFICATION_FAILED");
    const artifact = Object.freeze(Object.create(null)) as VerifiedSignedXmlArtifact;
    artifacts.add(artifact); artifactXml.set(artifact, unsigned); artifactSignedXml.set(artifact, values.xml);
    return { ok: true, value: artifact };
  } catch { return failure("XML_DSIG_VERIFICATION_FAILED"); }
}

export function isVerifiedSignedXmlArtifact(inputValue: unknown): inputValue is VerifiedSignedXmlArtifact {
  return typeof inputValue === "object" && inputValue !== null && artifacts.has(inputValue);
}

export function serializeAuthenticatedXml(inputValue: unknown): Result<string, XmlDsigVerificationError> {
  if (!isVerifiedSignedXmlArtifact(inputValue)) return failure("INVALID_XML_DSIG_VERIFICATION_INPUT");
  const value = artifactXml.get(inputValue);
  return value === undefined ? failure("INVALID_XML_DSIG_VERIFICATION_INPUT") : { ok: true, value };
}

/** Returns the immutable original serialization only for a verifier-created artifact. */
export function serializeVerifiedSignedXml(inputValue: unknown): Result<string, XmlDsigVerificationError> {
  if (!isVerifiedSignedXmlArtifact(inputValue)) return failure("INVALID_XML_DSIG_VERIFICATION_INPUT");
  const value = artifactSignedXml.get(inputValue);
  return value === undefined ? failure("INVALID_XML_DSIG_VERIFICATION_INPUT") : { ok: true, value };
}
