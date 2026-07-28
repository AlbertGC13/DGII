import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { findModuleBoundaryViolations } from "./module-boundaries.js";

const fixtureRoots: string[] = [];

function createFixture(files: Readonly<Record<string, string>>): string {
  const rootDirectory = mkdtempSync(join(tmpdir(), "dgii-module-boundaries-"));
  fixtureRoots.push(rootDirectory);

  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = join(rootDirectory, "src", relativePath);
    mkdirSync(resolve(filePath, ".."), { recursive: true });
    writeFileSync(filePath, source);
  }

  return join(rootDirectory, "src");
}

afterEach(() => {
  for (const rootDirectory of fixtureRoots.splice(0)) {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});

describe("findModuleBoundaryViolations", () => {
  it("allows same-module, shared, external, and public cross-module imports", () => {
    const sourceDirectory = createFixture({
      "modules/catalog/index.ts": 'export const catalog = "catalog";',
      "modules/orders/domain/order.ts": 'export const order = "order";',
      "modules/orders/service.ts": [
        'import { catalog } from "../catalog/index.js";',
        'import { order } from "./domain/order.js";',
        'import { formatDate } from "../../shared/date.js";',
        'import { readFile } from "node:fs";',
        "void catalog; void order; void formatDate; void readFile;",
      ].join("\n"),
      "shared/date.ts": 'export const formatDate = "date";',
    });

    expect(findModuleBoundaryViolations(sourceDirectory)).toEqual([]);
  });

  it("rejects a deep import into another module", () => {
    const sourceDirectory = createFixture({
      "modules/catalog/index.ts": 'export const catalog = "catalog";',
      "modules/catalog/domain/catalog-item.ts": 'export const item = "item";',
      "modules/orders/service.ts": 'import "../catalog/domain/catalog-item.js";',
    });

    expect(findModuleBoundaryViolations(sourceDirectory)).toContainEqual(
      expect.objectContaining({ kind: "deep-module-import" }),
    );
  });

  it("rejects shared imports from a business module", () => {
    const sourceDirectory = createFixture({
      "modules/catalog/index.ts": 'export const catalog = "catalog";',
      "shared/date.ts": 'import "../modules/catalog/index.js";',
    });

    expect(findModuleBoundaryViolations(sourceDirectory)).toContainEqual(
      expect.objectContaining({ kind: "shared-to-module-import" }),
    );
  });

  it("rejects cycles between business modules", () => {
    const sourceDirectory = createFixture({
      "modules/catalog/index.ts": 'import "../orders/index.js";',
      "modules/orders/index.ts": 'import "../catalog/index.js";',
    });

    expect(findModuleBoundaryViolations(sourceDirectory)).toContainEqual(
      expect.objectContaining({ kind: "module-cycle", modules: ["catalog", "orders", "catalog"] }),
    );
  });

  it("resolves extensionless re-exports, TSX files, and directory indexes", () => {
    const sourceDirectory = createFixture({
      "modules/catalog/index.ts": 'export const catalog = "catalog";',
      "modules/catalog/view.tsx": 'export const catalogView = "catalog-view";',
      "modules/catalog/feature/index.ts": 'export const feature = "feature";',
      "notes.json": "{}",
      "modules/orders/reexports.ts": [
        'export { catalog } from "../catalog";',
        'export { catalogView } from "../catalog/view";',
        'import { feature } from "../catalog/feature";',
        'import "../catalog/missing";',
        'const localValue = "local";',
        "export { localValue };",
      ].join("\n"),
    });

    expect(
      findModuleBoundaryViolations(sourceDirectory)
        .filter((violation) => violation.kind === "deep-module-import")
        .map((violation) => violation.moduleSpecifier)
        .sort(),
    ).toEqual(["../catalog/feature", "../catalog/view"]);
  });

  it("accepts a graph that reaches the same module through multiple dependencies", () => {
    const sourceDirectory = createFixture({
      "modules/accounts/index.ts": [
        'import "../billing/index.js";',
        'import "../catalog/index.js";',
      ].join("\n"),
      "modules/billing/index.ts": 'import "../shared-kernel/index.js";',
      "modules/catalog/index.ts": 'import "../shared-kernel/index.js";',
      "modules/shared-kernel/index.ts": 'export const sharedKernel = "shared";',
    });

    expect(findModuleBoundaryViolations(sourceDirectory)).toEqual([]);
  });
  it("accepts a public import from a symlinked module absent from the source scan", () => {
    const sourceDirectory = createFixture({
      "modules/orders/index.ts": 'import "../catalog/index.js";',
    });
    const externalCatalogDirectory = join(dirname(sourceDirectory), "external-catalog");

    mkdirSync(externalCatalogDirectory);
    writeFileSync(join(externalCatalogDirectory, "index.ts"), 'export const catalog = "catalog";');
    symlinkSync(externalCatalogDirectory, join(sourceDirectory, "modules", "catalog"), "junction");

    expect(findModuleBoundaryViolations(sourceDirectory)).toEqual([]);
  });
  it("accepts the repository source graph", () => {
    expect(findModuleBoundaryViolations(resolve("src"))).toEqual([]);
  });
});
