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

### What the guide establishes

The Febrero 2026 guide defines three separate contingency regimes with separate deadlines. They are not one generic contingency mode and they do not share a 15-day constant.

| Regime | Trigger | Obligations |
|---|---|---|
| `OFFLINE_TRANSMISSION_CONTINGENCY` | Can generate e-CF, cannot transmit ("Falta de conectividad") | Generate and retain the e-CF offline, transmit "en un plazo no mayor de setenta y dos (72) horas" once connectivity returns, and hand the customer a printed representation carrying the mandated legend "e-CF emitido en modalidad de Contingencia, el cual podrá ser consultado para su validez fiscal, a partir de las setenta y dos (72) horas." (p. 5, item 1) |
| `NON_ELECTRONIC_ISSUANCE_CONTINGENCY` | Cannot issue electronically ("Imposibilidad de emitir e-CF") | Issue authorised non-electronic receipts (Serie B, p. 3 "Glosario"); notify DGII through the Oficina Virtual; maximum **15 calendar days** (p. 5, item 2; p. 9, footnote 2); after leaving contingency, 30 **calendar** days to send DGII the replacement e-CF, to DGII only and not to the receiver (p. 12) |
| `DGII_PLATFORM_CONTINGENCY` | DGII-side outage ("Contingencia de la DGII") | Store the e-CF and send once communication is restored; an outage of more than **15 business days** enables the OFV reporting option (p. 12) |

Scope is orthogonal to regime. "Contingencia parcial" affects one or more branches or business units while the rest keeps issuing electronically; "contingencia total" affects the taxpayer's whole operation or all branches (p. 3, "Glosario"), and the OFV entry declaration requires selecting "Total" or "Parcial" (p. 6, Paso 1).

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
| Security code — `OPEN-DGII-01`, exact derivation of `CodigoSeguridad` | **Confirmed:** `CodigoSeguridad` is the first six elements derived from the hash / `SignatureValue` of the e-CF digital signature, stated for the ordinary e-CF QR, for the printed legend below the QR, and for the RFCE (`informe-tecnico-ecf-v1.0.pdf`, Marzo 2026, p. 36; `descripcion-tecnica-servicios-dgii.pdf`, rev. 02-01-2026, p. 21, and p. 28 in the ConsultaEstado output contract; `formato-rfce-v1.0.pdf`, Enero 2020, p. 12, `<CodigoSeguridadeCF>`, ALFANUM, maximum length 6). **Open:** the documents do not unambiguously fix Base64 `SignatureValue` substring versus a further digest, the algorithm of that possible digest, Base64 text versus decoded bytes, the final encoding, or the exact reading of "dígitos" against "caracteres". **Leading hypothesis (inference, not a rule):** the first six characters taken directly from the Base64 `SignatureValue`, supported by the percent-encoding requirement at `descripcion-tecnica-servicios-emisores-electronicos.pdf`, rev. 02-01-2026, p. 5, whose reserved-character table includes `+`, `/` and `=` — characters a hexadecimal digest can never produce. Only the final generation of the value is blocked pending a certification fixture; the timbre URLs, environment selection, parameter order, percent-encoding, QR version 8 and printed-representation construction are documented and buildable now. **Context:** "caracteres" is Enero 2020 wording and "dígitos ... del hash generado en el SignatureValue" is Marzo 2026 / rev. 02-01-2026 wording — a difference between document generations, not a live contradiction. **Asymmetry:** the ordinary e-CF XML has no security-code element (print and QR artifact only); the RFCE transmits `<CodigoSeguridadeCF>`. |
| Tolerance | Confirmed by Informe Tecnico e-CF v1.0: absolute `+/- 1.00` amount unit per detail line, with global tolerance equal to the number of detail lines. It is not a one-cent tolerance. |
| e-NCF character class | The assigned business format is uppercase `E` plus 12 digits: `^E[0-9]{12}$`. The e-CF XSDs only enforce the broader `[a-z0-9A-Z]{13}`, so schema validation alone is insufficient. |

When these resources conflict with recovered notes, use the current official resource and document the conflict rather than preserving the recovered behavior.
