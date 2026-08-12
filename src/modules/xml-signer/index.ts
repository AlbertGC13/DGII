export { isSignedXmlArtifact, serializeSignedXmlArtifact, signXmlWithAuthenticatedCertificate } from "./infrastructure/xml-dsig-signer.js";
export type { SignedXmlArtifact, XmlDsigSigningError } from "./infrastructure/xml-dsig-signer.js";
export { isVerifiedSignedXmlArtifact, serializeAuthenticatedXml, verifyDgiiXmlSignature } from "./infrastructure/xml-dsig-verifier.js";
export type { VerifiedSignedXmlArtifact, XmlDsigVerificationError } from "./infrastructure/xml-dsig-verifier.js";
