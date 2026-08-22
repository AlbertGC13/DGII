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
- Offline operation requires durable queuing, bounded replay, and auditable recovery after connectivity returns.
- Contingency is three distinct regimes, not one state and not one shared deadline. Source for all three: `instructivo-contingencia-fe.pdf` (Febrero 2026, provenance-locked but external and Git-ignored).
  - `OFFLINE_TRANSMISSION_CONTINGENCY` — the issuer can still generate e-CF but cannot transmit. The e-CF is generated offline and retained, the printed representation must carry the DGII-mandated legend "e-CF emitido en modalidad de Contingencia, el cual podrá ser consultado para su validez fiscal, a partir de las setenta y dos (72) horas.", and transmission is deferred to no more than 72 hours (p. 5, "Estado de Contingencia", item 1 "Falta de conectividad").
  - `NON_ELECTRONIC_ISSUANCE_CONTINGENCY` — the issuer cannot issue electronically at all and must issue authorised non-electronic receipts (Serie B), notifying DGII through the Oficina Virtual (p. 5, item 2 "Imposibilidad de emitir e-CF"; Serie B defined p. 3, "Glosario"). This regime is capped at 15 **calendar** days (p. 5, item 2; p. 9, footnote 2). After leaving contingency the issuer has 30 **calendar** days to send DGII the e-CF that replace the non-electronic receipts, sent to DGII only and not to the receiver (p. 12, "Salida de contingencia").
  - `DGII_PLATFORM_CONTINGENCY` — a DGII-side outage. The issuer stores the e-CF and sends them once communication is restored; only an outage lasting more than 15 **business** days enables the OFV reporting option (p. 12, "Contingencia de la DGII").
  - The 15-calendar-day taxpayer cap and the 15-business-day DGII threshold are different concepts and must never be collapsed into one shared constant.
- Contingency scope is partial or total. A failure may affect one or more branches or business units while the rest keeps issuing electronically, or the taxpayer's whole operation and all branches (p. 3, "Glosario": "Contingencia parcial" and "Contingencia total"), and the OFV entry declaration requires selecting the modality "Total" or "Parcial" (p. 6, "Declaración Entrada en Contingencia", Paso 1). Any future contingency record must therefore key on company plus an optional branch, never on company alone.
- DGII exposes each service under its own root and its own per-environment prefix; there is no single `DGII_BASE_URL`. The timbre services are `https://ecf.dgii.gov.do/{testecf|certecf|ecf}/consultatimbre` for the ordinary e-CF and `https://fc.dgii.gov.do/{testecf|certecf|ecf}/consultatimbrefc` for a consumer invoice below RD$250,000 (`descripcion-tecnica-servicios-dgii.pdf`, rev. 02-01-2026, pp. 40-41 and pp. 42-43), while TrackId consultation lives under a further root (`.../consultatrackids/api/trackids/consulta`) and RFCE reception sits on a different host entirely (`fc.dgii.gov.do`). This reinforces the already-taken P0 decision for a per-service, per-environment `DGIIServiceEndpoints` configuration.

## Open verification gates

The following claims are not implementation-ready:

1. **`OPEN-DGII-01` — Exact derivation of `CodigoSeguridad`.**

   *Confirmed requirement, not open:* `CodigoSeguridad` is the first six elements derived from the hash / `SignatureValue` of the e-CF digital signature, and this is stated for **both** the ordinary e-CF and the RFCE. `informe-tecnico-ecf-v1.0.pdf` (Marzo 2026) p. 36 states it for the ordinary e-CF QR ("CodigoSeguridad: corresponde a los primeros seis (6) dígitos del hash generado en el SignatureValue de la firma digital del e-CF."), for the printed legend below the QR ("Debe ser indicado en palabras los primeros seis (6) dígitos del hash del SignatureValue de la firma, debajo del código QR"), and for the RFCE. `descripcion-tecnica-servicios-dgii.pdf` (rev. 02-01-2026) p. 21 repeats it ("codigoSeguridad: extraído de los primeros seis (6) dígitos ... que viene en el tag CodigoSeguridadeCF del resumen de factura") and p. 28 carries `codigoSeguridad` in the ConsultaEstado output contract. `formato-rfce-v1.0.pdf` (Enero 2020) p. 12 defines `<CodigoSeguridadeCF>` as "6 primeros caracteres del Hash de la firma digital", typed ALFANUM with maximum length 6.

   *Open ambiguity:* the official documents do not unambiguously fix whether the six characters are taken directly from the Base64 `SignatureValue` or from a further digest; nor which algorithm that digest would use; nor whether it runs over the Base64 text or the decoded bytes; nor the final encoding; nor the exact reading of "dígitos" versus "caracteres".

   *Leading hypothesis — inference, not a rule:* the first six characters taken directly from the Base64 `SignatureValue`. The support is `descripcion-tecnica-servicios-emisores-electronicos.pdf` (rev. 02-01-2026) p. 5, which requires percent-encoding of reserved characters specifically in the QR security-code data of printed representations ("En el caso de los datos del código de seguridad del QR en las representaciones impresas ... no deben utilizarse los siguientes caracteres reservados") and lists `+` (`%2B`), `/` (`%2F`) and `=` (`%3D`) among them. A hexadecimal digest can never contain those characters, so the requirement only makes sense for a Base64 substring. This remains inference. It must be settled by a certification fixture and must not be promoted to a production rule.

   *Context, not a live contradiction:* the "caracteres" wording comes from `formato-rfce-v1.0.pdf` (Enero 2020) while "dígitos ... del hash generado en el SignatureValue" comes from the Marzo 2026 and rev. 02-01-2026 documents. That is a difference between document generations.

   *Structural asymmetry:* the ordinary e-CF XML has no security-code element at all — the value is a print and QR artifact — while the RFCE carries `<CodigoSeguridadeCF>` as a transmitted field.

   *Scope of the block:* only the final generation of the value is blocked. The timbre URLs, environment selection, parameter order, percent-encoding, QR version 8 and printed-representation construction are documented and buildable now.
2. **Tolerance units:** recovered evidence describes a tolerance of `±1` per line and a global tolerance equal to the line count, including an example where a difference of `2.72` across three lines is accepted. This must not be reinterpreted as one cent without official confirmation.
3. **Decimal shapes:** two-decimal totals, four-decimal unit prices/exchange rates, and three-decimal subquantities are distinct contracts. Every field must follow its XSD-defined shape and rounding rule.
4. **Environment and token behavior:** URLs, token lifetime, polling cadence, certificate requirements, and retry limits must be checked against the current DGII documentation and TesteCF behavior.

## Consequences

- The current `fiscal-identity` module remains valid and independent of XML, signing, persistence, and networking.
- XML, signing, and live DGII integration cannot begin from recovered prose alone.
- Tests for future modules must use official schemas and vectors plus synthetic taxpayer and invoice data.
- Every externally visible fiscal rule must retain a source reference and version.
