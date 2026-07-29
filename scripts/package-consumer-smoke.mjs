import { execFileSync, execSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(fileURLToPath(new URL("../", import.meta.url)));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "dgii-recovery-package-consumer-"));
const packDirectory = join(temporaryDirectory, "pack");
const consumerDirectory = join(temporaryDirectory, "consumer");

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

try {
  await mkdir(packDirectory, { recursive: true });
  await mkdir(consumerDirectory, { recursive: true });
  run("pnpm", ["pack", "--pack-destination", packDirectory], projectDirectory);

  const packedFiles = await readdir(packDirectory);
  if (packedFiles.length !== 1 || !packedFiles[0].endsWith(".tgz")) {
    throw new Error("Expected pnpm pack to produce exactly one tarball.");
  }

  const tarball = join(packDirectory, packedFiles[0]);
  await writeFile(
    join(consumerDirectory, "package.json"),
    JSON.stringify({ name: "package-consumer-smoke", private: true, type: "module" }),
  );
  await writeFile(
    join(consumerDirectory, "smoke.mjs"),
    `import {
  addDecimals,
  createEcf31CoreHeader,
  formatDecimal,
  parseENcf,
  parseNonnegativeAmount,
  parseTaxpayerIdentifier,
  parseLineSequence,
  captureLineCalculationEvidence,
  createEcf31CoreLine,
  createEcf31CoreLineCollection,
  isEcf31CoreLine,
  parseNonnegativeQuantity,
  parseUnitPrice,
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

const lineSequence = parseLineSequence("1");
if (!lineSequence.ok) {
  throw new Error("The packaged root export did not expose line sequence parsing.");
}

const quantity = parseNonnegativeQuantity("1.5");
const unitPrice = parseUnitPrice("2.5");
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
