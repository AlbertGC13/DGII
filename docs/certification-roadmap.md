# DGII Certification Roadmap

> **Status:** reconciled against `origin/main` at merge commit `48b5546` (PR #227).
> **Goal:** register PROPIO software with DGII and pass TesteCF / CerteCF certification.
> **Tracking:** GitHub issues and merged PRs are the delivery source of truth; this roadmap records their reconciled status at this baseline.

---

## 1. Current baseline (validated)

The codebase now issues **one complete e-CF type 31 end to end**: bounded domain evidence, a full
`ECF` document that validates offline against the pinned official `ecf-31-v1.0` XSD, an XMLDSig
signature DGII accepts, and a live TesteCF dispatch that returned a TrackId. Around that path sit
an atomic sequence kernel, an append-only PostgreSQL delivery ledger, and a POS API-key
authorization kernel, with result polling now reconciled into that ledger. What remains absent is
the **hosted taxpayer-facing side** (`/fe/recepcion`, `/fe/aprobacioncomercial`,
`/fe/autenticacion`), the **ERP/POS-facing public API**, and **every document type other than 31**.
There is no HTTP server in the repository: all clients are outbound only.

| Capability | Status | Key modules |
|---|---|---|
| Exact decimal arithmetic (`bigint`, no float) | **Done** | `builder/domain/exact-decimal.ts` |
| e-CF 31 core header / line / draft validation | **Done** | `builder/domain/ecf31-core-*.ts` |
| IdDoc issuance evidence (sequence expiry + conditional credit deadline) | **Done** | `builder/domain/ecf31-iddoc-issuance-evidence.ts` |
| IdDoc XML node mapping | **Done** | `builder/infrastructure/ecf31-iddoc-xml-mapper.ts` |
| DetallesItems XML mapping (bounded Item fields, codes, metadata, adjustments, tax, retention, other-currency detail) | **Done (bounded, XSD-valid)** | `builder/infrastructure/ecf31-detalles-items-xml-mapper.ts` |
| Line-amount evidence + MontoItem quantization | **Done** | `builder/domain/ecf31-line-amount-*.ts`, `ecf31-monto-item-*.ts` |
| Per-line ±1.00 tolerance gate | **Done** | `builder/domain/ecf31-monto-item-tolerance-gate-evidence.ts` |
| Global adjustment proportional allocation + exact reconciliation | **Done** | `builder/domain/ecf31-global-adjustment-*.ts` |
| ITBIS price-inclusion evidence (pre-adjustment bases) | **Done** | `builder/domain/ecf31-itbis-price-inclusion-evidence.ts` |
| Post-adjustment taxable bases (buckets 1/2/3) | **Done** | `builder/domain/ecf31-post-global-adjustment-taxable-base-evidence.ts` |
| Post-adjustment exempt amount (bucket 4, optional) | **Done** | `builder/domain/ecf31-post-global-adjustment-exempt-amount-evidence.ts` |
| Additional-tax classification (001–039, qualifying ISC proof) | **Done** | `builder/domain/ecf31-additional-tax-classification-evidence.ts` |
| TotalITBIS evidence (guarded, no qualifying ISC) | **Done** | `builder/domain/ecf31-total-itbis-evidence.ts` |
| Derived header totals (compose, persist, and emit v2 envelope) | **Done** | `builder/domain/ecf31-header-totals-evidence.ts`, draft persistence |
| Full `ECF` document assembly (Encabezado + DetallesItems + signing timestamp) | **Done** | `builder/infrastructure/ecf31-xml-assembler.ts` |
| e-NCF structural parser (types 31–34) | **Done** | `fiscal-identity/domain/e-ncf.ts` |
| e-NCF formatter (`allocated_value` to `E31` + 10-digit zero-padded sequence) | **Done (S7, PR #151)** | `fiscal-identity/domain/` |
| PostgreSQL atomic sequence allocation kernel + typed public API | **Done (S7, PR #153)** | `db/migrations/0001_atomic_sequence_allocation.sql`, `sequence-allocation/index.ts` |
| Canonical V1 issuance-command SHA-256 fingerprint | **Done (S8, PR #159)** | `issuance/domain/canonical-issuance-command.ts` |
| Canonical allocation/replay/conflict wrapper | **Done (S8, PR #161)** | `issuance/application/allocate-canonical-issuance.ts` |
| Transactional draft-evidence persistence | **Done** | `draft-persistence/infrastructure/postgres-ecf31-draft-evidence-repository.ts` |
| JSON snapshot codecs (v2 emission with legacy v1 compatibility) | **Done** | `builder/application/*-snapshot-codec.ts` |
| Module boundary enforcement + official-resource SHA-256 integrity gate | **Done** | `src/architecture/` |
| Offline closed-catalog XSD validator foundation for 15 integrity-pinned schemas | **Done (S5a, PR #143)** | `builder/infrastructure/offline-dgii-xsd-validator.ts` |
| PKCS#12 certificate loading (decoder ADR and pin, synthetic fixture, in-memory loader) | **Done (S9, PRs #165, #167, #169)** | `certificate/` |
| XMLDSig signer and verifier on the pinned DGII profile | **Done (S10, ADR 0008, PRs #173, #175, #177, #179)** | `xml-signer/` |
| DGII HTTP transport core (TLS, multipart, Bearer, environment roots) | **Done (S11, PR #181)** | `http-transport/` |
| DGII auth client (semilla → sign → validarsemilla → cached token) | **Done (S12, PR #183); live `200 OK` + bearer token from TesteCF** | `dgii-auth/`, commit `984f013` |
| Reception client (POST signed e-CF → TrackId) | **Done (S13 outbound, PR #185); live TrackId `d8ff8b59-ad34-49ba-b9b9-386152bc9c14` (PR #205)** | `dgii-reception/`, `scripts/testecf-ecf31-probe.mjs` |
| Result consultation by TrackId + bounded polling scheduler | **Done (PRs #187, #189); wired into the delivery ledger by PR #227** | `dgii-result-consultation/`, `issuance/application/reconcile-ecf31-delivery-result.ts` |
| e-CF 31 delivery preparation (assemble → sign → serialize → XSD-validate → verify) | **Done (PR #207)** | `issuance/application/prepare-ecf31-delivery.ts` |
| Append-only delivery evidence ledger + delivery-intent safety (no blind resend) | **Done (PRs #191, #193, #209, #211, #213)** | `db/migrations/0004`, `0005`, `delivery-persistence/` |
| e-CF 31 delivery coordinator (prepare → persist intent → POST → acknowledge) | **Done (PR #215)** | `issuance/application/coordinate-ecf31-delivery.ts` |
| Backend scope authority (single-use opaque capabilities, refresh-on-use) | **Done (PR #195)** | `backend-authorization/backend-scope-authority.ts` |
| POS API-key authorization: PostgreSQL kernel, key parser + adapter, single-source digest, composed `identify`/`resolve`/`refresh` ports | **Done (PRs #217, #219, #221, #223)** | `db/migrations/0006_pos_api_authorization.sql`, `backend-authorization/` |
| Verification recorded at PR #169: 602 unit tests, 20 PostgreSQL integration tests, 100% configured coverage, typecheck/lint/build/package-consumer, all gates/CI | **Green at that baseline; counts not re-measured since** | PRs #165, #167, #169 |

### Known internal gaps inside the baseline

| Gap | Detail |
|---|---|
| Result polling has no scheduler driving it | Closed as a wiring gap by PR #227: `createEcf31DeliveryResultReconciler` drives `consult` from an acknowledged attempt and appends `RESULT_OBSERVED` / `POLLING_DEADLINE_EXPIRED` / `POLLING_CANCELLED` / `POLLING_ERROR` into the ledger, so `delivery_state` reaches a terminal value. What is still absent is anything that *invokes* the reconciler on a schedule — there is no runtime process or HTTP server in the repository, so reconciliation is an operator- or caller-driven call today. |
| Persisted evidence is incomplete for restore | Neither snapshot version retains the additional-tax classification: `V1_KEYS` = `schema, header, lineAdjustments, headerTotals`; `V2_KEYS` adds only `version` and `headerTotalsPolicyId`. DetallesItems evidence is likewise not persisted. A restored draft therefore cannot prove ISC absence nor re-derive item detail — the delivery path builds both in memory. |
| Only e-CF 31 is mapped | `builder/infrastructure/` contains `ecf31-*` mappers only, while 15 official schemas are vendored under `resources/dgii/official/xsd/`. Nothing maps 32/33/34/41/43–47, RFCE, ARECF, ACECF or ANECF. |
| Remaining optional Item and header coverage | Further optional Item fields plus InformacionesAdicionales, Transporte, and header-level OtraMoneda remain unmapped. They are optional in the XSD, so their absence does not break validity — it limits which certification cases can be produced. |
| No HTTP server, no public API | The package exposes library functions only. There is no ERP/POS-facing REST surface and no hosted taxpayer endpoint. |
| Authorization and delivery persistence are internal-only | `src/index.ts` does not re-export `backend-authorization` or `delivery-persistence`. |

---

## 2. Official resources available locally

The manifest records 26 logical official artifacts under `resources/dgii/official/`: 25 vendored
(15 XSD + 10 PDF) plus one provenance-locked external PDF. All are SHA-256-pinned in
`manifest.json` (schema v3, retrieved 2026-07-26, all `confidence: high`) and enforced by
`src/architecture/official-resource-integrity.ts`.

| Resource | Coverage |
|---|---|
| 10 e-CF XSDs (31/32/33/34/41/43–47) | Document structure, decimal profiles, signature slot (`xs:any`) |
| `rfce-32-v1.0.xsd` | Resumen Factura de Consumo Electrónica |
| `acecf-v1.0.xsd` | Aprobación Comercial |
| `arecf-v1.0.xsd` | Acuse de Recibo |
| `anecf-v1.0.xsd` | Anulación |
| `semilla-v1.0.xsd` | Authentication seed |
| `formato-ecf-v1.0.pdf` | Field-by-field format for all 10 e-CF types |
| `descripcion-tecnica-servicios-dgii.pdf` (rev. 02-01-2026) | DGII-hosted REST services: auth, recepción, consulta, anulación, directorio, timbre QR; environments TesteCF/CerteCF/producción |
| `descripcion-tecnica-servicios-emisores-electronicos.pdf` (rev. 02-01-2026) | Taxpayer-hosted endpoint contracts (`/fe/recepcion`, `/fe/aprobacioncomercial`, `/fe/autenticacion`) |
| `proceso-certificacion-emisor-electronico.pdf` (Jul 2025) | 15-step certification flow, postulation form, test-set quotas, simulation set |
| `informe-tecnico-ecf-v1.0.pdf` | Calculation rules, half-up rounding, representación impresa |
| `firmado-ecf.pdf` | XMLDSig signing instructive |
| `instructivo-contingencia-fe.pdf` (Febrero 2026) *(external, not vendored)* | Three separate contingency regimes, not one mode and not one shared deadline. `OFFLINE_TRANSMISSION_CONTINGENCY` (p. 5, item 1): can generate but not transmit — retain the offline e-CF, transmit within 72 h, print the mandated contingency legend. `NON_ELECTRONIC_ISSUANCE_CONTINGENCY` (p. 5, item 2; p. 9 footnote 2; p. 12): cannot issue electronically — authorised non-electronic receipts (Serie B, p. 3), maximum **15 calendar** days, regularise by e-CF to DGII only within **30 calendar** days of leaving contingency. `DGII_PLATFORM_CONTINGENCY` (p. 12): DGII-side outage — store and forward; more than **15 business** days enables the OFV reporting option. Scope is `PARTIAL` or `TOTAL` and the OFV entry declaration requires choosing one (p. 3 Glosario; p. 6 Paso 1) |
| `formato-{acecf,arecf,anecf,rfce}-v1.0.pdf` | Auxiliary document formats |

`ecf-31-v1.0.xsd` ships with a leading space in one `xs:simpleType/@name`, which libxml2 rejects as
an NCName. `normalizeEcf31SchemaForLibxml` repairs it **in memory only, after verifying the pinned
SHA-256**; the on-disk artifact stays byte-identical.

**Not yet available locally:**

- Certification test-set Excel files (portal-gated, downloadable only after postulation)
- `OPEN-DGII-01` — exact derivation of `CodigoSeguridad`. The **requirement** is confirmed and not open: the value is the first six elements derived from the hash / `SignatureValue` of the e-CF digital signature, stated for both the ordinary e-CF and the RFCE (`informe-tecnico-ecf-v1.0.pdf`, Marzo 2026, p. 36 — QR, printed legend and RFCE; `descripcion-tecnica-servicios-dgii.pdf`, rev. 02-01-2026, p. 21 and p. 28; `formato-rfce-v1.0.pdf`, Enero 2020, p. 12, `<CodigoSeguridadeCF>`, ALFANUM, max 6). What is missing is a fixture that fixes the **operation**: Base64 `SignatureValue` substring versus a further digest, the algorithm of that possible digest, Base64 text versus decoded bytes, the final encoding, and the reading of "dígitos" against "caracteres". Leading hypothesis, inference only: the first six characters taken directly from the Base64 `SignatureValue`, supported by the QR percent-encoding requirement at `descripcion-tecnica-servicios-emisores-electronicos.pdf`, rev. 02-01-2026, p. 5, whose reserved list includes `+`, `/` and `=` — characters a hexadecimal digest can never contain. Needs an official fixture; must not be promoted to a production rule. See [ADR 0002](adr/0002-provisional-integration-boundaries.md).

---

## 3. Roadmap

Each slice is test-first (RED → GREEN → refactor) and under 400 changed lines unless flagged.

> **S1 completed with owner approval:** AGENTS.md now permits XML work only from current official
> DGII XSD/PDF evidence, with applicable-XSD validation and no invented mappings, signing, or transport rules.

### Phase 1 — Unblock XML

| # | Slice | Depends on | Status |
|---|---|---|---|
| **S1** | Correct stale "XML blocked" statement in AGENTS.md + align README deferred list. | — | ☑ Complete (owner-approved) |
| **S2** | Vendor W3C `xmldsig-core-schema.xsd` + separate schema-v3 provenance manifest + common authority-root integrity test update. Byte integrity only; defer external-DTD parsing and offline validation. | S1 | ☑ Complete |

### Phase 2 — XML generation and validation

| # | Slice | Depends on | Status |
|---|---|---|---|
| **S3** | XML writer primitives: official escape table, no-empty-tags, deterministic field order, UTF-8. | S1 | ☑ Complete |
| **S4a0** | Standalone genuine IdDoc issuance evidence: sequence-expiration date and conditional credit payment deadline. Track the optional `IndicadorServicioTodoIncluidoType` XSD/PDF discrepancy as a non-guessed field pending official clarification. | S3 | ☑ Complete |
| **S4a** | e-CF 31 XML mapping — IdDoc node mapping. | S3, S4a0 | ☑ Complete |
| **S4b0** | Accept genuine parsed domestic 9-digit RNC and 11-digit cédula issuer identifiers in the E-CF 31 core header without changing snapshot v1. | S3 | ☑ Complete |
| **S4b** | e-CF 31 XML mapping — Emisor / Comprador. | S3, S4b0 | ☑ Complete |
| **S4c** | e-CF 31 XML mapping — bounded derived-header-totals subset; non-billable, retention, payment, and additional-tax header fields remain deferred. | S3, S6 | ☑ Complete |
| **S4d** | e-CF 31 XML mapping — DetallesItems / TablaCodigosItem / TablaImpuestoAdicional. | S3 | ◐ Bounded but XSD-valid — every mandatory Item field is mapped, plus metadata, subadjustment, additional-tax, retention and other-currency-detail slices; further optional Item fields remain unmapped |
| **S4d1** | DetallesItems domain evidence: genuine line-local MontoItem derivation and optional per-line additional-tax code capture; XSD `Item` bound is 1–1000 despite the PDF's generic 100-line guidance, and CantidadItem is strictly positive. No XML mapping or global-adjustment allocation. | — | ☑ Complete |
| **S4d2** | DetallesItems XML mapping: bounded mandatory Item fields from genuine line evidence, without adjustments, item-code tables, or additional-tax tables. | S3, S4d1 | ☑ Complete |
| **S4d3a** | Authenticated immutable per-line TablaCodigosItem metadata evidence: exact core-draft line lineage, zero through five opaque `{ type, value }` pairs, and no XML mapping. | S4d1 | ☑ Complete |
| **S4d3b** | DetallesItems XML mapping: serialize authenticated nonempty TablaCodigosItem metadata after NumeroLinea; retain internal safe mapper boundaries. | S3, S4d2, S4d3a | ☑ Complete |
| **S4d3c** | Authenticated immutable per-line optional DescripcionItem metadata evidence: exact core-draft line lineage and exact accepted text preservation. | S4d1, S4d3a | ☑ Complete (PR #100) |
| **S4d3c-xml** | DetallesItems XML mapping: serialize authenticated nonempty DescripcionItem metadata in its official item position. | S3, S4d2, S4d3c | ☑ Complete (PR #101) |
| **S4d3d** | Authenticated immutable per-line optional unit-of-measure metadata evidence: canonical codes 1–62 and exact core-draft line lineage. | S4d1, S4d3a | ☑ Complete (PR #103) |
| **S4d3d-xml** | DetallesItems XML mapping: serialize authenticated UnidadMedida metadata in its official item position. | S3, S4d2, S4d3d | ☑ Complete (PR #105) |
| **S4d3e** | Authenticated immutable per-line optional FechaElaboracion and FechaVencimientoItem metadata, with bounded DetallesItems XML serialization. | S3, S4d2 | ☑ Complete (#107) |
| **S4d4** | Exact positive `Decimal5D1or2` prerequisite for percentage-based line adjustments. | — | ☑ Complete (#110) |
| **S4d5** | Authenticated immutable e-CF 31 line subadjustments using the exact positive percentage prerequisite. | S4d1, S4d4 | ☑ Complete (Issue #108, PR #113) |
| **S4d5-xml** | DetallesItems XML follow-up for authenticated line subadjustments. | S3, S4d5 | ☑ Complete (Issue #114, PR #115) |
| **S4d6** | TablaImpuestoAdicional and additional-tax XML mapping from authenticated classification evidence. | S3, S4d1 | ☑ Complete (Issue #116, PR #117) |
| **S4d7** | Other bounded Item evidence/XML work, delivered as independent slices; it does not complete e-CF 31 Item coverage. | S3, S4d1 | ◐ Incomplete |
| **S4d7a** | Optional paired `CantidadReferencia`/`UnidadReferencia` evidence and XML mapping. **Blocked from obligation enforcement:** official material conflicts on whether codes 006–022 or 006–039 require it. | S3, S4d1 | ☑ Evidence/XML complete (Issues #118/#120, PRs #119/#121); obligation unresolved |
| **S4d7b** | Exact subquantity prerequisite, authenticated subquantity evidence, and XML mapping. | S3, S4d1 | ☑ Complete (Issues #122/#124/#126, PRs #123/#125/#127) |
| **S4d7c** | Authenticated alcohol and reference-price metadata and XML mapping. | S3, S4d1 | ☑ Complete (Issues #128/#130, PRs #129/#131) |
| **S4d7d** | Authenticated retention metadata and XML mapping. | S3, S4d1 | ☑ Complete (Issues #132/#134, PRs #133/#135) |
| **S4d7e** | Authenticated supplied other-currency detail and XML mapping; conversion derivation, reconciliation, and rounding policy remain unresolved. | S3, S4d1 | ☑ Complete (Issues #136/#138, PRs #137/#139) |
| **S4e** | e-CF 31 XML mapping — compose the `Encabezado` from IdDoc, Emisor/Comprador and Totales nodes, then assemble the full `ECF` document. InformacionesAdicionales, Transporte and header-level OtraMoneda remain unmapped. | S4a, S4b, S4c | ☑ Complete |
| **S5** | Offline final full-document XSD validation harness against the 15 vendored XSDs. | S4d, S4e, S10 | ◐ Complete for `ecf-31-v1.0` and `semilla-v1.0`; the other 13 schemas are pinned but unexercised. A **signed** full `ECF` document is validated inside `prepare-ecf31-delivery` and in `scripts/testecf-ecf31-probe.mjs`, which passed before the live TesteCF dispatch |
| **S5a** | Offline closed-catalog validator foundation for 15 integrity-pinned schemas. | — | ☑ Complete (PR #143) |

### Phase 3 — Fiscal wiring completion

| # | Slice | Depends on | Status |
|---|---|---|---|
| **S6** | Wire derived evidence (TotalITBIS + exempt + taxable bases) into `Ecf31HeaderTotalsEvidence`. | — | ☑ Complete |
| **S6b** | Persist genuine same-draft derived-header totals; accept the exact v2 envelope while preserving legacy v1 compatibility, and emit v2 for new snapshots. | S6 | ☑ Complete (PRs #145, #147) |
| **S7** | e-NCF formatter from `allocated_value` → `E31` + 10-digit zero-padded; sequence-allocation typed TS public API (`index.ts`). | — | ☑ Complete (formatter PR #151; typed allocation API PR #153) |
| **S8** | Canonical V1 SHA-256 fingerprint over the stable pre-allocation issuance command, wired through allocation/replay/conflict handling. Excludes generated sequence/e-NCF consequence, XML, signatures, certificates, signing timestamps, and TrackIds. | S7 | ☑ Complete (ADR 0006, PRs #157, #159, #161) |

### Phase 4 — Cryptography

| # | Slice | Depends on | Status |
|---|---|---|---|
| **S9** | Certificate loading: PKCS#12 decoder ADR and pin (PR #165), synthetic `.p12` test fixture (PR #167), in-memory PKCS#12 loader (PR #169). Certificate identity binds to the **signer**, not the emisor — Dominican signing certificates carry a cédula, never the company RNC — with INDOTEL/ViaFirma prefixes resolved on OID `2.5.4.5`. No secrets persisted. | S1 | ☑ Complete (PRs #165, #167, #169; signer-identity correction in `984f013`) |
| **S10** | XMLDSig signer and verifier on the pinned DGII profile: enveloped signature, RSA-SHA256, SHA-256 digest, Reference transform chain terminated by Inclusive C14N, `Reference URI=""`, minimal `KeyInfo` (`X509Data/X509Certificate`). Signed XML remains immutable; vetted library, no hand-rolled C14N. | S2, S9 | ☑ Complete (ADR 0008, PRs #173, #175, #177, #179) |

> **Signing defect fixed in `984f013`.** The Reference transform chain ended on the enveloped
> transform, so the DigestValue covered a plain xmldom serialization instead of the canonical octet
> stream. DGII answered "Firma del certificado invalida". Terminating the chain with Inclusive C14N
> turned that into `200 OK`. Every prior fixture was namespace-free, which is why the suite could
> not see it; fixtures now declare namespaces in non-canonical order.

### Phase 5 — Transport and DGII clients

| # | Slice | Depends on | Status |
|---|---|---|---|
| **S11** | HTTP transport client core: TLS, multipart/form-data, Bearer auth, JSON/XML accept. Environment config: TesteCF / CerteCF / producción base URLs. | — | ☑ Complete (PR #181) |
| **S12** | DGII auth client: GET semilla → sign semilla (reuses S10) → POST validarsemilla → Bearer token cache. | S10, S11 | ☑ Complete (PR #183). Live-verified against TesteCF with a real INDOTEL certificate: `200 OK` plus bearer token (`984f013`). Supporting work: semilla namespace compatibility (PR #197) and the operator auth smoke core/worker/launcher (PRs #199, #201, #203) |
| **S13** | Recepción client: POST signed e-CF multipart → TrackId; consulta-resultado polling (estados 0–4); `secuenciaUtilizada` handling. | S4, S10, S12 | ☑ Complete. Submission: PR #185, first live e-CF 31 accepted by TesteCF with TrackId `d8ff8b59-ad34-49ba-b9b9-386152bc9c14` (PR #205). Consultation by TrackId (PR #187) and the bounded polling scheduler — 120 s deadline, jittered backoff, estados 0–4 classification and `secuenciaUtilizada` disposition (PR #189). Wired into the delivery ledger by S26 (PR #227) |

### Phase 5b — Delivery orchestration and backend authorization

Work delivered after the first live dispatch; absent from earlier revisions of this roadmap.

| # | Slice | Depends on | Status |
|---|---|---|---|
| **S24** | e-CF 31 delivery path: bounded preparation (assemble → sign → serialize → XSD-validate → verify), an append-only PostgreSQL delivery ledger with attempt/event/projection tables, delivery-intent safety so an unconfirmed POST never becomes a blind resend, a transaction runner, and the coordinator that binds them. | S5, S10, S13 | ☑ Complete (PRs #207, #209, #211, #213, #215; migrations `0004`, `0005`) |
| **S25** | Backend authorization: single-use opaque scope capabilities with refresh-on-use (`BackendScopeAuthority`), a PostgreSQL POS authorization kernel with immutable revocation-only credentials and an append-only audit trail, a `dgii_pos_v1_<keyId>_<secret>` key parser, one single-source lookup digest guarded by an architecture test, and the `identify`/`resolve`/`refresh` ports composing the two. | S24 | ☑ Complete (PRs #195, #217, #219, #221, #223; migration `0006`) |
| **S26** | Wire the polling scheduler into the delivery ledger: drive `consult` from an acknowledged attempt and append `RESULT_OBSERVED` / `POLLING_*` events so `delivery_state` reaches a terminal value and the `secuenciaUtilizada` disposition is recorded. | S13, S24 | ☑ Complete (PR #227, merged at `48b5546`): `createEcf31DeliveryResultReconciler` in `src/modules/issuance/application/reconcile-ecf31-delivery-result.ts`, exported from the module index, with unit and integration tests |

> **Scope note on S25.** The authority grants exactly one action, `delivery:evidence:record`, and
> `backend-authorization` is not re-exported from `src/index.ts`. It is the credential and scope
> substrate an ERP/POS-facing API will need — not that API.

### Phase 6 — Hosted taxpayer services (postulation form blockers)

| # | Slice | Depends on | Status |
|---|---|---|---|
| **S14** | ARECF codec (domain + XML + sign). | S3, S10 | ☐ Not started |
| **S15** | Hosted `POST /fe/recepcion/api/ecf` → returns signed ARECF. **Mandatory for postulation.** Framework/deployment ADR. | S14, hosting | ☐ Not started |
| **S16** | ACECF codec + hosted `POST /fe/aprobacioncomercial/api/ecf` (200/400). **Mandatory for postulation.** | S3, S10, hosting | ☐ Not started |
| **S17** | ACECF emission client + directory consultation client (`listado`, `obtenerdirectorioporrnc`). | S11, S12 | ☐ Not started |
| **S18** | Hosted auth service (`/fe/autenticacion/api/semilla` + `/validacioncertificado`). **Optional per DGII** — or explicit ADR to omit. | hosting | ☐ Not started |

### Phase 7 — Remaining document types

| # | Slice | Depends on | Status |
|---|---|---|---|
| **S19+** | e-CF 32/33/34 XML mapping (reuse S4 sections, per-type deltas), then 41/43–47. Widen e-NCF parser. One PR per type. | S4 pattern | ☐ Not started |
| **S20** | RFCE: summary derivation from full 32 + codec + `recepcionfc` client. ⚠️ Borderline — may need codec/client split. | S3, S10 | ☐ Not started |
| **S21** | ANECF anulación flow (build / sign + `anulacionrangos` client). | S3, S10 | ☐ Not started |

### Phase 8 — Representación impresa and certification

| # | Slice | Depends on | Status |
|---|---|---|---|
| **S22a** | Timbre URL composition + printed representation: `https://ecf.dgii.gov.do/{testecf\|certecf\|ecf}/consultatimbre` with the concatenation order `RncEmisor`, `RncComprador`, `ENCF`, `FechaEmision`, `MontoTotal`, `FechaFirma`, `CodigoSeguridad`, and `https://fc.dgii.gov.do/{testecf\|certecf\|ecf}/consultatimbrefc` with `RNCEmisor`, `e-NCF`, `MontoTotal`, `CódigoSeguridad` for FC < RD$250,000; per-environment selection, reserved-character percent-encoding, QR version 8, PDF layout. All of this is fully documented (`descripcion-tecnica-servicios-dgii.pdf`, rev. 02-01-2026, pp. 40-41 and pp. 42-43; percent-encoding at `descripcion-tecnica-servicios-emisores-electronicos.pdf`, rev. 02-01-2026, p. 5) and **not blocked**. Take `CodigoSeguridad` as an injected input. **Exceeds 400 lines.** | S10, S13 | ☐ Not started |
| **S22b** | Final generation of `CodigoSeguridad` from the signature. **Blocked by `OPEN-DGII-01` only** — the requirement is confirmed, the exact derivation is not. Needs a certification fixture; the Base64-substring hypothesis must not be shipped as a production rule. | S22a, official fixture | ☐ Blocked (`OPEN-DGII-01`) |
| **S23** | Certification runbook doc + TesteCF integration test suite. | S4–S21 | ☐ Not started |

---

## 4. Postulation form blockers

The DGII postulation form (`proceso-certificacion-emisor-electronico.pdf` pp.4–6) requires:

| Form field | Blocking slices | Mandatory? |
|---|---|---|
| Nombre del software / Versión | Owner decision only (no code gap) | Yes |
| Tipo de software = PROPIO | Declaration only | Yes |
| URL de recepción (`…/fe/recepcion/api/ecf`) | **S15** (+ S14, S10, S9, S3, hosting) | **Mandatory** |
| URL de aprobación comercial (`…/fe/aprobacioncomercial/api/ecf`) | **S16** (+ hosting) | **Mandatory** |
| URL de autenticación (`…/fe/autenticacion/api/[semilla\|validacioncertificado]`) | **S18** (+ hosting) | Optional |

The form is step 1 of 15. The outbound client chain S10–S13 now exists for type 31; passing
certification additionally requires all document types (S19–S21), representación impresa (S22a/S22b),
and live communication tests (S14–S17). Terminal-state tracking (S26) is delivered.

---

## 5. Certification quotas

Source: `proceso-certificacion-emisor-electronico.pdf`.

| Phase | Requirement |
|---|---|
| Pruebas de Datos | 21 e-CF + 4 RFCE resúmenes + 4 facturas consumo < RD$250k |
| Aprobaciones Comerciales | 11 |
| Simulación | 4×31, 2×32≥250k, 1×33, 2×34, 2×41, 2×43, 2×44, 2×45, 2×46, 2×47, 4×32-RFCE, 4×32<250k |
| Emission order | 31 / 32≥250k / 41 / 43 / 44 / 45 / 46 / 47 → 33 / 34 → RFCE → FC<250k |
| Representación Impresa | PDF uploads (≤10 MB, QR verified) |
| Communication tests | DGII sends e-CFs → return signed ARECF; DGII sends approvals → answer OK/Error |

---

## 6. Owner administrative track (parallel, non-code)

These items run alongside the code roadmap and are prerequisites for postulation:

- [x] INDOTEL-accredited digital certificate — a real `.p12` produced a TesteCF bearer token and a signature DGII accepted (`984f013`, PR #205).
- [ ] RNC standing and tax compliance. *(not verifiable from the repository)*
- [ ] OFV (Oficina Virtual) access. *(not verifiable from the repository)*
- [ ] Alta NCF. *(the live probe consumed an operator-supplied e-NCF and sequence-expiration date against TesteCF; whether that reflects a completed Alta NCF is not verifiable here)*
- [ ] Software name / version decision.
- [ ] Form FI-GDF-016 completion.
- [ ] Signed postulation XML (DGII App Firma Digital or own signer).
- [ ] Public HTTPS hosting: SSL, traditional ports, internet-reachable, not blacklisted.
- [ ] Portal test-set download (only after postulation).

---

## 7. Critical-path summary

```
S1/S2/S3 (complete) → S4a/S4b/S4c/S4d/S4e (complete: XSD-valid full e-CF 31 document)
                              ↓
 S5a (complete) → S5 (complete for ecf-31 + semilla; 13 schemas unexercised)
 S6 → S6b (complete) ; S7 → S8 (complete) → S9 (complete)
 S9 → S10 (complete: ADR 0008, signer + verifier, Inclusive C14N fix)
 S11 → S12 (complete: live 200 OK + bearer token from TesteCF)
      → S13 outbound (complete: live TrackId d8ff8b59… from TesteCF)
 S24 (complete: preparation + append-only delivery ledger + intent safety + coordinator)
 S25 (complete: backend scope authority + POS API-key authorization, migration 0006)
                              ↓
 S26 (complete: polling wired → RESULT_OBSERVED / POLLING_* reach the delivery ledger, PR #227)
S14 → S15 (hosted recepción) ← MANDATORY for form
       S16 (hosted aprobación) ← MANDATORY for form
S17 (directory + ACECF client)
S18 (hosted auth) ← OPTIONAL
S19+ → S20 → S21 (remaining types)
S22a (RI + QR + timbre URLs) ← NOT blocked; fully documented
S22b (CodigoSeguridad generation) ← BLOCKED on OPEN-DGII-01 fixture
S23 (certification runbook)
```

One e-CF 31 has been assembled, signed, XSD-validated and accepted by TesteCF, and the credential
substrate for an ERP/POS-facing backend exists. There is still no submittable postulation form and
no certification: that requires the mandatory hosted services and their hosting (S14–S16, S18), the
remaining document types (S19–S21), representación impresa (S22a, plus S22b once `OPEN-DGII-01` is
settled by a fixture), and the applicable DGII process steps.
