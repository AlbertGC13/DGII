# ADR 0006: Canonical issuance command fingerprint

## Status

Accepted. This is frozen INTERNAL product policy for V1; it does not define or infer DGII requirements.

## Decision

Every issuance request is represented by a freshly constructed, ordered V1 object. Its UTF-8 bytes are hashed as:

```text
SHA-256("V1::" + JSON.stringify(canonicalCommand))
```

The digest is lowercase hexadecimal. `canonicalCommand` has this exact JSON property order:

```text
{
  "issuer": {
    "tenantId": "...",
    "rnc": "..."
  },
  "ecfType": "...",
  "requestedOn": "YYYY-MM-DD",
  "buyerIdentity": {
    "rnc": null,
    "cedula": null,
    "foreignIdentifier": null
  },
  "declaredTotals": {
    "montoTotal": "...",
    "totalItbis": "...",
    "montoGravadoTotal": "...",
    "montoExento": "..."
  },
  "items": [
    {
      "numeroLinea": "...",
      "nombreItem": "...",
      "indicadorFacturacion": "...",
      "indicadorBienoServicio": "...",
      "cantidadItem": "...",
      "precioUnitarioItem": "...",
      "montoItem": "...",
      "montoDescuento": null,
      "montoRecargo": null
    }
  ]
}
```

`items` retains caller order and each `numeroLinea`; it is never sorted. Every decimal is an exact-decimal canonical string, never a JSON number. Absent, `null`, and empty optional values normalize to `null`.

`requestedOn` is canonical `YYYY-MM-DD`. Input adapters may translate approved alternate formats before canonicalization. Buyer identifiers remove hyphens and spaces, and exactly zero or one of `rnc`, `cedula`, and `foreignIdentifier` may be non-null. `foreignIdentifier` is policy-approved even though the current fiscal-identity parser does not support it; V1 validation requires only a cleaned, nonempty string and must not invent DGII semantics.

`declaredTotals` is an explicit caller DTO. The fingerprint and a future declared-versus-derived tolerance circuit breaker consume these declared values; they must not be calculated or derived for this purpose.

## Idempotency boundary

| Condition | Required outcome |
| --- | --- |
| Same idempotency key and hash | Replay the original outcome without a new allocation |
| Same idempotency key and different hash | `idempotency_conflict`; do not allocate or mutate state |
| Future HTTP mapping for `idempotency_conflict` | `409 Conflict` |

The generated sequence/e-NCF, optional metadata, XML, signatures, certificates, timestamps, and `TrackId` are excluded from V1.

## Consequences

- V1 serialization and fingerprints are deterministic across equivalent accepted requests.
- This policy is independent from fiscal, XML, signature, certificate, and transport rules.
- Any material change to this representation, normalization, hashing input, or idempotency semantics requires V2; V1 remains unchanged.
