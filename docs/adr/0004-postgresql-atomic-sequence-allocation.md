# ADR 0004: Allocate sequences with PostgreSQL direct SQL

## Status

Accepted for the atomic allocation proof.

## Decision

Use PostgreSQL 18.4 and parameterized SQL through `pg`. The versioned migration owns two tables and `allocate_fiscal_sequence`, which locks one trusted `(scope_id, e-CF type)` counter row before checking replay, validity, exhaustion, recording the allocation, and advancing the counter.

| Concern | Decision |
| --- | --- |
| Atomicity | One PostgreSQL function and its enclosing transaction |
| Idempotency | Unique trusted scope/type/key with a fingerprint comparison |
| Caller outcome | `allocated`, `replayed`, `idempotency_conflict`, `outside_validity`, `exhausted`, `unprovisioned`, or `invalid_request` |
| Data | Synthetic scope IDs and opaque request fingerprints only |

The backend resolves the trusted scope. Authorization enforcement is deferred, not delegated to the database function.

## Consequences

- Callers use parameterized `pg` queries; transactions use one checked-out client and always release it.
- An enclosing rollback reverses both counter advancement and the idempotency record.
- The numeric ceiling is `9999999999`; a counter may hold `10000000000` only as the exhausted successor.

## Deferred

Production connection pooling, TLS, credentials, migrations deployment, access control, fingerprint canonicalization, observability, retention, and recovery procedures are outside this proof. No fiscal format, XML, certificate, taxpayer identity, or transport rule is defined here.
