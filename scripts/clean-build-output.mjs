import { lstat, realpath, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputDirectory = resolve(projectDirectory, "dist");

if (relative(projectDirectory, outputDirectory) !== "dist") {
  throw new Error("Refusing to clean a path outside the project build output.");
}

try {
  const outputMetadata = await lstat(outputDirectory);
  if (outputMetadata.isSymbolicLink()) {
    throw new Error("Refusing to clean a symbolic-link build output.");
  }

  const [resolvedProjectDirectory, resolvedOutputDirectory] = await Promise.all([
    realpath(projectDirectory),
    realpath(outputDirectory),
  ]);
  if (relative(resolvedProjectDirectory, resolvedOutputDirectory) !== "dist") {
    throw new Error("Refusing to clean a resolved path outside the project build output.");
  }
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    process.exit(0);
  }
  throw error;
}
await rm(outputDirectory, { force: true, recursive: true });
