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

## Blocker 0

XML generation, XSD validation, XMLDSig signing, certificate handling, and DGII networking are blocked. The official XSD and normative PDF resources referenced by the recovered roadmap have not been restored. Roadmap §18 requires those resources for Phase 5 and later acceptance criteria, so implementing those behaviors now would require inventing or trusting unverified fiscal rules.

Work in those areas must wait until the official resources are restored, versioned, and checked against the roadmap. See [ADR 0001](docs/adr/0001-bootstrap-fiscal-identity.md).

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
