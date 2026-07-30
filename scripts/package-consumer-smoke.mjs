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
  await writeFile(
    join(consumerDirectory, "package.json"),
    JSON.stringify({ name: "package-consumer-smoke", private: true, type: "module" }),
  );
  await writeFile(
    join(consumerDirectory, "smoke.mjs"),
    `import {
  addDecimals,
  createEcf31CoreDraft,
  isEcf31CoreDraft,
  createEcf31PersistableDraftEvidence,
  isEcf31PersistableDraftEvidence,
  createEcf31CoreHeader,
  createEcf31HeaderTotalsEvidence,
  formatDecimal,
  parseENcf,
  parseNonnegativeAmount,
  parseTaxpayerIdentifier,
  parseLineSequence,
  captureLineCalculationEvidence,
  createEcf31CoreLine,
  createEcf31CoreLineCollection,
  createEcf31LineAmountEvidence,
  isEcf31LineAmountEvidence,
  createEcf31MontoItemQuantizationEvidence,
  isEcf31MontoItemQuantizationEvidence,
  isEcf31HeaderTotalsEvidence,
  isEcf31CoreLine,
  parseNonnegativeQuantity,
  parseUnitPrice,
  restoreEcf31CoreLine,
  serializeEcf31CoreLine,
  restoreEcf31LineAdjustment,
  serializeEcf31LineAdjustment,
  isEcf31LineAdjustmentEvidence,
} from "dgii-recovery";

const eNcf = parseENcf("E310000000001");
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

const left = parseNonnegativeAmount("12.30");
const right = parseNonnegativeAmount("0.50");
if (!left.ok || !right.ok || formatDecimal(addDecimals(left.value, right.value)) !== "12.8") {
  throw new Error("The packaged root export did not perform exact-decimal addition.");
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
  billingIndicator: 0,
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
const persistableEvidence = createEcf31PersistableDraftEvidence({
  draft: draft.value,
  montoItemQuantizations: [montoItem.value],
  headerTotals: headerTotals.value,
});
if (!persistableEvidence.ok || !isEcf31PersistableDraftEvidence(persistableEvidence.value)
  || persistableEvidence.value.montoItemQuantizations[0].sourceEvidence !== lineAmount.value) {
  throw new Error("The packaged root export did not compose synthetic persistable e-CF 31 draft evidence.");
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
