# DGII Recovery

**Current status:** a tested foundation, not a production issuance system. Implemented work is limited to the following foundations:

- Synthetic fiscal identity and e-NCF structural parsing.
- Immutable exact decimals backed by `bigint`.
- Executable static and literal-dynamic module-boundary and cycle checks.
- An official-resource manifest integrity gate.
- A PostgreSQL 18.4 atomic and idempotent sequence-allocation proof.
- A compiled-package external-consumer smoke test.

The sequence SQL is a verified kernel/proof, **not** a production issuance service, authorization layer, or public API. Tests and documentation use synthetic fiscal identities and transaction data only. Do not store or expose secrets; monetary values must use fixed-precision decimals, never `float` or `double` arithmetic.

## Verify

Use Node.js 24 LTS and the pinned pnpm version.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm test:coverage
pnpm typecheck
pnpm lint
pnpm build
pnpm test:package-consumer
```

PostgreSQL integration is separate from the default suite. Start an isolated PostgreSQL 18.4 instance, provide `DATABASE_URL` through your secure environment mechanism, then run `pnpm test:integration`. CI uses the same command with PostgreSQL 18.4.

## Evidence and Boundaries

Current official DGII evidence is authoritative. The recovered roadmap and derived notes are planning context only. Do not casually modify official or recovered artifacts.

- Official snapshot and integrity index: [`resources/dgii/official/README.md`](resources/dgii/official/README.md) and [`manifest.json`](resources/dgii/official/manifest.json).
- Accepted implementation boundaries: [ADR 0003](docs/adr/0003-enforce-module-boundaries.md) and [ADR 0004](docs/adr/0004-postgresql-atomic-sequence-allocation.md).
- Earlier context: [ADR 0001](docs/adr/0001-bootstrap-fiscal-identity.md) and [ADR 0002](docs/adr/0002-provisional-integration-boundaries.md).

## Intentionally Blocked or Deferred

- Owner-approved issuance-command material fields, date/order rules, and canonical serialization.
- Backend authorization and any public API.
- XML generation and schema validation pending an explicitly bounded document-type scope, field mapping, and verification against the restored current official XSDs.
- Calculated fiscal totals and field-specific rounding/decimal policies.
- Signatures, certificates, and transport.
- Production database pooling, TLS, credentials, migration deployment, retention, recovery, and observability.

## Architecture

This repository starts as a modular monolith. Domain behavior is isolated under `src/modules/<module>/domain`.

```text
src/
  modules/
    fiscal-identity/
      domain/
    builder/
      domain/
  shared/
    domain/
```

The choice follows roadmap decisions D1 (TypeScript/Node.js), D2 (modular monolith), and D7 (fixed-precision arithmetic only). Generic domain results live under `shared`; Builder does not depend on fiscal-identity internals.

## Architecture Verification

Module boundaries are checked as part of the test suite:

- Business modules live in `src/modules/<module>`.
- Modules may depend on `src/shared`, but shared code cannot depend on a business module.
- Cross-module dependencies must resolve to the target module's public `index.ts`.
- Business modules cannot form dependency cycles.

```bash
pnpm test
```

## Source Boundaries

The recovered roadmap is planning evidence, not a substitute for official DGII resources. Official DGII documents override it, and no fiscal rule may be invented.

This bootstrap implements only rules supported by:

- Roadmap §3: RNC/cedula and e-NCF structural definitions and documented e-CF types.
- Roadmap §4 D1, D2, and D7: stack, architecture, and numeric safety.
- Roadmap §5 steps 2-4: structural validation before later fiscal processing and allocation.
- Roadmap §7: taxpayer identifier and e-NCF data contracts.
- Roadmap §8.2: distinctions among e-CF types.
- Roadmap §12: `ERP-VAL-002` malformed-format and `ERP-VAL-003` unsupported-type contracts.
- Roadmap §18: Phase 1 scaffolding precedes later fiscal, XML, signing, and integration work.

## Official DGII resources

The current first-party DGII source set was restored on 2026-07-26 under [`resources/dgii/official`](resources/dgii/official/). Its manifest describes 26 logical official artifacts with source URLs, retrieval metadata, byte sizes, SHA-256 checksums, and explicit storage modes. Twenty-five artifacts are vendored: 10 PDFs and 15 XSDs. The valid 13-page contingency guide is provenance-locked but external, not vendored; an independently acquired local copy may be kept at the Git-ignored path `resources/dgii/official/pdfs/instructivo-contingencia-fe.pdf`.

To reacquire the external guide, start from the official DGII documentation landing page recorded in the manifest, follow the current "Instructivo de Contingencia de FE" link, and verify the response metadata, 4,607,632-byte size, and SHA-256 before use. A clean clone is complete without this optional local file. Current official DGII sources override recovered notes wherever they differ.

Resource acquisition clears the prerequisite for contract extraction and XSD-backed design; it does not authorize guessed fiscal behavior. XML, signing, certificate, and network implementation must cite the applicable official artifact and pass official-schema or TesteCF evidence. Security-code derivation remains blocked because the current documents do not fully specify the extraction operation. See [ADR 0001](docs/adr/0001-bootstrap-fiscal-identity.md) and [ADR 0002](docs/adr/0002-provisional-integration-boundaries.md).

The first Builder decimal profiles are derived from the common simple types in the official e-CF 31-34 XSDs: `Decimal18D1or2ValidationTypeMayorIgualCero`, `Decimal18D1or2ValidationTypeMayorCero`, and `Decimal20D1or4ValidationTypeMayorIgualCero`. XSD fractional digits are treated as a maximum scale, not fixed trailing places. Signed amounts, rates, exchange rates, scale-3 subquantities, rounding, quantization, and calculated fiscal totals remain intentionally deferred because this source set does not establish an unambiguous implementation policy for them.

## Tooling

Node.js 24 LTS and pnpm 11 are required.

```bash
pnpm install
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm test:coverage
```
