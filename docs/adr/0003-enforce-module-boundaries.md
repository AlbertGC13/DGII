# ADR 0003: Enforce module boundaries

## Status

Accepted.

## Decision

The modular-monolith dependency rules are executable tests rather than review-only conventions.

| Source | Allowed dependencies | Forbidden dependencies |
| --- | --- | --- |
| `src/modules/<module>` | Its own files, `src/shared`, external packages, another module's `index.ts` | Another module's internal files |
| `src/shared` | Its own files, external packages | Any business module |

Business-module dependency cycles are forbidden. The test suite analyzes every TypeScript source file under `src` with the TypeScript compiler API and validates the repository graph alongside synthetic fixtures.

## Consequences

- A module exposes cross-module contracts only from `src/modules/<module>/index.ts`.
- Internal domain paths remain implementation details and cannot become accidental dependencies.
- Shared code remains dependency-safe and cannot become a back door into business behavior.
- A failing boundary test identifies the importing file and module specifier, or the cycle path.

## Verification

Run the standard suite:

```bash
pnpm test
```

The `module-boundaries` tests prove permitted public imports and reject deep imports, shared-to-module imports, and cycles using synthetic fixtures. They also analyze the repository's actual `src` graph.

## Non-goals

This decision does not define fiscal, XML, signing, certificate, persistence, API, or transport behavior.
