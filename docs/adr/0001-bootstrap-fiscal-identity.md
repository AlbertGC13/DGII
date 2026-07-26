# ADR 0001: Bootstrap Only the Fiscal Identity Boundary

- Status: Accepted
- Date: 2026-07-26

## Context

The recovered roadmap establishes TypeScript/Node.js (D1), a modular monolith (D2), and fixed-precision arithmetic (D7). It also defines structural taxpayer identifier and e-NCF contracts in §3 and §7, validation and allocation ordering in §5, e-CF type distinctions in §8.2, safe error categories in §12, and phased delivery in §18.

Official DGII XSD and normative PDF resources are currently missing. The recovered delegation prompt identifies their absence as Blocker 0 and prohibits XML or signing implementation until they are restored.

## Decision

Initialize a Node.js 24 LTS, strict TypeScript, ESM modular monolith with one module: `fiscal-identity`.

Implement only pure structural parsing:

- Taxpayer identifiers are accepted only as 9 or 11 ASCII digits.
- e-NCF values are accepted only as uppercase `E`, a supported MVP type (31-34), and 10 digits.
- Malformed values return `ERP-VAL-002`.
- Syntactically valid non-MVP types return `ERP-VAL-003`, classified as documented non-MVP or unknown.
- Parsers return typed results and never normalize or echo rejected input.

No monetary behavior is included. Future monetary behavior must use fixed-precision decimal values and never IEEE 754 arithmetic.

## Consequences

- The domain boundary is deterministic and testable without infrastructure.
- XML, XSD, signing, certificate, persistence, HTTP, and DGII integration dependencies are deliberately absent.
- Official DGII resources must be restored and verified before Phase 5 or later work starts.
- The recovered roadmap remains subordinate to current official DGII documentation.

## References

- `ROADMAP-DGII-RECONSTRUIDO.md` §3, §4 D1/D2/D7, §5, §7, §8.2, §12, §18.
- `PROMPT-DELEGACION-EQUIPO.md` Blocker 0 and Rules of Gold.
