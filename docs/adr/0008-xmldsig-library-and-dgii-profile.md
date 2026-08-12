# ADR 0008: XMLDSig library and DGII signing profile

## Status

Accepted. This ADR selects the S10 library and fixes its capability seam only. It does not implement a project signer, emit an e-CF, make a certificate-selection or authorization decision, validate DGII acceptance, or enable transport.

## Decision

Use the exact runtime dependency `xml-crypto@6.1.2` for a future S10 XMLDSig adapter. The adapter must use the official DGII profile below and no fallback or hand-built canonicalization.

| Profile concern | Required value |
| --- | --- |
| Signature form | Enveloped; the `Signature` is the final child of the document root. |
| Reference | One whole-document `Reference URI=""`; set `isEmptyUri: true` so the library does not add an `Id` and change it to a fragment URI. |
| SignedInfo canonicalization | Inclusive Canonical XML 1.0 without comments: `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`. |
| Signature | RSA-SHA256: `http://www.w3.org/2001/04/xmldsig-more#rsa-sha256`. |
| Digest | SHA-256: `http://www.w3.org/2001/04/xmlenc#sha256`. |
| Reference transform | Enveloped signature only: `http://www.w3.org/2000/09/xmldsig#enveloped-signature`. |
| KeyInfo | Only `KeyInfo/X509Data/X509Certificate`; configure a custom `getKeyInfoContent` and do not emit `KeyValue`, `RSAKeyValue`, `Object`, or other key material. |
| Parsing | Apply the DGII `preserveWhitespace = false` semantic before signing. This is a source-document normalization requirement, not a substitute for C14N. |
| Lifecycle | The exact XML bytes and DOM are immutable after signing. Any mutation, serialization change, or appended node requires rebuilding and signing a new document. |

`xml-crypto` does not provide a `preserveWhitespace` parser option. The future adapter owns a safe parser boundary and must demonstrate the DGII semantic there. It must not port the TypeScript sample's manual canonicalization, string insertion, or sample parser behavior.

## DGII And W3C Evidence

The provenance-controlled `resources/dgii/official/pdfs/firmado-ecf.pdf` is the controlling DGII source. On pp. 2-3 it requires a blank `Reference URI` for the whole document and SHA-256 for `SignatureMethod` and `DigestMethod`; its signature example specifies the inclusive C14N, RSA-SHA256, SHA-256 digest, enveloped transform, and `X509Data/X509Certificate` shape. The .NET and Java examples append the signature to the document root (pp. 3-5, 14-15). The Java example sets `preserveWhitespace(false)` (p. 15); the PHP notes request `preserveWhiteSpace = false`, C14N without comments, and removal of `KeyValue`/`RSAKeyValue` (pp. 16-17).

The DGII PDF calls its multi-language samples demonstrative, not the only way to sign XML (p. 2). Their details disagree: the TypeScript example manually canonicalizes and inserts a signature string, while the Java example uses a standards API and appends to the root. This ADR adopts only the cross-example DGII profile, not a sample implementation.

W3C XMLDSig defines `Signature` ordering as `SignedInfo`, `SignatureValue`, optional `KeyInfo`, then optional `Object` elements, and permits `X509Data` within optional `KeyInfo` ([XMLDSig Core 2.0, sections 2 and 7](https://www.w3.org/TR/xmldsig-core2/)). The DGII profile narrows that general schema to the minimal `X509Data/X509Certificate` choice. It uses XMLDSig 1.x compatibility syntax, not the distinct XMLDSig 2.0 processing model.

## Library Evidence

`xml-crypto@6.1.2` is the npm `latest` release as verified on 2026-08-12. It was published 2025-04-24, declares Node `>=16`, is MIT licensed, and is maintained at [node-saml/xml-crypto](https://github.com/node-saml/xml-crypto) (release commit `ef8ba25b6d38f462828ee1768af7e9f5bf3ec880`). Node 24.16.0 is within both its engine and this package's `>=24 <25` engine range. It is CommonJS, and the Node 24 ESM smoke imports its named `SignedXml` export successfully.

The exact package integrity is `sha512-leBOVQdVi8FvPJrMYoum7Ici9qyxfE4kVi+AkpUoYCSXaQF4IlBm1cneTK9oAxR61LpYxTx7lNcsnBIeRpGW2w==`. Its production transitives resolve to `@xmldom/is-dom-node@1.0.1`, `@xmldom/xmldom@0.8.13`, and `xpath@0.0.33`; all are MIT. `@xmldom/xmldom@0.8.13` is not deprecated, unlike the obsolete minimum `0.8.10` satisfying the package's range. It is also a direct exact runtime dependency so lockfile-free offline consumers of the packed package resolve the reviewed version, rather than a newly published range match. The production audit reports zero vulnerabilities.

GitHub lists four historical advisories. The two critical 2025 verification advisories, GHSA-9p8x-f768-wp2g and GHSA-x3m8-899r-f7c3, were addressed in 6.0.1, before this selected release. Version 6.1.0 introduced `getSignedReferences()` to limit wrapping misuse; 6.1.2 additionally removes corrupted reference XML data. No unresolved relevant production-audit advisory was found at decision time.

## Required API And Threat Boundaries

The future adapter must configure `SignedXml` explicitly with the exact canonicalization and signature URIs, `addReference({ xpath: "/*", transforms: [enveloped], digestAlgorithm: sha256, isEmptyUri: true })`, a root `location` with `append`, and custom `getKeyInfoContent` limited to the selected certificate.

Verification is a separate future capability. `getReferences()` and the public `references` data are deprecated and must be treated as unsigned. After `checkSignature()` succeeds, consumers may use only `getSignedReferences()` and parse that authenticated XML anew. They must not parse an untrusted DOM before verification, trust a certificate merely because it appears in `KeyInfo`, accept duplicate signatures, or use an ambiguous signature selection. Parser configuration, external-entity policy, duplicate-ID rejection, certificate trust, revocation, authorization, and wrapping defense are all explicit adapter boundaries, not guarantees conferred by this dependency.

The custom `getKeyInfoContent` hook controls output only; it must receive certificate data from the authenticated S9 capability, never expose private keys, PKCS#12 bytes, passwords, or raw parser diagnostics. The library's README mentions OpenSSL conversion for standalone files; this project must not use that workflow.

## S9 Capability Seam

S10 consumes only S9's opaque `AuthenticatedCertificateMaterial` after `isAuthenticatedCertificateMaterial()` succeeds. The certificate module provides synchronous RSA-SHA256 signing and minimal `X509Data/X509Certificate` content through the handle; native key objects, PEM, PKCS#12 bytes, and native certificate objects remain unavailable. `xml-crypto` custom algorithms call the signing capability, not a key. Its current `getSignature` hook is synchronous; an HSM/remote signer requires the library callback path and a separately designed asynchronous capability without weakening the opaque boundary. The adapter returns signed XML only; it does not return secrets or use S9's internal weak-map state directly.

## Alternatives

| Candidate | Decision | Reason |
| --- | --- | --- |
| `xml-crypto@6.1.2` | Selected | Exact supported profile capability, current security fixes, Node 24 ESM smoke, minimal reviewed transitives. |
| Manual C14N or DGII TypeScript sample port | Rejected | The official sample is demonstrative; manual canonicalization and string insertion are high-risk and conflict with the no-hand-rolled-C14N rule. |
| Native Node Web Crypto | Rejected | It supplies cryptographic primitives but no XMLDSig construction, C14N, enveloped transform, or W3C XML schema handling. |
| OpenSSL CLI | Rejected | It is not an XMLDSig implementation and violates the no-shell/no-persisted-key-material boundary. |

## Verification

`pnpm test:xml-crypto-profile` generates a short-lived synthetic RSA key and self-signed certificate wholly in memory, loads it through the opaque S9 capability, then registers a custom synchronous RSA-SHA256 `SignatureAlgorithms` implementation. It proves Node 24 ESM import, inclusive C14N, blank URI, enveloped transform, SHA-256 digest, RSA-SHA256, root append, custom minimal `KeyInfo`, local verification, and authenticated-reference retrieval. The signing `SignedXml` instance receives no private key or PEM; the separate verifier derives its public certificate from the controlled KeyInfo content. It writes no key, certificate, XML, or secret to disk and is not a production signer.
