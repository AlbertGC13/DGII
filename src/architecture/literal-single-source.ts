import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

const sourceExtensions = [".ts", ".tsx", ".js", ".mjs", ".cjs"] as const;
type SourceExtension = (typeof sourceExtensions)[number];

/**
 * Production (non-test) authored sources whose text contains `literal`, as sorted repository-relative
 * POSIX paths. `searchRoots` is an explicit allowlist of directories below `repositoryRoot` — naming
 * them rather than walking the repository keeps `node_modules`, `dist` and `coverage` out of the scan
 * while covering every language a restatement could hide in. A rule that must hold in exactly one
 * place is asserted by pinning this result to that single file, so any later copy fails the suite.
 */
export function findLiteralProductionSources(
  repositoryRoot: string,
  searchRoots: readonly string[],
  literal: string,
): readonly string[] {
  return searchRoots
    .flatMap((searchRoot) => findProductionSources(resolve(repositoryRoot, searchRoot)))
    .filter((filePath) => readFileSync(filePath, "utf8").includes(literal))
    .map((filePath) => relative(repositoryRoot, filePath).split(sep).join("/"))
    .sort();
}

function findProductionSources(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return findProductionSources(entryPath);
    return sourceExtensions.includes(extname(entry.name) as SourceExtension) && !entry.name.includes(".test.")
      ? [entryPath]
      : [];
  });
}
