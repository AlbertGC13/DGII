# ADR 0005: Validate DGII XSD offline with pinned xmllint-wasm

## Status

Accepted for S5a infrastructure validation.

## Decision

Use `xmllint-wasm` 5.3.0, the `noppa/xmllint-wasm` Node adapter around libxml2 2.13.8 compiled to WebAssembly. The pinned pnpm lock integrity is the dependency authority; upstream README and package metadata were checked on 2026-08-10.

| Concern | Decision |
| --- | --- |
| Schemas | Closed catalog of the 15 vendored DGII XSDs only |
| Resource trust | Verify the DGII schema-v3 manifest and SHA-256 bytes before each load |
| I/O | Read fixed authority-root paths only; no discovery, network, schema preload, or caller file names |
| XML safety | Reject `DOCTYPE` and entity declarations before calling libxml2 |
| Caller result | `valid` only, or a safe catalog error without validator diagnostics |

## Consequences

- This is XSD 1.0 structural validation, not XMLDSig validity, certificate validation, transport acceptance, or final-document readiness.
- Full e-CF validation remains deferred until final document composition and signing work are available.
