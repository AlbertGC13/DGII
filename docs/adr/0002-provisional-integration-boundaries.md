# ADR 0002: Provisional DGII integration boundaries

## Status

Accepted as a provisional architecture constraint. Implementation remains blocked until the current official DGII PDFs, XSDs, and test vectors are restored and verified.

## Decision

Keep one modular monolith with four primary integration capabilities. These capabilities coordinate smaller domain modules rather than replacing them.

| Capability | Internal boundaries | Responsibility |
| --- | --- | --- |
| Builder | `fiscal-validator`, `xml-engine` | Map POS business data to the exact versioned XSD, calculate monetary values with fixed-precision decimals, omit absent optional nodes, escape reserved characters, and validate before signing. |
| Signer | `signer`, certificate adapter | Load PKCS#12 material through an isolated secret boundary and produce the exact DGII XMLDSig envelope. Never expose certificate bytes, passwords, private keys, or raw signing diagnostics. |
| DGII Gateway | `dgii-client`, environment configuration | Authenticate through the signed-seed protocol, select TesteCF/CerteCF/production endpoints, send signed documents, preserve TrackIds, and reconcile before retrying uncertain submissions. |
| Tracker | `state-machine`, `job-queue`, persistence | Poll asynchronous submissions with bounded backoff, persist every state transition, process accepted/conditional/rejected outcomes, and drain the contingency queue after connectivity returns. |

Supporting boundaries remain explicit: public API, fiscal identity, sequence allocation, inbound issuer/receiver services, audit, printed representation, and tenant configuration.

## Verified constraints

- An e-NCF has exactly 13 characters: uppercase `E` followed by 12 ASCII digits. The two digits after `E` identify the e-CF type.
- Monetary calculations must not use IEEE 754 floating-point arithmetic. Exact scale and precision are field-specific and must come from the applicable official XSD; they must not be generalized from one decimal type.
- XML generation must omit absent optional elements, preserve XSD element order, encode reserved characters as required by the official format, and use the physical filename `RNCEmisor+eNCF.xml` where that document contract applies.
- Signing uses enveloped XMLDSig, SHA-256, RSA-SHA256, and inclusive C14N with the official algorithm URIs and element order.
- A successful reception returns a TrackId, not a terminal fiscal decision. State `3` is processing; terminal states include `1` accepted, `2` rejected, and `4` accepted conditionally.
- A timeout after submission must trigger TrackId reconciliation before any resend. Blind retries can create multiple TrackIds for one e-NCF.
- Offline operation requires durable queuing, explicit contingency state, bounded replay, and auditable recovery after connectivity returns.

## Open verification gates

The following claims are not implementation-ready:

1. **Security code derivation:** recovered evidence conflicts between using six characters from `SignatureValue` and six digits from a hash of `SignatureValue`. No implementation may choose either interpretation until the current official source resolves it.
2. **Tolerance units:** recovered evidence describes a tolerance of `±1` per line and a global tolerance equal to the line count, including an example where a difference of `2.72` across three lines is accepted. This must not be reinterpreted as one cent without official confirmation.
3. **Decimal shapes:** two-decimal totals, four-decimal unit prices/exchange rates, and three-decimal subquantities are distinct contracts. Every field must follow its XSD-defined shape and rounding rule.
4. **Environment and token behavior:** URLs, token lifetime, polling cadence, certificate requirements, and retry limits must be checked against the current DGII documentation and TesteCF behavior.

## Consequences

- The current `fiscal-identity` module remains valid and independent of XML, signing, persistence, and networking.
- XML, signing, and live DGII integration cannot begin from recovered prose alone.
- Tests for future modules must use official schemas and vectors plus synthetic taxpayer and invoice data.
- Every externally visible fiscal rule must retain a source reference and version.
