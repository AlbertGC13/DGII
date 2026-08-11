# DGII Certification Roadmap

> **Status:** reconciled against `origin/main` at merge commit `b6edc6a` (PR #147).
> **Goal:** register PROPIO software with DGII and pass TesteCF / CerteCF certification.
> **Tracking:** GitHub issues and merged PRs are the delivery source of truth; this roadmap records their reconciled status at this baseline.

---

## 1. Current baseline (validated)

The codebase is a **domain-evidence and persistence kernel for e-CF 31 only**, with a partial
internal XML writer and bounded e-CF 31 mappers. Transport, signing, certificate,
authentication, and hosted-service layers remain absent. The available mappers do not establish
an XSD-valid full document, issuance, or certification readiness.

| Capability | Status | Key modules |
|---|---|---|
| Exact decimal arithmetic (`bigint`, no float) | **Done** | `builder/domain/exact-decimal.ts` |
| e-CF 31 core header / line / draft validation | **Done** | `builder/domain/ecf31-core-*.ts` |
| IdDoc issuance evidence (sequence expiry + conditional credit deadline) | **Done** | `builder/domain/ecf31-iddoc-issuance-evidence.ts` |
| IdDoc XML node mapping (internal, partial Encabezado) | **Done** | `builder/infrastructure/ecf31-iddoc-xml-mapper.ts` |
| Partial DetallesItems XML mapping (bounded Item fields, codes, metadata, adjustments, tax, retention, and other-currency detail) | **Done (internal, partial)** | `builder/infrastructure/ecf31-detalles-items-xml-mapper.ts` |
| Line-amount evidence + MontoItem quantization | **Done** | `builder/domain/ecf31-line-amount-*.ts`, `ecf31-monto-item-*.ts` |
| Per-line ±1.00 tolerance gate | **Done** | `builder/domain/ecf31-monto-item-tolerance-gate-evidence.ts` |
| Global adjustment proportional allocation + exact reconciliation | **Done** | `builder/domain/ecf31-global-adjustment-*.ts` |
| ITBIS price-inclusion evidence (pre-adjustment bases) | **Done** | `builder/domain/ecf31-itbis-price-inclusion-evidence.ts` |
| Post-adjustment taxable bases (buckets 1/2/3) | **Done** | `builder/domain/ecf31-post-global-adjustment-taxable-base-evidence.ts` |
| Post-adjustment exempt amount (bucket 4, optional) | **Done** | `builder/domain/ecf31-post-global-adjustment-exempt-amount-evidence.ts` |
| Additional-tax classification (001–039, qualifying ISC proof) | **Done** | `builder/domain/ecf31-additional-tax-classification-evidence.ts` |
| TotalITBIS evidence (guarded, no qualifying ISC) | **Done** | `builder/domain/ecf31-total-itbis-evidence.ts` |
| Derived header totals (compose, persist, and emit v2 envelope) | **Done** | `builder/domain/ecf31-header-totals-evidence.ts`, draft persistence |
| e-NCF structural parser (types 31–34) | **Done** | `fiscal-identity/domain/e-ncf.ts` |
| PostgreSQL atomic sequence allocation kernel | **Done (SQL)** | `db/migrations/0001_atomic_sequence_allocation.sql` |
| Transactional draft-evidence persistence | **Done** | `draft-persistence/infrastructure/postgres-ecf31-draft-evidence-repository.ts` |
| JSON snapshot codecs (v2 emission with legacy v1 compatibility) | **Done** | `builder/application/*-snapshot-codec.ts` |
| Module boundary enforcement + official-resource SHA-256 integrity gate | **Done** | `src/architecture/` |
| Offline closed-catalog XSD validator foundation for 15 integrity-pinned schemas | **Done (S5a, PR #143)** | XSD validation infrastructure |
| Latest verification: 565 unit tests, 18 PostgreSQL integration tests, 100% configured coverage, typecheck/lint/build/package-consumer, and both CI runs | **Done (PRs #143, #145, #147 evidence)** | PRs #143, #145, #147 |

### Known internal gaps inside the baseline

| Gap | Detail |
|---|---|
| e-NCF formatter | No formatter from `allocated_value` (bigint) to `E31` + 10-digit zero-padded sequence. S7 is the next dependency-ready implementation. |
| Idempotency fingerprint | Fingerprint is caller-supplied text; no canonical SHA-256 derivation exists. (Roadmap S8) |
| Persisted additional-tax classification | V1 snapshots do not retain classification; restored drafts cannot prove ISC absence. |
| Remaining item and document mapping | Further Item fields/tables and full-document composition remain pending. |

---

## 2. Official resources available locally

All 25 vendored artifacts under `resources/dgii/official/` are SHA-256-pinned in `manifest.json`
(schema v3, retrieved 2026-07-26, all `confidence: high`) and enforced by
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
| `descripcion-tecnica-servicios-dgii.pdf` (v1.7) | DGII-hosted REST services: auth, recepción, consulta, anulación, directorio, timbre QR; environments TesteCF/CerteCF/producción |
| `descripcion-tecnica-servicios-emisores-electronicos.pdf` (v1.7) | Taxpayer-hosted endpoint contracts (`/fe/recepcion`, `/fe/aprobacioncomercial`, `/fe/autenticacion`) |
| `proceso-certificacion-emisor-electronico.pdf` (Jul 2025) | 15-step certification flow, postulation form, test-set quotas, simulation set |
| `informe-tecnico-ecf-v1.0.pdf` | Calculation rules, half-up rounding, representación impresa |
| `firmado-ecf.pdf` | XMLDSig signing instructive |
| `formato-{acecf,arecf,anecf,rfce}-v1.0.pdf` | Auxiliary document formats |

**Not yet available locally:**

- Certification test-set Excel files (portal-gated, downloadable only after postulation)
- Unambiguous security-code derivation rule (disputed; needs official fixture or clarification)

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
| **S4a** | e-CF 31 XML mapping — internal IdDoc node mapping. | S3, S4a0 | ☑ Complete |
| **S4b0** | Accept genuine parsed domestic 9-digit RNC and 11-digit cédula issuer identifiers in the E-CF 31 core header without changing snapshot v1. | S3 | ☑ Complete |
| **S4b** | e-CF 31 XML mapping — Emisor / Comprador. | S3, S4b0 | ☑ Complete |
| **S4c** | e-CF 31 XML mapping — bounded derived-header-totals subset; non-billable, retention, payment, and additional-tax fields remain deferred. | S3, S6 | ☑ Complete |
| **S4d** | e-CF 31 XML mapping — DetallesItems / TablaCodigosItem / TablaImpuestoAdicional. | S3 | ◐ Incomplete (bounded Item metadata/XML, subadjustment, additional-tax, retention, and other-currency-detail slices are complete; further Item work remains pending) |
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
| **S4e** | e-CF 31 XML mapping — compose the internal bounded `Encabezado` subset from IdDoc, Emisor/Comprador, and Totales nodes. InformacionesAdicionales, Transporte, header-level OtraMoneda, full-document/XSD validation, and signing remain pending. | S4a, S4b, S4c | ☑ Complete |
| **S5** | Offline final full-document XSD validation harness against the 15 vendored XSDs (validator library ADR + fixtures). An unsigned IdDoc fragment is not a final e-CF XSD-valid document; post-signing validation must account for the required XMLDSig signature slot. | S4d, S4e, S10 | ◐ Incomplete |
| **S5a** | Offline closed-catalog validator foundation for 15 integrity-pinned schemas. This foundation does not validate a final full e-CF document and does not complete S5. | — | ☑ Complete (PR #143) |

### Phase 3 — Fiscal wiring completion

| # | Slice | Depends on | Status |
|---|---|---|---|
| **S6** | Wire derived evidence (TotalITBIS + exempt + taxable bases) into `Ecf31HeaderTotalsEvidence`. | — | ☑ Complete |
| **S6b** | Persist genuine same-draft derived-header totals; accept the exact v2 envelope while preserving legacy v1 compatibility, and emit v2 for new snapshots. | S6 | ☑ Complete (PRs #145, #147) |
| **S7** | e-NCF formatter from `allocated_value` → `E31` + 10-digit zero-padded; sequence-allocation TS public API (`index.ts`). | — | ☐ Next (dependency-ready) |
| **S8** | Canonical SHA-256 fingerprint derivation over issuance command; wire into allocate / store. | S7 | ☐ Not started |

### Phase 4 — Cryptography

| # | Slice | Depends on | Status |
|---|---|---|---|
| **S9** | Certificate loading: INDOTEL `.p12`, `SN` = RNC, no secret persistence, synthetic test certs. | S1 | ☐ Not started |
| **S10** | XMLDSig enveloped signer: SHA-256, `preservewhitespace=false`, signed XML immutable. **Library ADR required — no hand-rolled C14N.** ⚠️ May exceed 400 lines without a vetted library. | S2, S9 | ☐ Not started |

### Phase 5 — Transport and DGII clients

| # | Slice | Depends on | Status |
|---|---|---|---|
| **S11** | HTTP transport client core: TLS, multipart/form-data, Bearer auth, JSON/XML accept. Environment config: TesteCF / CerteCF / producción base URLs. | — | ☐ Not started |
| **S12** | DGII auth client: GET semilla → sign semilla (reuses S10) → POST validarsemilla → Bearer token cache (1 h). | S10, S11 | ☐ Not started |
| **S13** | Recepción client: POST signed e-CF multipart → TrackId; consulta-resultado polling (estados 0–4); `secuenciaUtilizada` handling. | S4, S10, S12 | ☐ Not started |

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
| **S22** | Representación impresa (PDF) + QR v8 + timbre URL composition. ⚠️ Blocked partially by disputed security-code derivation. **Exceeds 400 lines.** | S10, S13, official fixture | ☐ Not started |
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

The form is step 1 of 15 — passing certification additionally requires the full client chain
(S10–S13), all document types (S19–S21), representación impresa (S22), and live communication
tests (S14–S17).

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

- [ ] INDOTEL-accredited digital certificate for the e-CF Admin User.
- [ ] RNC standing and tax compliance.
- [ ] OFV (Oficina Virtual) access.
- [ ] Alta NCF.
- [ ] Software name / version decision.
- [ ] Form FI-GDF-016 completion.
- [ ] Signed postulation XML (DGII App Firma Digital or own signer).
- [ ] Public HTTPS hosting: SSL, traditional ports, internet-reachable, not blacklisted.
- [ ] Portal test-set download (only after postulation).

---

## 7. Critical-path summary

```
S1/S2/S3 (complete) → S4a/S4b/S4c/S4e (bounded internal XML complete)
                              ↓
                     S4d (incomplete Item work) → S5 (full-document XSD validation)
 S5a (complete validator foundation; does not complete S5)
 S6 → S6b (complete: persisted same-draft totals; v2 emission + v1 compatibility)
 S7 (NEXT, dependency-ready) → S8 (e-NCF + fingerprint)
S9 → S10 (certificate + XMLDSig)
S11 → S12 → S13 (transport + auth + recepción)
S14 → S15 (hosted recepción) ← MANDATORY for form
       S16 (hosted aprobación) ← MANDATORY for form
S17 (directory + ACECF client)
S18 (hosted auth) ← OPTIONAL
S19+ → S20 → S21 (remaining types)
S22 (RI + QR) ← BLOCKED on security-code clarification
S23 (certification runbook)
```

There is no implemented path to a submittable postulation form or certification. It still
requires completion of the remaining document work and full-document validation, certificate and
signing capability, mandatory hosted services and hosting, plus the applicable DGII process steps.
