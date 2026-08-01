# DGII Certification Roadmap

> **Status:** audited and CodeGraph-validated against `main` (`c5496be`).
> **Goal:** register PROPIO software with DGII and pass TesteCF / CerteCF certification.
> **Source audit:** memory topics `audit/certification-gap` and `architecture/roadmap-certification`.

---

## 1. Current baseline (validated)

The codebase is a **domain-evidence and persistence kernel for e-CF 31 only**. CodeGraph
confirms that every transport, XML, signing, certificate, authentication, and hosted-service
layer is **entirely absent**.

| Capability | Status | Key modules |
|---|---|---|
| Exact decimal arithmetic (`bigint`, no float) | **Done** | `builder/domain/exact-decimal.ts` |
| e-CF 31 core header / line / draft validation | **Done** | `builder/domain/ecf31-core-*.ts` |
| IdDoc issuance evidence (sequence expiry + conditional credit deadline) | **Done** | `builder/domain/ecf31-iddoc-issuance-evidence.ts` |
| Line-amount evidence + MontoItem quantization | **Done** | `builder/domain/ecf31-line-amount-*.ts`, `ecf31-monto-item-*.ts` |
| Per-line ±1.00 tolerance gate | **Done** | `builder/domain/ecf31-monto-item-tolerance-gate-evidence.ts` |
| Global adjustment proportional allocation + exact reconciliation | **Done** | `builder/domain/ecf31-global-adjustment-*.ts` |
| ITBIS price-inclusion evidence (pre-adjustment bases) | **Done** | `builder/domain/ecf31-itbis-price-inclusion-evidence.ts` |
| Post-adjustment taxable bases (buckets 1/2/3) | **Done** | `builder/domain/ecf31-post-global-adjustment-taxable-base-evidence.ts` |
| Post-adjustment exempt amount (bucket 4, optional) | **Done** | `builder/domain/ecf31-post-global-adjustment-exempt-amount-evidence.ts` |
| Additional-tax classification (001–039, qualifying ISC proof) | **Done** | `builder/domain/ecf31-additional-tax-classification-evidence.ts` |
| TotalITBIS evidence (guarded, no qualifying ISC) | **Done** | `builder/domain/ecf31-total-itbis-evidence.ts` |
| Header-totals generic composer | **Done (unwired)** | `builder/domain/ecf31-header-totals-evidence.ts` |
| e-NCF structural parser (types 31–34) | **Done** | `fiscal-identity/domain/e-ncf.ts` |
| PostgreSQL atomic sequence allocation kernel | **Done (SQL)** | `db/migrations/0001_atomic_sequence_allocation.sql` |
| Transactional draft-evidence persistence | **Done** | `draft-persistence/infrastructure/postgres-ecf31-draft-evidence-repository.ts` |
| JSON snapshot codecs (v1) | **Done** | `builder/application/*-snapshot-codec.ts` |
| Module boundary enforcement + official-resource SHA-256 integrity gate | **Done** | `src/architecture/` |
| 347 tests, 100% coverage, CI green | **Done** | — |

### Known internal gaps inside the baseline

| Gap | Detail |
|---|---|
| Header-totals wiring | `createEcf31HeaderTotalsEvidence` is called only from the snapshot codec. Nothing composes TotalITBIS + exempt + taxable-base evidence into it. (Roadmap S6) |
| e-NCF formatter | No formatter from `allocated_value` (bigint) to `E31` + 10-digit zero-padded sequence. (Roadmap S7) |
| Idempotency fingerprint | Fingerprint is caller-supplied text; no canonical SHA-256 derivation exists. (Roadmap S8) |
| Persisted additional-tax classification | V1 snapshots do not retain classification; restored drafts cannot prove ISC absence. |

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
| **S4a** | e-CF 31 XML mapping — Encabezado / IdDoc. | S3, S4a0 | ☐ Not started |
| **S4b** | e-CF 31 XML mapping — Emisor / Comprador. | S3 | ☐ Not started |
| **S4c** | e-CF 31 XML mapping — Totales. | S3, S6 | ☐ Not started |
| **S4d** | e-CF 31 XML mapping — DetallesItems / CodigosAdicionales / OtrosImpuestos. | S3 | ☐ Not started |
| **S5** | Offline XSD validation harness against the 15 vendored XSDs (validator library ADR + fixtures). Unsigned mapping tests are not final e-CF validation: post-signing validation must account for the required XMLDSig signature slot. | S4a | ☐ Not started |

### Phase 3 — Fiscal wiring completion

| # | Slice | Depends on | Status |
|---|---|---|---|
| **S6** | Wire derived evidence (TotalITBIS + exempt + taxable bases) into `Ecf31HeaderTotalsEvidence`; extend persistable envelope. | — | ☐ Not started |
| **S7** | e-NCF formatter from `allocated_value` → `E31` + 10-digit zero-padded; sequence-allocation TS public API (`index.ts`). | — | ☐ Not started |
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
S1 (complete) → S2 → S3 → S4a0 → S4a-d → S5
                                 ↓
S6 (totals wiring) ─────────────→ S4c (Totales XML)
S7 → S8 (e-NCF + fingerprint)
S9 → S10 (crypto)
S11 → S12 → S13 (transport + auth + recepción)
S14 → S15 (hosted recepción) ← MANDATORY for form
       S16 (hosted aprobación) ← MANDATORY for form
S17 (directory + ACECF client)
S18 (hosted auth) ← OPTIONAL
S19+ → S20 → S21 (remaining types)
S22 (RI + QR) ← BLOCKED on security-code clarification
S23 (certification runbook)
```

The shortest path to a submittable postulation form is:
**S1 → S2 → S3 → S4a0 → S4a-d → S6 → S9 → S10 → S14 → S15 → S16 (+ hosting).**
