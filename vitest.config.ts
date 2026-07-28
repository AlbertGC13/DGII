import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/architecture/module-boundaries.ts",
        "src/modules/builder/domain/exact-decimal.ts",
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
