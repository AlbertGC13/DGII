# W3C XMLDSig Schema Snapshot

This directory contains the byte-preserved W3C XMLDSig schema needed as an external standards dependency. It is separate from the authoritative DGII snapshot: DGII documents remain the source for fiscal and certification rules.

## Snapshot

| Check | Value |
|---|---|
| Authority | W3C |
| Source | `https://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd` |
| Retrieved | `2026-08-01T13:27:05Z` |
| Response | HTTP 200, `application/xml` |
| Revision | 1.2, dated 2013-04-16 |
| Namespace | `http://www.w3.org/2000/09/xmldsig#` |
| Bytes | 10,292 |
| SHA-256 | `d102ad3df7664c307e0c2c776ba4a90513b1969974d8a940bae1a77f9f21e15d` |

`manifest.json` is schema version 3 and is checked by the configured authority-root integrity verifier. Attribution and license terms are in [NOTICE](NOTICE.md).

## Immutable Refresh

1. Download only from the source URL recorded in `manifest.json`.
2. Require a successful W3C response and record the actual acquisition timestamp and response metadata.
3. Preserve the response bytes exactly. Do not reformat, normalize line endings, or edit the XSD.
4. Verify the candidate byte size and SHA-256 before replacing the snapshot, then update the asset and manifest in the same review.
5. Keep previous evidence in version control; never silently replace a changed source.

The schema declares an external W3C XML Schema DTD. S2 verifies bytes only: it does not parse the schema or vendor that DTD. Any future offline XML validation must disable network access and external DTD/entity resolution.
