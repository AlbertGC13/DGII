import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const projectDirectory = resolve(fileURLToPath(new URL("../", import.meta.url)));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "dgii-recovery-package-consumer-"));
const packDirectory = join(temporaryDirectory, "pack");
const consumerDirectory = join(temporaryDirectory, "consumer");
const staleOutputName = "synthetic-stale-output-issue-25.js";
const staleOutputPath = join(projectDirectory, "dist", staleOutputName);

function run(command, arguments_, cwd) {
  if (process.platform === "win32" && command === "pnpm") {
    const commandLine = `pnpm ${arguments_
      .map((argument) => `"${argument.replaceAll('"', '\\"')}"`)
      .join(" ")}`;
    execSync(commandLine, { cwd, stdio: "inherit" });
    return;
  }

  execFileSync(command, arguments_, { cwd, stdio: "inherit" });
}

async function tarballContains(tarball, expectedPath) {
  const archive = gunzipSync(await readFile(tarball));
  for (let offset = 0; offset < archive.length; offset += 512) {
    const entryName = archive.subarray(offset, offset + 100).toString("utf8").split(String.fromCharCode(0))[0];
    if (!entryName) {
      return false;
    }
    if (entryName === `package/${expectedPath}`) {
      return true;
    }
    const sizeText = archive.subarray(offset + 124, offset + 136).toString("utf8").split(String.fromCharCode(0))[0].trim();
    const size = Number.parseInt(sizeText, 8);
    offset += Math.ceil((Number.isNaN(size) ? 0 : size) / 512) * 512;
  }
  return false;
}

try {
  await mkdir(packDirectory, { recursive: true });
  await mkdir(consumerDirectory, { recursive: true });
  await mkdir(join(projectDirectory, "dist"), { recursive: true });
  await writeFile(staleOutputPath, "export const stale = true;\n");
  run("pnpm", ["build"], projectDirectory);
  if (existsSync(staleOutputPath)) {
    throw new Error("Build did not remove the synthetic stale output.");
  }
  run("pnpm", ["pack", "--pack-destination", packDirectory], projectDirectory);

  const packedFiles = await readdir(packDirectory);
  if (packedFiles.length !== 1 || !packedFiles[0].endsWith(".tgz")) {
    throw new Error("Expected pnpm pack to produce exactly one tarball.");
  }

  const tarball = join(packDirectory, packedFiles[0]);
  if (await tarballContains(tarball, `dist/${staleOutputName}`)) {
    throw new Error("Packed tarball contains the synthetic stale output.");
  }
  if (await tarballContains(tarball, "dist/modules/builder/domain/index.js")) {
    throw new Error("Packed tarball contains the removed builder domain barrel output.");
  }
  for (const excludedPath of [
    "test/fixtures/certificates/synthetic-test-certificate.p12",
    "scripts/generate-synthetic-pkcs12-fixture.mjs",
  ]) {
    if (await tarballContains(tarball, excludedPath)) {
      throw new Error(`Packed tarball contains excluded synthetic fixture material: ${excludedPath}`);
    }
  }
  await writeFile(
    join(consumerDirectory, "package.json"),
    JSON.stringify({ name: "package-consumer-smoke", private: true, type: "module" }),
  );
  await writeFile(
    join(consumerDirectory, "smoke.mjs"),
    `import {
  addDecimals,
  allocateProportionalAmountHalfUp,
  createEcf31CoreDraft,
  isEcf31CoreDraft,
   createEcf31DetallesItemsEvidence,
   isEcf31DetallesItemsEvidence,
    createEcf31ItemCodeMetadataEvidence,
    isEcf31ItemCodeMetadataEvidence,
     createEcf31ItemUnitMetadataEvidence,
     isEcf31ItemUnitMetadataEvidence,
     createEcf31SubquantityMetadataEvidence,
      isEcf31SubquantityMetadataEvidence,
      createEcf31AlcoholReferencePriceEvidence,
      isEcf31AlcoholReferencePriceEvidence,
      createEcf31RetentionMetadataEvidence,
      isEcf31RetentionMetadataEvidence,
    parseEcf31UnitOfMeasureCode,
    formatEcf31UnitOfMeasureCode,
  createEcf31PersistableDraftEvidence,
  isEcf31PersistableDraftEvidence,
   createEcf31CoreHeader,
   createEcf31IdDocIssuanceEvidence,
   ECF31_IDDOC_ISSUANCE_EVIDENCE_POLICY_ID,
  createEcf31HeaderTotalsEvidence,
  formatDecimal,
  formatEcf31ENcf,
  parseENcf,
  parseNonnegativeAmount,
   parseNonnegativeSubquantity,
   parseEcf31AlcoholDegrees,
  parseTaxpayerIdentifier,
  parseLineSequence,
  captureLineCalculationEvidence,
  createEcf31CoreLine,
  createEcf31CoreLineCollection,
   createEcf31LineAmountEvidence,
   isEcf31LineAmountEvidence,
   createEcf31LineSubadjustmentEvidence,
   isEcf31LineSubadjustmentEvidence,
  createEcf31MontoItemQuantizationEvidence,
  isEcf31MontoItemQuantizationEvidence,
   createEcf31ItbisPriceInclusionEvidence,
   isEcf31ItbisPriceInclusionEvidence,
   createEcf31PostGlobalAdjustmentTaxableBaseEvidence,
   isEcf31PostGlobalAdjustmentTaxableBaseEvidence,
    createEcf31PostGlobalAdjustmentExemptAmountEvidence,
    isEcf31PostGlobalAdjustmentExemptAmountEvidence,
    createEcf31AdditionalTaxClassificationEvidence,
    isEcf31AdditionalTaxClassificationEvidence,
    createEcf31TotalItbisEvidence,
    isEcf31TotalItbisEvidence,
    createEcf31DerivedHeaderTotalsEvidence,
    isEcf31DerivedHeaderTotalsEvidence,
  createEcf31MontoItemToleranceGateEvidence,
  isEcf31MontoItemToleranceGateEvidence,
  createEcf31GlobalAdjustmentInitialEvidence,
  isEcf31GlobalAdjustmentInitialEvidence,
  createEcf31GlobalAdjustmentReconciliationEvidence,
  isEcf31GlobalAdjustmentReconciliationEvidence,
  isEcf31HeaderTotalsEvidence,
   isEcf31CoreLine,
   isEcf31IdDocIssuanceEvidence,
  parseNonnegativeQuantity,
  parsePositiveAmount,
  parsePositivePercentage,
  parseUnitPrice,
  revalidateNonnegativeSubquantity,
  restoreEcf31CoreLine,
  serializeEcf31CoreLine,
  restoreEcf31LineAdjustment,
  serializeEcf31LineAdjustment,
  isEcf31LineAdjustmentEvidence,
  restoreEcf31HeaderTotals,
  serializeEcf31HeaderTotals,
  restoreEcf31PersistableDraftEvidence,
  serializeEcf31PersistableDraftEvidence,
  saveEcf31DraftEvidence,
   findEcf31DraftEvidence,
   allocateFiscalSequence,
   allocateCanonicalIssuance,
   canonicalizeIssuanceCommand,
   fingerprintCanonicalIssuanceCommand,
    isENcf,
   loadInMemoryPkcs12,
   getAuthenticatedCertificateMetadata,
   getAuthenticatedCertificateKeyInfoContent,
   signWithAuthenticatedCertificate,
} from "dgii-recovery";

const eNcf = parseENcf("E310000000001");
const allocatedENcf = formatEcf31ENcf(1n);
if (typeof saveEcf31DraftEvidence !== "function" || typeof findEcf31DraftEvidence !== "function") {
  throw new Error("The packaged root export did not expose e-CF 31 draft persistence.");
}
if (typeof loadInMemoryPkcs12 !== "function" || typeof getAuthenticatedCertificateMetadata !== "function"
    || typeof getAuthenticatedCertificateKeyInfoContent !== "function" || typeof signWithAuthenticatedCertificate !== "function") {
  throw new Error("The packaged root export did not expose the in-memory PKCS#12 boundary.");
}
if (!allocatedENcf.ok || allocatedENcf.value.value !== "E310000000001" || allocatedENcf.value.type !== "31"
  || allocatedENcf.value.sequence !== "0000000001") {
  throw new Error("The packaged root export did not format the synthetic allocated e-CF 31 sequence.");
}
if (!eNcf.ok || eNcf.value.type !== "31" || eNcf.value.sequence !== "0000000001") {
  throw new Error("The packaged root export did not parse the synthetic e-NCF.");
}

const issuer = parseTaxpayerIdentifier("000000000");
const buyer = parseTaxpayerIdentifier("00000000000");
const header = createEcf31CoreHeader({
  eNcf: eNcf.value,
  issuer: {
    taxpayerIdentifier: issuer.ok ? issuer.value : null,
    legalName: "Synthetic issuer",
    address: "Synthetic address",
  },
  buyer: {
    taxpayerIdentifier: buyer.ok ? buyer.value : null,
    legalName: "Synthetic buyer",
  },
  issueDate: "01-12-2026",
  incomeType: "01",
  paymentType: "1",
});
if (!header.ok) {
  throw new Error("The packaged root export did not create the synthetic e-CF 31 header.");
}
const idDocIssuance = createEcf31IdDocIssuanceEvidence({
  header: header.value,
  sequenceExpirationDate: "31-12-2026",
});
if (!idDocIssuance.ok || !isEcf31IdDocIssuanceEvidence(idDocIssuance.value)
  || idDocIssuance.value.sequenceExpirationDate !== "31-12-2026"
  || ECF31_IDDOC_ISSUANCE_EVIDENCE_POLICY_ID !== "ecf31-iddoc-issuance-evidence-v1") {
  throw new Error("The packaged root export did not create genuine IdDoc issuance evidence.");
}

const left = parseNonnegativeAmount("12.30");
const right = parseNonnegativeAmount("0.50");
if (!left.ok || !right.ok || formatDecimal(addDecimals(left.value, right.value)) !== "12.8") {
  throw new Error("The packaged root export did not perform exact-decimal addition.");
}

const canonicalCommand = canonicalizeIssuanceCommand({
  issuer: { tenantId: "synthetic-package-scope", rnc: "000000000" }, ecfType: "31", requestedOn: "2030-06-15",
  buyerIdentity: {}, declaredTotals: { montoTotal: "15", totalItbis: "2.25", montoGravadoTotal: "12.75", montoExento: "0" },
  items: [{ numeroLinea: "1", nombreItem: "Synthetic item", indicadorFacturacion: "1", indicadorBienoServicio: "1",
    cantidadItem: "1.5", precioUnitarioItem: "10", montoItem: "15" }],
});
const canonicalFingerprint = canonicalCommand.ok ? fingerprintCanonicalIssuanceCommand(canonicalCommand.value) : canonicalCommand;
if (!canonicalCommand.ok || !canonicalFingerprint.ok
  || canonicalFingerprint.value !== "1d948f03ac332999b2ab4a05159bd275c80962ee7f932679a76888a1a21d0ebf") {
  throw new Error("The packaged root export did not create the V1 canonical issuance fingerprint.");
}
const proportionalAmount = allocateProportionalAmountHalfUp(
  parseNonnegativeAmount("1").value,
  parseNonnegativeAmount("1").value,
  parseNonnegativeAmount("8").value,
);
if (!proportionalAmount.ok || formatDecimal(proportionalAmount.value) !== "0.13") {
  throw new Error("The packaged root export did not allocate a proportional amount exactly.");
}

const percentage = parsePositivePercentage("999.99");
if (!percentage.ok || formatDecimal(percentage.value) !== "999.99") {
  throw new Error("The packaged root export did not parse an exact positive percentage.");
}

const subquantity = parseNonnegativeSubquantity("9999999999999999.999");
if (!subquantity.ok || formatDecimal(subquantity.value) !== "9999999999999999.999"
  || !revalidateNonnegativeSubquantity(subquantity.value).ok) {
  throw new Error("The packaged root export did not parse and revalidate an exact nonnegative subquantity.");
}

const headerTotals = createEcf31HeaderTotalsEvidence({
  montoGravadoI1: left.value,
  montoExento: right.value,
  totalItbis1: parseNonnegativeAmount("2.21").value,
});
if (!headerTotals.ok || !isEcf31HeaderTotalsEvidence(headerTotals.value)
  || formatDecimal(headerTotals.value.montoGravadoTotal) !== "12.3"
  || formatDecimal(headerTotals.value.montoTotal) !== "15.01") {
  throw new Error("The packaged root export did not compose e-CF 31 header totals exactly.");
}
const headerTotalsSnapshot = serializeEcf31HeaderTotals(headerTotals.value);
const restoredHeaderTotals = headerTotalsSnapshot.ok ? restoreEcf31HeaderTotals(headerTotalsSnapshot.value) : headerTotalsSnapshot;
if (!headerTotalsSnapshot.ok || !restoredHeaderTotals.ok || !isEcf31HeaderTotalsEvidence(restoredHeaderTotals.value)
  || formatDecimal(restoredHeaderTotals.value.montoTotal) !== formatDecimal(headerTotals.value.montoTotal)) {
  throw new Error("The packaged root export did not round-trip e-CF 31 header totals evidence.");
}

const lineSequence = parseLineSequence("1");
if (!lineSequence.ok) {
  throw new Error("The packaged root export did not expose line sequence parsing.");
}

const quantity = parseNonnegativeQuantity("1.5");
const unitPrice = parseUnitPrice("2.505");
const declaredAmount = parseNonnegativeAmount("3.75");
const evidence = captureLineCalculationEvidence({
  sequence: lineSequence.value,
  quantity: quantity.ok ? quantity.value : null,
  unitPrice: unitPrice.ok ? unitPrice.value : null,
  declaredAmount: declaredAmount.ok ? declaredAmount.value : null,
});
if (!evidence.ok) {
  throw new Error("The packaged root export did not capture synthetic line evidence.");
}
const coreLine = createEcf31CoreLine({
  evidence: evidence.value,
  itemName: "Synthetic item",
  billingIndicator: 1,
  goodOrServiceIndicator: 1,
});
const coreLines = coreLine.ok ? createEcf31CoreLineCollection([coreLine.value]) : coreLine;
if (!coreLine.ok || !isEcf31CoreLine(coreLine.value) || !coreLines.ok || coreLines.value.length !== 1) {
  throw new Error("The packaged root export did not create synthetic e-CF 31 core lines.");
}
const coreLineSnapshot = serializeEcf31CoreLine(coreLine.value);
const restoredCoreLine = coreLineSnapshot.ok ? restoreEcf31CoreLine(coreLineSnapshot.value) : coreLineSnapshot;
const restoredSnapshot = restoredCoreLine.ok ? serializeEcf31CoreLine(restoredCoreLine.value) : restoredCoreLine;
if (!coreLineSnapshot.ok || !restoredCoreLine.ok || !isEcf31CoreLine(restoredCoreLine.value)
  || !restoredSnapshot.ok || restoredSnapshot.value.delta !== "-0.0075") {
  throw new Error("The packaged root export did not round-trip synthetic e-CF 31 core line snapshots.");
}
const lineAmount = createEcf31LineAmountEvidence({
  coreLine: coreLine.value,
  discountAmount: parseNonnegativeAmount("0").value,
  surchargeAmount: parseNonnegativeAmount("0").value,
});
if (!lineAmount.ok || !isEcf31LineAmountEvidence(lineAmount.value)) {
  throw new Error("The packaged root export did not create synthetic line amount evidence.");
}
const montoItem = createEcf31MontoItemQuantizationEvidence(lineAmount.value);
if (!montoItem.ok || !isEcf31MontoItemQuantizationEvidence(montoItem.value)
  || formatDecimal(montoItem.value.adjustedAmount) !== "3.7575"
  || formatDecimal(montoItem.value.quantizedAmount) !== "3.76") {
  throw new Error("The packed root export did not quantize final MontoItem evidence exactly.");
}
const montoItemTolerance = createEcf31MontoItemToleranceGateEvidence({
  entries: [{ quantization: montoItem.value, declaredAmount: parseNonnegativeAmount("2.76").value }],
});
if (!montoItemTolerance.ok || !isEcf31MontoItemToleranceGateEvidence(montoItemTolerance.value)
  || formatDecimal(montoItemTolerance.value.entries[0].absoluteDelta) !== "1"
  || formatDecimal(montoItemTolerance.value.maxGlobalTolerance) !== "1" || montoItemTolerance.value.policyId !== "ecf31-monto-item-tolerance-v1") {
  throw new Error("The packed root export did not validate genuine MontoItem tolerance evidence at the boundary.");
}
const globalInitial = createEcf31GlobalAdjustmentInitialEvidence({
  globalAmount: parsePositiveAmount("0.01").value, lines: [montoItem.value],
});
if (!globalInitial.ok || !isEcf31GlobalAdjustmentInitialEvidence(globalInitial.value)
  || formatDecimal(globalInitial.value.entries[0].initialAllocation) !== "0.01"
  || formatDecimal(globalInitial.value.signedResidue) !== "0"
  || globalInitial.value.policyId !== "ecf31-proportional-global-adjustment-initial-v1") {
  throw new Error("The packed root export did not create genuine initial global adjustment evidence exactly.");
}
const globalReconciliation = createEcf31GlobalAdjustmentReconciliationEvidence({
  kind: "discount", initialEvidence: globalInitial.value,
});
if (!globalReconciliation.ok || !isEcf31GlobalAdjustmentReconciliationEvidence(globalReconciliation.value)
  || formatDecimal(globalReconciliation.value.reconciledSum) !== "0.01"
  || globalReconciliation.value.reconciledSum !== globalInitial.value.globalAmount
  || globalReconciliation.value.policyId !== "ecf31-global-adjustment-reconciliation-v1") {
  throw new Error("The packed root export did not reconcile genuine global adjustment evidence exactly.");
}
const lineAdjustmentSnapshot = serializeEcf31LineAdjustment({ lineAmount: lineAmount.value, quantization: montoItem.value });
const restoredLineAdjustment = lineAdjustmentSnapshot.ok ? restoreEcf31LineAdjustment(lineAdjustmentSnapshot.value) : lineAdjustmentSnapshot;
if (!lineAdjustmentSnapshot.ok || !restoredLineAdjustment.ok || !isEcf31LineAdjustmentEvidence(restoredLineAdjustment.value)
  || restoredLineAdjustment.value.quantization.sourceEvidence !== restoredLineAdjustment.value.lineAmount) {
  throw new Error("The packed root export did not round-trip synthetic line adjustment evidence.");
}
const draft = createEcf31CoreDraft({ header: header.value, lineAmounts: [lineAmount.value] });
if (!draft.ok || !isEcf31CoreDraft(draft.value) || draft.value.header !== header.value) {
  throw new Error("The packaged root export did not compose a synthetic incomplete e-CF 31 core draft.");
}
const lineSubadjustments = createEcf31LineSubadjustmentEvidence({
  draft: draft.value, entries: [{ source: lineAmount.value, discounts: [], surcharges: [] }],
});
if (!lineSubadjustments.ok || !isEcf31LineSubadjustmentEvidence(lineSubadjustments.value)
  || lineSubadjustments.value.entries[0].source !== lineAmount.value) {
  throw new Error("The packaged root export did not create genuine line subadjustment evidence.");
}
const additionalTaxClassification = createEcf31AdditionalTaxClassificationEvidence({
  draft: draft.value, entries: [{ source: lineAmount.value, codes: ["005"] }],
});
if (!additionalTaxClassification.ok || !isEcf31AdditionalTaxClassificationEvidence(additionalTaxClassification.value)
  || !additionalTaxClassification.value.qualifyingIscAbsent) {
  throw new Error("The packaged root export did not create e-CF 31 additional-tax classification evidence.");
}
const detallesItems = createEcf31DetallesItemsEvidence({
  draft: draft.value, additionalTaxClassificationEvidence: additionalTaxClassification.value,
});
if (!detallesItems.ok || !isEcf31DetallesItemsEvidence(detallesItems.value)
  || detallesItems.value.entries[0].lineAmount !== lineAmount.value
  || detallesItems.value.entries[0].additionalTaxCodes[0] !== "005") {
  throw new Error("The packaged root export did not compose genuine e-CF 31 DetallesItems evidence.");
}
const itemCodeMetadata = createEcf31ItemCodeMetadataEvidence({
  draft: draft.value, entries: [{ source: lineAmount.value, codes: [{ type: "EAN", value: "0123" }] }],
});
if (!itemCodeMetadata.ok || !isEcf31ItemCodeMetadataEvidence(itemCodeMetadata.value)
  || itemCodeMetadata.value.entries[0].codes[0].value !== "0123") {
  throw new Error("The packaged root export did not create genuine e-CF 31 item-code metadata evidence.");
}
const itemUnit = parseEcf31UnitOfMeasureCode("18");
const itemUnitMetadata = itemUnit.ok ? createEcf31ItemUnitMetadataEvidence({
  draft: draft.value, entries: [{ source: lineAmount.value, unit: itemUnit.value }],
}) : itemUnit;
if (!itemUnitMetadata.ok || !isEcf31ItemUnitMetadataEvidence(itemUnitMetadata.value)
  || formatEcf31UnitOfMeasureCode(itemUnitMetadata.value.entries[0].unit) !== "18") {
  throw new Error("The packaged root export did not create e-CF 31 item-unit metadata evidence.");
}
const subquantityMetadata = createEcf31SubquantityMetadataEvidence({
  draft: draft.value,
  entries: [{ source: lineAmount.value, subquantities: [{ subquantity: subquantity.value, unit: itemUnit.value }] }],
});
if (!subquantityMetadata.ok || !isEcf31SubquantityMetadataEvidence(subquantityMetadata.value)
  || formatDecimal(subquantityMetadata.value.entries[0].subquantities[0].subquantity) !== "9999999999999999.999") {
  throw new Error("The packaged root export did not create genuine e-CF 31 subquantity metadata evidence.");
}
const alcoholReferencePrice = createEcf31AlcoholReferencePriceEvidence({
  draft: draft.value,
  classification: createEcf31AdditionalTaxClassificationEvidence({
    draft: draft.value, entries: [{ source: lineAmount.value, codes: ["006", "023"] }],
  }).value,
  entries: [{ source: lineAmount.value, alcoholDegrees: parseEcf31AlcoholDegrees("1").value,
    referenceUnitPrice: parsePositiveAmount("1").value }],
});
if (!alcoholReferencePrice.ok || !isEcf31AlcoholReferencePriceEvidence(alcoholReferencePrice.value)
  || formatDecimal(alcoholReferencePrice.value.entries[0].alcoholDegrees) !== "1") {
  throw new Error("The packaged root export did not create genuine alcohol and reference-price evidence.");
}
const retentionMetadata = createEcf31RetentionMetadataEvidence({
  draft: draft.value,
  entries: [{ source: lineAmount.value, indicator: 1, itbisRetainedAmount: "2.50", isrRetainedAmount: "0" }],
});
if (!retentionMetadata.ok || !isEcf31RetentionMetadataEvidence(retentionMetadata.value)
  || retentionMetadata.value.entries[0].indicator !== 1
  || formatDecimal(retentionMetadata.value.entries[0].itbisRetainedAmount) !== "2.5") {
  throw new Error("The packaged root export did not create genuine e-CF 31 retention metadata evidence.");
}
const priceInclusion = createEcf31ItbisPriceInclusionEvidence({
  draft: draft.value, montoItemQuantizations: [montoItem.value], indicator: 1,
});
if (!priceInclusion.ok || !isEcf31ItbisPriceInclusionEvidence(priceInclusion.value)
  || formatDecimal(priceInclusion.value.buckets[0].preGlobalAdjustmentTaxableBase) !== "3.19") {
  throw new Error("The packaged root export did not create genuine ITBIS price-inclusion evidence exactly.");
}
const postAdjustmentTaxableBases = createEcf31PostGlobalAdjustmentTaxableBaseEvidence({
  priceInclusionEvidence: priceInclusion.value, adjustments: [
    { reconciliationEvidence: globalReconciliation.value, billingIndicator: 1 },
  ],
});
if (!postAdjustmentTaxableBases.ok || !isEcf31PostGlobalAdjustmentTaxableBaseEvidence(postAdjustmentTaxableBases.value)
  || formatDecimal(postAdjustmentTaxableBases.value.buckets[0].taxableBase) !== "3.18") {
  throw new Error("The packaged root export did not derive post-global-adjustment taxable bases exactly.");
}
const totalItbis = createEcf31TotalItbisEvidence({ taxableBaseEvidence: postAdjustmentTaxableBases.value,
  additionalTaxClassificationEvidence: additionalTaxClassification.value });
if (!totalItbis.ok || !isEcf31TotalItbisEvidence(totalItbis.value)
  || formatDecimal(totalItbis.value.totalItbis1) !== "0.57") {
  throw new Error("The packaged root export did not derive TotalITBIS exactly.");
}
const derivedAdditionalTaxClassification = createEcf31AdditionalTaxClassificationEvidence({
  draft: draft.value, entries: [{ source: lineAmount.value, codes: [] }],
});
const derivedTotalItbis = derivedAdditionalTaxClassification.ok
  ? createEcf31TotalItbisEvidence({
    taxableBaseEvidence: postAdjustmentTaxableBases.value,
    additionalTaxClassificationEvidence: derivedAdditionalTaxClassification.value,
  })
  : derivedAdditionalTaxClassification;
const derivedExemptAmount = createEcf31PostGlobalAdjustmentExemptAmountEvidence({
  draft: draft.value, montoItemQuantizations: [montoItem.value], adjustments: [],
});
const derivedHeaderTotals = derivedExemptAmount.ok && derivedTotalItbis.ok
  ? createEcf31DerivedHeaderTotalsEvidence({
    exemptAmountEvidence: derivedExemptAmount.value,
    additionalTaxClassificationEvidence: derivedAdditionalTaxClassification.value,
    taxableBaseEvidence: postAdjustmentTaxableBases.value,
    totalItbisEvidence: derivedTotalItbis.value,
  })
  : derivedTotalItbis;
if (!derivedHeaderTotals.ok || !isEcf31DerivedHeaderTotalsEvidence(derivedHeaderTotals.value)
  || formatDecimal(derivedHeaderTotals.value.headerTotals.montoGravadoI1) !== "3.18"
  || formatDecimal(derivedHeaderTotals.value.headerTotals.totalItbis1) !== "0.57"
  || formatDecimal(derivedHeaderTotals.value.headerTotals.montoTotal) !== "3.75") {
  throw new Error("The packaged root export did not compose genuine derived e-CF 31 header totals exactly.");
}
const exemptCoreLine = createEcf31CoreLine({
  evidence: evidence.value, itemName: "Synthetic exempt item", billingIndicator: 4, goodOrServiceIndicator: 1,
});
const exemptLineAmount = exemptCoreLine.ok ? createEcf31LineAmountEvidence({
  coreLine: exemptCoreLine.value, discountAmount: parseNonnegativeAmount("0").value, surchargeAmount: parseNonnegativeAmount("0").value,
}) : exemptCoreLine;
const exemptMontoItem = exemptLineAmount.ok ? createEcf31MontoItemQuantizationEvidence(exemptLineAmount.value) : exemptLineAmount;
const exemptDraft = exemptLineAmount.ok ? createEcf31CoreDraft({ header: header.value, lineAmounts: [exemptLineAmount.value] }) : exemptLineAmount;
const exemptInitial = exemptMontoItem.ok ? createEcf31GlobalAdjustmentInitialEvidence({
  globalAmount: parsePositiveAmount("0.01").value, lines: [exemptMontoItem.value],
}) : exemptMontoItem;
const exemptReconciliation = exemptInitial.ok ? createEcf31GlobalAdjustmentReconciliationEvidence({
  kind: "discount", initialEvidence: exemptInitial.value,
}) : exemptInitial;
const postAdjustmentExemptAmount = exemptDraft.ok && exemptMontoItem.ok && exemptReconciliation.ok
  ? createEcf31PostGlobalAdjustmentExemptAmountEvidence({ draft: exemptDraft.value, montoItemQuantizations: [exemptMontoItem.value],
    adjustments: [{ reconciliationEvidence: exemptReconciliation.value, billingIndicator: 4 }] })
  : exemptReconciliation;
if (!postAdjustmentExemptAmount.ok || !isEcf31PostGlobalAdjustmentExemptAmountEvidence(postAdjustmentExemptAmount.value)
  || formatDecimal(postAdjustmentExemptAmount.value.montoExento) !== "3.75") {
  throw new Error("The packed root export did not derive genuine post-global-adjustment exempt amount evidence exactly.");
}
const persistableEvidence = createEcf31PersistableDraftEvidence({
  draft: draft.value,
  montoItemQuantizations: [montoItem.value],
  derivedHeaderTotals: derivedHeaderTotals.value,
});
if (!persistableEvidence.ok || !isEcf31PersistableDraftEvidence(persistableEvidence.value)
  || persistableEvidence.value.montoItemQuantizations[0].sourceEvidence !== lineAmount.value) {
  throw new Error("The packaged root export did not compose synthetic persistable e-CF 31 draft evidence.");
}
const persistableSnapshot = serializeEcf31PersistableDraftEvidence(persistableEvidence.value);
const restoredPersistableEvidence = persistableSnapshot.ok
  ? restoreEcf31PersistableDraftEvidence(JSON.parse(JSON.stringify(persistableSnapshot.value)))
  : persistableSnapshot;
if (!persistableSnapshot.ok || !restoredPersistableEvidence.ok
  || !isEcf31PersistableDraftEvidence(restoredPersistableEvidence.value)
  || restoredPersistableEvidence.value.montoItemQuantizations[0].sourceEvidence
    !== restoredPersistableEvidence.value.draft.lineAmounts[0]) {
  throw new Error("The packaged root export did not round-trip synthetic persistable e-CF 31 draft evidence.");
}

const scopeId = "synthetic-package-scope";
const sequenceQueries = [];
const allocation = await allocateFiscalSequence({
  async query(text, values) {
    sequenceQueries.push({ text, values });
    return { rows: [{ outcome: "allocated", allocated_value: "42" }] };
  },
}, { scopeId, ecfType: "E31", idempotencyKey: "synthetic-sequence-key", fingerprint: "synthetic-sequence-fingerprint", requestedOn: "2030-06-15" });
if (allocation.outcome !== "allocated" || allocation.allocatedValue !== 42n || !isENcf(allocation.eNcf)
  || sequenceQueries[0]?.values?.join("|") !== [scopeId, "E31", "synthetic-sequence-key", "synthetic-sequence-fingerprint", "2030-06-15"].join("|")) {
  throw new Error("The packaged root export did not allocate a typed e-CF 31 sequence through the supplied client.");
}
const canonicalAllocation = await allocateCanonicalIssuance({
  async query() { return { rows: [{ outcome: "allocated", allocated_value: "43" }] }; },
}, {
  idempotencyKey: "synthetic-canonical-key",
  command: {
    issuer: { tenantId: scopeId, rnc: "000000000" }, ecfType: "31", requestedOn: "2030-06-15",
    buyerIdentity: {}, declaredTotals: { montoTotal: "15", totalItbis: "2.25", montoGravadoTotal: "12.75", montoExento: "0" },
    items: [{ numeroLinea: "1", nombreItem: "Synthetic item", indicadorFacturacion: "1", indicadorBienoServicio: "1", cantidadItem: "1.5", precioUnitarioItem: "10", montoItem: "15" }],
  },
});
if (canonicalAllocation.outcome !== "allocated" || canonicalAllocation.allocatedValue !== 43n
  || typeof canonicalAllocation.fingerprint !== "string") {
  throw new Error("The packaged root export did not allocate canonical issuance through the supplied client.");
}
const idempotencyKey = "synthetic-package-key";
const fingerprint = "synthetic-package-fingerprint";
const queries = [];
const client = {
  async query(text, values) {
    queries.push({ text, values });
    return queries.length === 1
      ? { rows: [{ outcome: "stored" }] }
      : { rows: [{ snapshot: JSON.parse(JSON.stringify(persistableSnapshot.value)) }] };
  },
};
const savedEvidence = await saveEcf31DraftEvidence(client, {
  scopeId, eNcf: "E310000000001", idempotencyKey, fingerprint, evidence: persistableEvidence.value,
});
const saveQuery = queries[0];
if (savedEvidence.outcome !== "stored" || typeof saveQuery?.text !== "string"
  || !saveQuery.text.includes("store_ecf31_draft_evidence") || !saveQuery.text.includes("$1")
  || !saveQuery.text.includes("$5") || !Array.isArray(saveQuery.values) || saveQuery.values.length !== 5
  || saveQuery.values[0] !== scopeId || saveQuery.values[1] !== "E310000000001"
  || saveQuery.values[2] !== idempotencyKey || saveQuery.values[3] !== fingerprint) {
  throw new Error("The packaged root export did not save e-CF 31 draft evidence through parameterized caller-owned queries.");
}
const foundEvidence = await findEcf31DraftEvidence(client, { scopeId, eNcf: "E310000000001" });
const findQuery = queries[1];
if (foundEvidence.outcome !== "found" || !isEcf31PersistableDraftEvidence(foundEvidence.evidence)
  || foundEvidence.evidence.draft.header.eNcf.sequence !== "0000000001"
  || foundEvidence.evidence.draft.lineAmounts.length !== 1
  || foundEvidence.evidence.montoItemQuantizations.length !== 1
  || foundEvidence.evidence.montoItemQuantizations[0].sourceEvidence !== foundEvidence.evidence.draft.lineAmounts[0]
  || typeof findQuery?.text !== "string" || !findQuery.text.includes("ecf31_draft_evidence_snapshots")
  || !findQuery.text.includes("$1") || !findQuery.text.includes("$2")
  || !Array.isArray(findQuery.values) || findQuery.values.length !== 2
  || findQuery.values[0] !== scopeId || findQuery.values[1] !== "E310000000001") {
  throw new Error("The packaged root export did not restore genuine e-CF 31 draft evidence through parameterized caller-owned queries.");
}
`,
  );
  run(
    "pnpm",
    ["add", "--ignore-scripts", "--lockfile=false", "--offline", tarball],
    consumerDirectory,
  );
  run(process.execPath, [join(consumerDirectory, "smoke.mjs")], consumerDirectory);

  console.log(`Verified ${basename(tarball)} through the published package root export.`);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
