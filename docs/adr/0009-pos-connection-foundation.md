# ADR 0009: POS connection foundation

## Status

Accepted as owner-approved architecture. This ADR records decisions only. It adds no server, no dependency, no migration, no configuration, and no entity. Nothing here is implemented by this document, and nothing here weakens an accepted earlier ADR.

## Decision

| # | Decision |
| --- | --- |
| 1 | Fastify + TypeScript, one server, two independent plugin surfaces: `/api/v1/...` for the ERP/POS and `/fe/...` for the DGII-facing receiver. |
| 2 | The `.p12` is encrypted at rest with AES-256-GCM under an external master key held in a secret manager; a `Signer` abstraction is the only thing that reaches key material. |
| 3 | The certificate belongs to `company`, never to `branch`. |
| 4 | `scope_id` remains the authorization boundary and must not become a branch. Hierarchy: `scope -> company -> branch -> cash_register`. |
| 5 | `Sucursal` is fiscal and internal; `cash_register_id` is internal metadata only. Branches carry `dgii_registered` / `fiscal_enabled`. |
| 6 | DGII configuration is per service and per environment under the name `DGIIServiceEndpoints`; there is no single base URL. |
| 7 | `Invoice` 1:N `DeliveryAttempt`. The existing attempt-level state machine is preserved; an invoice-level `fiscal_status` projection sits above it. |
| 8 | Keep the existing allocator. Extend `sequence_counters`; generalise `formatEcf31ENcf()` to `formatENcf(ecfType, sequence)` for 31/32/33/34. |
| 9 | Nothing decided here may foreclose a per-branch contingency model. |
| 10 | `Idempotency-Key` plus a canonical `payload_hash` at the ERP boundary, with 30-day key retention. |

## What Already Exists And Must Not Be Rebuilt

The repository is a library. There is no HTTP server and no server dependency; every DGII client is outbound only and receives an injected `executor` rather than opening a listener. The certificate is read from disk by an operator script (`scripts/testecf-ecf31-probe.mjs`) that prompts for the password on a hidden TTY and passes bytes plus password to `loadInMemoryPkcs12`. No migration defines a company, branch, cash register, certificate, or invoice entity. The multi-tenant discriminator today is an opaque `scope_id` plus `environment`, projected from the POS authorization membership in `0006_pos_api_authorization.sql`.

`BackendScopeAuthority` (`src/modules/backend-authorization/backend-scope-authority.ts`) mints single-use opaque capabilities for exactly one action, the literal `delivery:evidence:record`, and re-reads authorization on use through an `identify`/`resolve`/`refresh` port triple that `createPosBackendScopeAuthorityPorts` binds to one presented API key. The kernel adapter resolves a constant-time digest comparison inside `resolve_pos_authorization`, and every POS authorization row is immutable except for a one-way revocation. The POS API-key parser fixes one presentation, `dgii_pos_v1_<keyId:20>_<secret:43>`, and one lookup digest formula. These are preserved as-is.

The delivery ledger (`0004_ecf31_delivery_evidence.sql`, `0005_ecf31_delivery_intent_safety.sql`) is append-only, keyed on `(scope_id, ecf_type, allocation_idempotency_key, attempt_key)`, and projects `ecf31_delivery_current` through database triggers alone. `PREPARED` in the issuance flow already means assembled, signed, XSD-validated, and signature-verified. The allocator (`0001_atomic_sequence_allocation.sql`, ADR 0004) is preserved unchanged in behaviour.

## HTTP Server And Surface Separation

Fastify with TypeScript is the server. One process hosts two plugin surfaces that must be separate modules with different exposure policies, because they have different audiences and different threat models: `/fe/...` is publicly reachable by DGII obligation, since DGII itself calls the issuer's receiver endpoints, while `/api/v1/admin` must never be publicly reachable. Routes are case-insensitive, served over HTTPS, on traditional ports. The two surfaces must not share route prefixes, authentication middleware, or error serialisation, so that widening one cannot silently widen the other.

## Certificate Custody

The `.p12` is stored encrypted at rest with AES-256-GCM. The master key is external, held in a secret manager, and must never live in the database or in a plain environment variable. A `Signer` abstraction is introduced so that the signing capability, not the key, is what circulates: this extends the opaque-capability pattern that `signWithAuthenticatedCertificate` already established in ADR 0007 and consumed in ADR 0008, where the signer receives a handle and never a `KeyObject`, PEM, PKCS#12 bytes, or password.

This is the single largest new attack surface in the system, and the decision hardest to reverse. Once client certificates are stored, a custody mistake is not a bug that can be patched forward: the affected taxpayers must re-issue certificates. Today no certificate is stored at all — the operator supplies it per run — so the transition from zero stored key material to stored key material is the sharpest security boundary this project crosses.

## Tenancy Model

The certificate belongs to `company`, never to `branch`. Branches of one legal person share the same fiscal identity and therefore the same certificate; attaching custody to a branch would multiply stored key material with no fiscal justification.

`scope_id` stays the authorization boundary and must not become a branch. Mixing the security boundary with commercial structure is the specific error being avoided: an authorization scope answers "what may this credential do", while a branch answers "where did this sale happen", and the two change for unrelated reasons and at unrelated rates. The hierarchy is `scope -> company -> branch -> cash_register`.

## Fiscal Placement Of Sucursal And Cash Register

`Sucursal` is both fiscal and internal: it goes into the e-CF XML, where the XSD makes it optional, and into our own model. `cash_register_id` is internal metadata only and must never be forced into a fiscal field DGII did not design for it; overloading an optional fiscal element with a register identifier would emit a value DGII neither expects nor validates.

Branches carry a `dgii_registered` / `fiscal_enabled` flag so the software never confuses "the store exists in our database" with "DGII recognises this establishment". Those are separate facts, and the second one gates what may appear in a transmitted document.

## DGII Endpoint Configuration

DGII configuration is per service and per environment; a single base URL cannot express the real topology. The timbre endpoints are `https://ecf.dgii.gov.do/{testecf|certecf|ecf}/consultatimbre` for the ordinary e-CF and `https://fc.dgii.gov.do/{testecf|certecf|ecf}/consultatimbrefc` for the consumer invoice, `consultatrackids` lives at `.../{ambiente}/consultatrackids/api/trackids/consulta`, and RFCE reception is on a different host entirely, `fc.dgii.gov.do`. The configuration shape is named `DGIIServiceEndpoints`.

The current transport's environment-root configuration must be revisited. `createDgiiHttpTransport` accepts `roots` for exactly two services, `ecf` and `rfce`, and an `environment` value that it validates and stores but never uses to compose a URL: the environment segment has to be pre-baked into each root by the caller, as `src/internal/testecf-auth-smoke-core.ts` does with the hard-coded `https://ecf.dgii.gov.do/testecf/autenticacion` and `https://fc.dgii.gov.do/testecf/recepcionfc`. That shape cannot express one service per root with an environment selected at runtime, which is what `DGIIServiceEndpoints` requires.

## Invoice And Delivery Attempts

`Invoice` stands in a 1:N relationship to `DeliveryAttempt`. The existing state machine is a delivery-attempt machine and stays exactly as it is. It is not replaced, and no `SIGNED` state is added, because `PREPARED` already means assembled, signed, XSD-validated, and signature-verified; a `SIGNED` state would name a moment the pipeline never rests at.

An invoice-level projection, `fiscal_status`, is added above the attempt machine. The POS must never need to understand `attempt_key`: it asks `GET /invoices/{invoiceId}` and the backend resolves the complexity. One e-CF may carry several TrackIds — DGII accepts multiple submissions of the same e-NCF and mints a TrackId for each — and remains one invoice.

## Sequence Allocation

Keep the existing allocator. No parallel sequence table is built; `sequence_counters` is extended. `formatEcf31ENcf()` is generalised to `formatENcf(ecfType, sequence)` covering 31/32/33/34, which the e-NCF parser in `src/modules/fiscal-identity/domain/e-ncf.ts` already accepts through `SupportedEcfType`.

The allocator already provides `FOR UPDATE` serialisation on one `(scope_id, ecf_type)` counter row, durable allocation records, idempotency by key plus request fingerprint, conflict detection, validity-window checks, and range-exhaustion detection. That is the complete set of guarantees three concurrent branches need; a second mechanism would add a second failure mode without adding a guarantee.

## Contingency Non-Foreclosure

P10 is not designed here. Nothing decided now may prevent a model carrying `company_id`, nullable `branch_id`, `contingency_type`, `scope: PARTIAL | TOTAL`, `started_at`, `resolved_at`, `deadline_at`, and `status`. The nullable `branch_id` is the load-bearing part: contingency scope is partial or total, so a record keyed on company alone cannot express one branch in contingency while the rest keeps issuing.

The three regimes stay distinct, per ADR 0002 and `instructivo-contingencia-fe.pdf` (Febrero 2026): `OFFLINE_TRANSMISSION_CONTINGENCY`, 72 hours with a mandatory printed legend (p. 5); `NON_ELECTRONIC_ISSUANCE_CONTINGENCY`, capped at 15 **calendar** days (p. 5, p. 9) with 30 **calendar** days afterwards to regularise (p. 12); and `DGII_PLATFORM_CONTINGENCY`, where only an outage exceeding 15 **business** days enables the OFV reporting option (p. 12). Partial and total scope are glossary terms of the same document (p. 3). The two 15-day thresholds are different units and must never share a constant.

## Idempotency Layers

The ERP boundary gets its own idempotency: an `Idempotency-Key` header plus a canonical `payload_hash`, retained for 30 days. The same key with the same hash returns the original response; the same key with a different hash is a conflict. Retention is bounded so the key table does not become a permanent ledger.

This is a third, distinct layer, and the three must not be conflated:

| Layer | Key | Protects | Outcome on replay |
| --- | --- | --- | --- |
| ERP boundary | `Idempotency-Key` + `payload_hash` | An HTTP request being sent twice | The original response is returned; a differing hash is a conflict. |
| Allocator (ADR 0004, ADR 0006) | `(scope_id, ecf_type, idempotency_key)` + request fingerprint | A sequence number being consumed twice | `replayed` with the original value, or `idempotency_conflict`. |
| Delivery ledger | `event_key` unique per `(scope_id, ecf_type, allocation_idempotency_key, attempt_key)` | A delivery observation being applied twice | The duplicate insert is rejected; the projection is untouched. |

They nest but do not substitute. An ERP-boundary replay may return a cached response without ever reaching the allocator; an allocator replay may return an already-allocated sequence for a genuinely new HTTP request; and a delivery-event key deduplicates observations of a submission that was allocated exactly once. A single shared key would collapse three independent retry domains into one and would make an ERP retry look like a duplicate DGII observation.

## Scope Widening

`BackendAction` is currently the single literal `delivery:evidence:record`, and `issue`, `use`, and all three POS ports reject any other value. An ERP/POS API needs at least read and write scopes, so this literal must widen to a set.

Widening it touches a merged module held to 100% line, branch, function, and statement coverage by `vitest.config.ts`, so every new action multiplies the denial paths that must be exercised. Capabilities are single-use — `use` marks the state consumed before it does anything else — so an endpoint performing two operations needs two capabilities, and no endpoint may reuse one capability across a read and a write.

## Sequencing And Prerequisites

`OPEN-DGII-01`, the exact derivation of `CodigoSeguridad`, remains open. It does not block the timbre, QR, or printed-representation work: the URLs, environment selection, parameter order, percent-encoding, and QR version 8 are documented and buildable now, and the security code enters as an injected input.

E31 is the first vertical slice, but E32/RFCE is a hard prerequisite for productive client connection, not a later increment. For this client E32 will be far more frequent than E31, and RFCE is a different format on a different host.

`consultatrackids` must land before any retry endpoint. DGII accepts multiple submissions of the same e-NCF and generates multiple TrackIds, so duplicate control is ours and cannot be delegated to DGII. The never-blind-resend policy stands, together with the verified `secuenciaUtilizada` semantics already encoded in `dgii-result-consultation` and in the `0004` check constraint: `true` means the sequence cannot be reused (`CONSUMED_NON_REUSABLE`), `false` means it can (`POTENTIALLY_REUSABLE_NO_BLIND_RESEND`).

## Alternatives

| Candidate | Decision | Reason |
| --- | --- | --- |
| Fastify, two plugin surfaces, one server | Selected | One deployment unit, one TLS termination, explicit per-surface exposure policy. |
| Two separate servers or processes for `/api/v1` and `/fe` | Rejected for now | Stronger isolation, but it doubles deployment, certificate, and configuration surface before there is operational need. Recorded as the escape hatch if `/fe` exposure proves unsafe. |
| One shared router with path-based exposure rules | Rejected | A single middleware chain makes "publicly reachable" a per-route attribute that any careless route can inherit. |
| `.p12` in the database or a plain environment variable | Rejected | Key material would sit in backups, replicas, logs, and process listings, and no custody boundary could be enforced afterwards. |
| Certificate attached to `branch` | Rejected | Branches of one legal person share one fiscal identity; per-branch custody multiplies stored key material for no fiscal gain. |
| `scope_id` reinterpreted as a branch | Rejected | It fuses the security boundary with commercial structure, so a store opening becomes an authorization change. |
| `cash_register_id` in a fiscal XML field | Rejected | DGII designed no field for it; the value would be transmitted where nothing validates or expects it. |
| A single `DGII_BASE_URL` | Rejected | RFCE reception, timbre FC, and TrackId consultation are on different hosts and roots, so one base URL cannot address them. |
| A new invoice-level state machine replacing the attempt machine | Rejected | The attempt machine is append-only, trigger-enforced, and correct; a projection above it is additive, a replacement is a rewrite. |
| A `SIGNED` state in the delivery machine | Rejected | `PREPARED` already covers assembled, signed, XSD-validated, and signature-verified. |
| A parallel sequence table for multi-branch numbering | Rejected | `sequence_counters` with `FOR UPDATE` already serialises concurrent allocation; a second table adds a second source of truth. |
| One shared idempotency key across ERP, allocator, and delivery ledger | Rejected | Three retry domains with different lifetimes and different conflict semantics would be collapsed into one. |

## Consequences And Risks

- **Certificate custody is the dominant risk.** The system moves from storing no key material to storing every client's `.p12`. AES-256-GCM at rest with an external master key is necessary but not sufficient: key rotation, master-key compromise recovery, and audit of every `Signer` invocation must be designed before the first certificate is stored, because there is no forward fix after a leak.
- **Hosting both surfaces on one server creates coupling.** A crash, a resource exhaustion, or a dependency upgrade on the ERP side affects the DGII-facing receiver, and vice versa. The mitigation is strict module separation and per-surface exposure policy; the escape hatch is splitting into two processes, which the module boundary must keep cheap.
- **Introducing `invoice` above an existing attempt-level machine has a real migration cost.** Delivery rows are keyed on `(scope_id, ecf_type, allocation_idempotency_key, attempt_key)` with no invoice column, so every existing attempt must be attributed to a synthesised invoice, and `fiscal_status` must be derivable from the attempt projection rather than maintained independently.
- **`scope_id` currently has no `company` behind it.** `pos_scope_memberships` stores an opaque `scope_id` with no company row anywhere in the schema, and `allocateCanonicalIssuance` today takes its `scopeId` from the caller-supplied `command.issuer.tenantId` rather than from an authorization context. P2 must map scope to company and close that gap; until it does, "the tenant" is whatever the caller declared.
- **The authorization module is complete but unwired.** `backend-authorization` has no `index.ts`, is not re-exported from `src/index.ts`, and no issuance path calls it. The API work is therefore both the first consumer of the authority and the first place its single-use, refresh-on-use semantics meet real endpoints.
- **Widening `BackendAction` is not a one-line change.** The 100% coverage gate applies to a merged module, and every added action expands the denial matrix that `issue`, `use`, and the three ports must be proven to reject.
- **Two 15-day thresholds and two idempotency-adjacent concepts are the likeliest sources of a silent bug.** Calendar versus business days, and ERP key versus allocator key, must be separate constants and separate types.

## Verification

No code, migration, dependency, or configuration accompanies this ADR. Verification is that the repository is unchanged apart from this file: `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `git diff --check` all pass unchanged, and no `package.json`, `db/migrations/`, or `src/` file is touched. Each decision recorded here becomes verifiable only when its own slice is implemented, and each such slice must cite this ADR and the DGII source it depends on.

## Sources

All DGII citations reused from prior verified work; no new citation is introduced by this ADR.

- `informe-tecnico-ecf-v1.0.pdf` (Marzo 2026), p. 36 — the `CodigoSeguridad` rule behind `OPEN-DGII-01`.
- `descripcion-tecnica-servicios-dgii.pdf` (rev. 02-01-2026), pp. 40-41 — `consultatimbre` URLs, parameter order, QR version 8; pp. 42-43 — `consultatimbrefc`.
- `descripcion-tecnica-servicios-emisores-electronicos.pdf` (rev. 02-01-2026), p. 5 — percent-encoding of reserved characters in printed-representation QR security-code data.
- `instructivo-contingencia-fe.pdf` (Febrero 2026), p. 3 — partial and total contingency glossary; p. 5 — both taxpayer regimes and the 72-hour legend; p. 9 — the 15-calendar-day cap; p. 12 — the 30-calendar-day regularisation and the 15-business-day DGII threshold.
