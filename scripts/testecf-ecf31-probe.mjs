/**
 * Operator-run TesteCF e-CF 31 probe. It submits once, only to the documented
 * DGII outbound reception route; never reuse the allocated e-NCF.
 * Requires a prior `pnpm build`.
 * Usage: node scripts/testecf-ecf31-probe.mjs <absolute-p12-path> <rnc>
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

import {
  assembleEcf31Xml,
  createDgiiAuthentication,
  createDgiiHttpTransport,
  createDgiiReception,
  createEcf31AdditionalTaxClassificationEvidence,
  createEcf31CoreDraft,
  createEcf31CoreHeader,
  createEcf31CoreLine,
  createEcf31DerivedHeaderTotalsEvidence,
  createEcf31DetallesItemsEvidence,
  createEcf31IdDocIssuanceEvidence,
  createEcf31ItbisPriceInclusionEvidence,
  createEcf31LineAmountEvidence,
  createEcf31MontoItemQuantizationEvidence,
  createEcf31PostGlobalAdjustmentExemptAmountEvidence,
  createEcf31PostGlobalAdjustmentTaxableBaseEvidence,
  createEcf31TotalItbisEvidence,
  captureLineCalculationEvidence,
  loadInMemoryPkcs12,
  parseENcf,
  parseLineSequence,
  parseNonnegativeAmount,
  parseNonnegativeQuantity,
  parseTaxpayerIdentifier,
  parseUnitPrice,
  serializeSignedXmlArtifact,
  signXmlWithAuthenticatedCertificate,
  verifyDgiiXmlSignature,
} from "../dist/index.js";
import { validateOfflineDgiiXml } from "../dist/modules/builder/infrastructure/offline-dgii-xsd-validator.js";
import { createTesteCfEcf31ProbeDiagnostics, redactTesteCfProbeOutput } from "../dist/internal/testecf-ecf31-probe-diagnostics.js";

const AUTH_ROOT = "https://ecf.dgii.gov.do/testecf/autenticacion";
const RECEPTION_ROOT = "https://ecf.dgii.gov.do/testecf/recepcion";
const RECEPTION_PATH = "api/facturaselectronicas";
const certificatePath = process.argv[2];
const rnc = process.argv[3];

if (typeof certificatePath !== "string" || typeof rnc !== "string" || !/^[0-9]{9}$/u.test(rnc) || process.argv.length !== 4) {
  console.error("Usage: node scripts/testecf-ecf31-probe.mjs <absolute-p12-path> <rnc>");
  process.exit(1);
}

function redact(value) { return redactTesteCfProbeOutput(value); }
function log(field, value) { console.log(`[PROBE] ${field}: ${redact(value)}`); }
function fail(code) { console.error(`[PROBE] FAILED: ${code}`); process.exit(1); }

function promptHiddenPassword(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { reject(new Error("TTY_REQUIRED")); return; }
    process.stdout.write(question);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let buffer = "";
    const finish = (value) => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); process.stdout.write("\n"); resolve(value); };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n" || character === "\u0004") { finish(buffer); return; }
        if (character === "\u0003") { stdin.setRawMode(false); stdin.pause(); process.stdout.write("\n"); process.exit(130); }
        if (character === "\u007f" || character === "\b") buffer = buffer.slice(0, -1);
        else buffer += character;
      }
    };
    stdin.on("data", onData);
  });
}

async function prompt(question) {
  if (!process.stdin.isTTY) throw new Error("TTY_REQUIRED");
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await readline.question(question)).trim(); } finally { readline.close(); }
}

function value(result, code) { if (!result?.ok) throw new Error(code); return result.value; }
function datePart(date) { return `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`; }
function signingTimestamp(date) { return `${datePart(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`; }

function syntheticEvidence(eNcf, sequenceExpirationDate) {
  const issuer = value(parseTaxpayerIdentifier(rnc), "INVALID_RNC");
  const buyer = value(parseTaxpayerIdentifier("00000000000"), "INVALID_SYNTHETIC_BUYER");
  const header = value(createEcf31CoreHeader({ eNcf, issuer: { taxpayerIdentifier: issuer, legalName: "TesteCF probe issuer", address: "Synthetic address" }, buyer: { taxpayerIdentifier: buyer, legalName: "Synthetic buyer" }, issueDate: datePart(new Date()), incomeType: "01", paymentType: "1" }), "HEADER_FAILED");
  const calculation = value(captureLineCalculationEvidence({ sequence: value(parseLineSequence("1"), "LINE_SEQUENCE_FAILED"), quantity: value(parseNonnegativeQuantity("1"), "QUANTITY_FAILED"), unitPrice: value(parseUnitPrice("10"), "PRICE_FAILED"), declaredAmount: value(parseNonnegativeAmount("0"), "AMOUNT_FAILED") }), "CALCULATION_FAILED");
  const line = value(createEcf31CoreLine({ evidence: calculation, itemName: "Synthetic TesteCF probe item", billingIndicator: 1, goodOrServiceIndicator: 1 }), "LINE_FAILED");
  const lineAmount = value(createEcf31LineAmountEvidence({ coreLine: line, discountAmount: value(parseNonnegativeAmount("0"), "DISCOUNT_FAILED"), surchargeAmount: value(parseNonnegativeAmount("0"), "SURCHARGE_FAILED") }), "LINE_AMOUNT_FAILED");
  const draft = value(createEcf31CoreDraft({ header, lineAmounts: [lineAmount] }), "DRAFT_FAILED");
  const quantization = value(createEcf31MontoItemQuantizationEvidence(lineAmount), "QUANTIZATION_FAILED");
  const classification = value(createEcf31AdditionalTaxClassificationEvidence({ draft, entries: [{ source: lineAmount, codes: [] }] }), "CLASSIFICATION_FAILED");
  const priceInclusionEvidence = value(createEcf31ItbisPriceInclusionEvidence({ draft, montoItemQuantizations: [quantization], indicator: 0 }), "PRICE_INCLUSION_FAILED");
  const taxableBaseEvidence = value(createEcf31PostGlobalAdjustmentTaxableBaseEvidence({ priceInclusionEvidence, adjustments: [] }), "TAXABLE_BASE_FAILED");
  const totalItbisEvidence = value(createEcf31TotalItbisEvidence({ taxableBaseEvidence, additionalTaxClassificationEvidence: classification }), "TOTAL_ITBIS_FAILED");
  const exemptAmountEvidence = value(createEcf31PostGlobalAdjustmentExemptAmountEvidence({ draft, montoItemQuantizations: [quantization], adjustments: [] }), "EXEMPT_AMOUNT_FAILED");
  return {
    issuanceEvidence: value(createEcf31IdDocIssuanceEvidence({ header, sequenceExpirationDate }), "ISSUANCE_FAILED"),
    draft,
    derivedHeaderTotalsEvidence: value(createEcf31DerivedHeaderTotalsEvidence({ exemptAmountEvidence, additionalTaxClassificationEvidence: classification, taxableBaseEvidence, totalItbisEvidence }), "TOTALS_FAILED"),
    priceInclusionEvidence,
    detallesItemsEvidence: value(createEcf31DetallesItemsEvidence({ draft, additionalTaxClassificationEvidence: classification }), "DETAILS_FAILED"),
  };
}

async function main() {
  const eNcf = value(parseENcf(await prompt("Allocated e-NCF: ")), "INVALID_ENCF");
  const sequenceExpirationDate = await prompt("Allocated sequence expiration (dd-MM-yyyy): ");
  const password = await promptHiddenPassword("Certificate password: ");
  const certificate = loadInMemoryPkcs12({ bytes: readFileSync(certificatePath), password });
  if (!certificate.ok) fail("CERTIFICATE_LOAD_FAILED");

  const assembled = assembleEcf31Xml({ ...syntheticEvidence(eNcf, sequenceExpirationDate), fechaHoraFirma: signingTimestamp(new Date()) });
  if (!assembled.ok) fail("ASSEMBLY_FAILED");
  const signed = signXmlWithAuthenticatedCertificate({ xml: assembled.value, certificateMaterial: certificate.value });
  if (!signed.ok) fail("SIGNING_FAILED");
  const serialized = serializeSignedXmlArtifact(signed.value);
  if (!serialized.ok) fail("SERIALIZATION_FAILED");
  const offline = await validateOfflineDgiiXml(serialized.value, "ecf-31-v1.0");
  if (!offline.ok || !offline.value.valid) fail("OFFLINE_XSD_VALIDATION_FAILED");
  const verified = verifyDgiiXmlSignature({ xml: serialized.value });
  if (!verified.ok) fail("XMLDSIG_VERIFICATION_FAILED");

  const authenticationTransport = value(createDgiiHttpTransport({ environment: "TesteCF", roots: { ecf: AUTH_ROOT, rfce: AUTH_ROOT }, executor: fetch }), "AUTH_TRANSPORT_FAILED");
  const receptionTransport = value(createDgiiHttpTransport({ environment: "TesteCF", roots: { ecf: RECEPTION_ROOT, rfce: RECEPTION_ROOT }, executor: fetch }), "RECEPTION_TRANSPORT_FAILED");
  const diagnostics = createTesteCfEcf31ProbeDiagnostics();
  const authentication = value(createDgiiAuthentication({
    environment: "TesteCF", authenticationRoot: AUTH_ROOT, certificateMaterial: certificate.value, clock: () => new Date(),
    transport: Object.freeze({
      get: authenticationTransport.get,
      postMultipart: async (request, signal) => {
        if (request?.path === "api/autenticacion/validarsemilla") return authenticationTransport.postMultipart(request, signal);
        try {
          const response = await receptionTransport.postMultipart(request, signal);
          diagnostics.observeReceptionTransport(response);
          return response;
        } catch (error) {
          diagnostics.observeReceptionTransport(undefined);
          throw error;
        }
      },
    }),
  }), "AUTHENTICATION_CONFIGURATION_FAILED");
  const reception = value(createDgiiReception({ authentication: Object.freeze({
    authorize: async (signal) => {
      try {
        const authorization = await authentication.authorize(signal);
        diagnostics.observeAuthorization(authorization);
        return authorization;
      } catch (error) {
        diagnostics.observeAuthorization(undefined);
        throw error;
      }
    },
    postMultipart: authentication.postMultipart,
  }) }), "RECEPTION_CONFIGURATION_FAILED");
  log("ENDPOINT_ROOT", RECEPTION_ROOT);
  log("ENDPOINT_PATH", RECEPTION_PATH);
  const submitted = await reception.submit(verified.value);
  if (!submitted.ok) {
    for (const field of diagnostics.fields()) log(field.field, field.value);
    fail("SUBMISSION_FAILED");
  }
  log("TRACK_ID", submitted.value.trackId);
  log("RESULT", "TRACK_ID_CAPTURED");
}

main().catch(() => fail("SAFE_PROBE_FAILURE"));
