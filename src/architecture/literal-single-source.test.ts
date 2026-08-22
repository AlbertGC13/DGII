import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findLiteralProductionSources } from "./literal-single-source.js";

const posApiKeyDigestLabel = "dgii-pos-api-key-v1";
const authoredRoots = ["src", "scripts"] as const;
const roots: string[] = [];

function createFixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "dgii-literal-single-source-"));
  roots.push(root);
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = join(root, relativePath);
    mkdirSync(resolve(filePath, ".."), { recursive: true });
    writeFileSync(filePath, source);
  }
  return root;
}

function restate(): string {
  return `const restated = "${posApiKeyDigestLabel}";`;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("findLiteralProductionSources", () => {
  it("reports every restatement across each searched root and authored language", () => {
    const root = createFixture({
      "src/modules/authorization/parser.ts": restate(),
      "src/modules/authorization/infrastructure/copy.tsx": restate(),
      "scripts/provision-credential.mjs": restate(),
      "scripts/legacy-provision.cjs": restate(),
      "scripts/diagnose.js": restate(),
    });

    expect(findLiteralProductionSources(root, authoredRoots, posApiKeyDigestLabel)).toEqual([
      "scripts/diagnose.js",
      "scripts/legacy-provision.cjs",
      "scripts/provision-credential.mjs",
      "src/modules/authorization/infrastructure/copy.tsx",
      "src/modules/authorization/parser.ts",
    ]);
  });

  it("ignores tests, unsearched roots, non-source files, and sources without the literal", () => {
    const root = createFixture({
      "src/modules/authorization/parser.ts": restate(),
      "src/modules/authorization/parser.test.ts": restate(),
      "src/modules/authorization/parser.integration.test.ts": restate(),
      "src/modules/authorization/notes.json": `{ "label": "${posApiKeyDigestLabel}" }`,
      "src/modules/authorization/unrelated.ts": 'const restated = "unrelated";',
      "scripts/provision.test.mjs": restate(),
      "node_modules/vendor/index.mjs": restate(),
      "dist/parser.js": restate(),
      "docs/notes.ts": restate(),
    });

    expect(findLiteralProductionSources(root, authoredRoots, posApiKeyDigestLabel)).toEqual([
      "src/modules/authorization/parser.ts",
    ]);
  });

  it("keeps the POS API key digest formula in exactly one authored production source", () => {
    expect(findLiteralProductionSources(resolve("."), authoredRoots, posApiKeyDigestLabel)).toEqual([
      "src/modules/backend-authorization/pos-api-key.ts",
    ]);
  });
});
