# ADR 0007: In-memory PKCS#12 loading boundary

## Status

Accepted. This ADR fixes the S9 loading boundary only. It does not implement a loader, fixture, XML signature, delegation flow, certificate trust decision, or DGII transport behavior.

## Decision

The future certificate loader will decode a caller-provided PKCS#12 byte buffer and its password only in memory. `node-forge@1.4.0` is the sole decoder inside that narrow boundary. It may parse the PKCS#12 ASN.1 and select bags by type, `friendlyName`, or `localKeyId`; immediately after a selected key and certificate are obtained, they must be converted to Node native `KeyObject` and `X509Certificate` values. Forge objects, the source bytes, and the password must not escape the boundary.

The loading boundary must not:

- invoke a shell command or external executable;
- create a temporary file or persist certificate material, passwords, private keys, or decoded bag content;
- log or return raw parser, certificate, or key diagnostics;
- return a private key, certificate bytes, password, Forge object, or unfiltered exception to an adapter caller.

Safe catalog outcomes are required for malformed input, password failure, missing or ambiguous material, key/certificate mismatch, and rejected product policy. The future implementation will use `X509Certificate.checkPrivateKey()` after native conversion to prove the selected pair matches.

## DGII Evidence And Scope

The authoritative input is the provenance-controlled DGII snapshot, not the recovered roadmap. `resources/dgii/official/manifest.json` records the first-party sources, response metadata, and hashes; its `Firmado de e-CF` artifact is the current vendored signing instruction (modified 2023-11-22, SHA-256 `bb32bb04c170ac3e954166414dae583b28c4e3314578acdd532d15119d04b98e`) and its certification-process artifact is current as of 2025-08-19 (SHA-256 `1e4e53bde9f87dc9f0852e36b2e8819379e5444ed9a31501c9a8c7c321cbe6c1`).

Those documents establish the project's certificate/signing prerequisite. `Firmado de e-CF` pp. 5-10 includes a TypeScript example that imports `node-forge` and demonstrates `fromDer`, `pkcs12FromAsn1`, and `getBags` for PKCS#12 material. The document calls its multi-language samples demonstrative and says they are not the only way to sign an XML (p. 2); the example therefore supports this library choice but does not mandate `node-forge` as a normative dependency. It does not specify the project's PKCS#12 bag-selection policy, password handling, trust-chain policy, or a Node implementation boundary. Any current official DGII source that conflicts with this ADR supersedes it.

## Decoder Selection

| Candidate | Decision | Reason |
| --- | --- | --- |
| Node 24 `crypto` | Native target, not decoder | `createPrivateKey` and `X509Certificate` support the post-decode native boundary, but Node exposes no public PKCS#12 extraction API. |
| Web Crypto | Not a decoder | It has no public PKCS#12 container extraction API. |
| `node-forge@1.4.0` | Selected decoder | It provides PKCS#12 ASN.1 decoding and bag lookup needed at the one boundary. |
| OpenSSL CLI | Rejected | A subprocess creates command, temporary-material, error-disclosure, and platform-contract risks. |

Node 24.16.0 is within this package's declared `>=24 <25` engine range. The selected release declares Node `>=6.13.0`; it is CommonJS, so the future ESM loader must use the supported Node ESM-to-CommonJS default-import interoperation. No TypeScript source imports Forge in this slice, so `@types/node-forge` is intentionally not added. A later implementation must add an exact reviewed type package only if the compiler needs it.

## Identity And Delegation Boundaries

`2.5.4.5` is the X.509 subject `serialNumber` (often rendered as `SN`). It is distinct from a certificate serial number. The verified current DGII requirement is that this subject `SN` corresponds to the certificate owner's RNC, cedula, or passport; that identity match is not, by itself, a DGII authorization decision. S9 supports only a supplied domestic RNC or cedula using conservative product normalization: remove ASCII spaces and hyphens, then require the existing validated representation. Passport comparison is explicitly deferred. The loader must not infer an RNC or cedula from a free-form subject string or alter an identity that has not passed the existing fiscal-identity validation.

Certificate ownership and delegation are separate concerns. A successful key/certificate match or subject comparison does not grant authority to issue, sign for another taxpayer, or act as a delegate. Authorization remains a backend policy decision outside this loader.

## Deferred Validation

This boundary proves only container decoding, selected material, native conversion, pair matching, and the narrow identity comparison above. The following remain explicitly deferred:

- certificate validity dates;
- issuer and trust-chain verification;
- revocation checking;
- passport or foreign-identity policy;
- delegation and authorization;
- XMLDSig construction and signing.

S10 owns the signing seam: it may consume the native `KeyObject` and `X509Certificate` contract produced by S9, but must not re-open PKCS#12 decoding or expand this loader into XMLDSig behavior.

## Security And License Evidence

`node-forge@1.4.0` is exact-pinned as a runtime dependency. npm metadata identifies release `1.4.0`, the `latest` dist-tag, tarball integrity `sha512-LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ==`, repository commit `fa385f92440879601240020f158bed68e444e83a`, and license `(BSD-3-Clause OR GPL-2.0)`. Adoption requires review and acceptance of that dual license before distribution.

At decision time, GitHub Advisory Database entries relevant to the decoder or future certificate use identify `1.4.0` as the first patched release for ASN.1 unbounded recursion (GHSA-554w-wpv2-vw27 / CVE-2025-66031), RSA-PKCS signature verification (GHSA-ppp5-5v6c-4jwp / CVE-2026-33894), Ed25519 signature verification (GHSA-q67f-28xg-22rw / CVE-2026-33895), zero-input modular-inverse denial of service (GHSA-5m6q-g25r-mvwx / CVE-2026-33891), and certificate-chain basicConstraints validation (GHSA-2328-f5f3-gj25 / CVE-2026-33896). This loader does not invoke Forge certificate-chain or signature-verification APIs; those capabilities remain out of scope and must receive fresh security review if introduced.

The 1.4.0 release note contains only `Release 1.4.0`; the advisory first-patched-version records, npm registry metadata, lockfile integrity, and project audit are the operational evidence for this pin.
