# Official DGII e-CF resources

This directory is the project's provenance-controlled snapshot of the current first-party DGII e-CF documents and schemas verified on 2026-07-26. These files are implementation inputs: current official DGII documents override the recovered roadmap, recovered notes, and any derived assumptions.

## Status

| Check | Result |
|---|---|
| Source | DGII documentation library and direct `dgii.gov.do` downloads only |
| PDFs | 11 logical files; 10 are vendored and one valid 13-page guide is external |
| XSDs | 15 vendored files; all are well-formed XML with an `xs:schema` root |
| Storage | 25 vendored artifacts and one provenance-locked external artifact |
| Integrity | All 26 logical artifacts have byte sizes and lowercase SHA-256 hashes in `manifest.json` |
| Excluded | The executable App Firma Digital ZIP |

The manifest is the verification index for this snapshot. The downloaded files must not be reformatted, normalized, or edited.

## Layout

- `pdfs/`: ten vendored PDFs and the ignored local path for the optional external contingency guide.
- `xsd/`: the ten e-CF schemas plus ACECF, ARECF, RFCE, ANECF, and Semilla schemas.
- `manifest.json`: deterministic schema version 3 source, response, byte-size, SHA-256, and `vendored` or `external` storage metadata for every logical artifact.

## External contingency guide

`pdfs/instructivo-contingencia-fe.pdf` is a valid 13-page official PDF. It is intentionally external rather than vendored, and its exact local path is Git-ignored. A clean clone does not require the file to exist.

To reacquire it:

1. Open the official DGII documentation landing page: `https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/documentacionSobreE-CF.aspx`.
2. Locate "Instructivo de Contingencia de FE" and follow its current DGII download link.
3. Require HTTP `200` and an `application/pdf` content type.
4. Save the unmodified response bytes at the ignored local path.
5. Verify 4,607,632 bytes and SHA-256 `46a41222c1723b75012c1565cae919119dafd69438d5021c8d81f65be16bf708` before use.

The external storage choice does not indicate corruption and does not weaken provenance. The manifest retains the official URL, response metadata, expected bytes, hash, and high-confidence assessment.

## Acquisition

The files were fetched from the direct URLs exposed by the official landing page:

`https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/documentacionSobreE-CF.aspx`

Acquisition followed these controls:

1. Send `Mozilla/5.0` as the User-Agent and the landing page as the Referer.
2. Follow redirects, but reject a final host outside `dgii.gov.do` or its subdomains.
3. Require HTTP `200` and the expected `application/pdf` or `text/xml` content type.
4. Preserve response bytes exactly.
5. Validate file structure and verify the saved-file SHA-256 after writing.

DGII's edge rejects some otherwise normal clients. A failed unauthenticated request is not evidence that a source URL is stale.

## Refresh Rules

1. Start from the official landing page, not a search result, mirror, or recovered direct URL.
2. Compare the published title, version or modified date, direct URL, byte size, and SHA-256 with `manifest.json`.
3. Download candidate replacements to a temporary location and repeat all host, status, type, structure, and hash checks.
4. Review source drift before replacing any artifact. Refresh the affected files and manifest together.
5. Preserve old evidence in version control history; never silently normalize or hand-edit an official file.
6. Stop the refresh if any expected artifact is missing, redirected off DGII, or fails validation.
7. Keep the contingency guide external unless the repository storage policy is explicitly changed.

## Disputed Rules

| Rule | Current evidence |
|---|---|
| Security code | Partially confirmed. DGII ties a six-character value to `SignatureValue`, but the official wording does not unambiguously specify raw Base64 substring, decoding, or re-hashing. Keep implementation blocked until a certification fixture or written DGII clarification resolves the operation. |
| Tolerance | Confirmed by Informe Tecnico e-CF v1.0: absolute `+/- 1.00` amount unit per detail line, with global tolerance equal to the number of detail lines. It is not a one-cent tolerance. |
| e-NCF character class | The assigned business format is uppercase `E` plus 12 digits: `^E[0-9]{12}$`. The e-CF XSDs only enforce the broader `[a-z0-9A-Z]{13}`, so schema validation alone is insufficient. |

When these resources conflict with recovered notes, use the current official resource and document the conflict rather than preserving the recovered behavior.
