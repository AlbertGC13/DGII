# DGII Recovery

Greenfield TypeScript foundation for a modular electronic fiscal document system for the Dominican Republic. The current implementation is intentionally limited to pure fiscal identity parsing; it does not generate XML, sign documents, or communicate with DGII services.

## Current Scope

The `fiscal-identity` domain module provides deterministic parsers for:

- Taxpayer identifiers: exactly 9 ASCII digits for an RNC or 11 ASCII digits for a cedula.
- e-NCF values: exactly `E` + a two-digit e-CF type + a 10-digit sequence.
- MVP e-CF types 31, 32, 33, and 34.
- Separate safe errors for malformed input and syntactically valid unsupported types.

Inputs are never trimmed or reformatted. Tests use synthetic values only.

## Architecture

This repository starts as a modular monolith. Domain behavior is isolated under `src/modules/<module>/domain`, with `fiscal-identity` as the only module in this bootstrap.

```text
src/
  modules/
    fiscal-identity/
      domain/
```

The choice follows roadmap decisions D1 (TypeScript/Node.js), D2 (modular monolith), and D7 (fixed-precision arithmetic only). The identity module performs no arithmetic.

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
