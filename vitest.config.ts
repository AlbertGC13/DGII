import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/architecture/module-boundaries.ts",
        "src/architecture/official-resource-integrity.ts",
        "src/modules/builder/domain/ecf31-core-draft.ts",
        "src/modules/builder/domain/ecf31-core-header.ts",
        "src/modules/builder/application/ecf31-core-header-snapshot-codec.ts",
        "src/modules/builder/application/ecf31-core-line-snapshot-codec.ts",
        "src/modules/builder/application/ecf31-line-adjustment-snapshot-codec.ts",
        "src/modules/builder/application/ecf31-header-totals-snapshot-codec.ts",
        "src/modules/builder/application/ecf31-persistable-draft-evidence-snapshot-codec.ts",
        "src/modules/draft-persistence/infrastructure/postgres-ecf31-draft-evidence-repository.ts",
        "src/modules/builder/domain/ecf31-header-totals-evidence.ts",
        "src/modules/builder/domain/ecf31-core-line.ts",
        "src/modules/builder/domain/ecf31-line-amount-evidence.ts",
        "src/modules/builder/domain/ecf31-monto-item-quantization-evidence.ts",
        "src/modules/builder/domain/ecf31-itbis-price-inclusion-evidence.ts",
        "src/modules/builder/domain/ecf31-monto-item-tolerance-gate-evidence.ts",
        "src/modules/builder/domain/ecf31-global-adjustment-initial-evidence.ts",
        "src/modules/builder/domain/ecf31-global-adjustment-reconciliation.ts",
        "src/modules/builder/domain/exact-decimal.ts",
        "src/modules/builder/domain/line-calculation-evidence.ts",
        "src/modules/fiscal-identity/domain/e-ncf.ts",
        "src/modules/fiscal-identity/domain/taxpayer-identifier.ts",
      ],
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
});
