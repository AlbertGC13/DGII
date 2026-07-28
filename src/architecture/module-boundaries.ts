import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

export type ModuleBoundaryViolation = Readonly<{
  kind: "deep-module-import" | "module-cycle" | "shared-to-module-import";
  filePath?: string;
  moduleSpecifier?: string;
  modules?: readonly string[];
}>;

type ImportReference = Readonly<{
  filePath: string;
  moduleSpecifier: string;
}>;

const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx"] as const;

export function findModuleBoundaryViolations(sourceDirectory: string): readonly ModuleBoundaryViolation[] {
  const files = findTypeScriptFiles(sourceDirectory);
  const moduleEdges = new Map<string, Set<string>>();
  const violations: ModuleBoundaryViolation[] = [];

  for (const filePath of files) {
    const sourceModule = getModuleName(sourceDirectory, filePath);
    const isSharedSource = isSharedFile(sourceDirectory, filePath);

    if (sourceModule !== undefined && !moduleEdges.has(sourceModule)) {
      moduleEdges.set(sourceModule, new Set());
    }

    for (const reference of findImportReferences(filePath)) {
      const importedFile = resolveProjectImport(reference);

      if (importedFile === undefined) {
        continue;
      }

      const targetModule = getModuleName(sourceDirectory, importedFile);

      if (targetModule === undefined) {
        continue;
      }

      if (isSharedSource) {
        violations.push({
          kind: "shared-to-module-import",
          filePath,
          moduleSpecifier: reference.moduleSpecifier,
        });
        continue;
      }

      if (sourceModule === undefined || sourceModule === targetModule) {
        continue;
      }

      moduleEdges.get(sourceModule)?.add(targetModule);
      if (importedFile !== join(sourceDirectory, "modules", targetModule, "index.ts")) {
        violations.push({
          kind: "deep-module-import",
          filePath,
          moduleSpecifier: reference.moduleSpecifier,
        });
        continue;
      }

    }
  }

  return [...violations, ...findModuleCycles(moduleEdges).map((modules) => ({
    kind: "module-cycle" as const,
    modules,
  }))];
}

function findTypeScriptFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return findTypeScriptFiles(entryPath);
      }

      return TYPESCRIPT_EXTENSIONS.includes(extname(entryPath) as ".ts" | ".tsx") ? [entryPath] : [];
    });
}

function findImportReferences(filePath: string): readonly ImportReference[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const references: ImportReference[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      references.push({ filePath, moduleSpecifier: node.moduleSpecifier.text });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return references;
}

function resolveProjectImport(reference: ImportReference): string | undefined {
  if (!reference.moduleSpecifier.startsWith(".")) {
    return undefined;
  }

  const unresolvedPath = resolve(dirname(reference.filePath), reference.moduleSpecifier);
  const extension = extname(unresolvedPath);
  const candidates = extension.length === 0
    ? TYPESCRIPT_EXTENSIONS.map((candidateExtension) => `${unresolvedPath}${candidateExtension}`)
    : TYPESCRIPT_EXTENSIONS.map((candidateExtension) => `${unresolvedPath.slice(0, -extension.length)}${candidateExtension}`);

  candidates.push(...TYPESCRIPT_EXTENSIONS.map((candidateExtension) => join(unresolvedPath, `index${candidateExtension}`)));

  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function getModuleName(sourceDirectory: string, filePath: string): string | undefined {
  const segments = relative(sourceDirectory, filePath).split(sep);
  return segments[0] === "modules" && segments.length > 2 ? segments[1] : undefined;
}

function isSharedFile(sourceDirectory: string, filePath: string): boolean {
  return relative(sourceDirectory, filePath).split(sep)[0] === "shared";
}

function findModuleCycles(moduleEdges: ReadonlyMap<string, ReadonlySet<string>>): readonly (readonly string[])[] {
  const visited = new Set<string>();
  const path: string[] = [];
  const visiting = new Set<string>();
  const cycles: string[][] = [];

  function visit(moduleName: string): void {
    if (visiting.has(moduleName)) {
      cycles.push([...path.slice(path.indexOf(moduleName)), moduleName]);
      return;
    }

    if (visited.has(moduleName)) {
      return;
    }
    visiting.add(moduleName);
    path.push(moduleName);

    for (const dependency of [...(moduleEdges.get(moduleName) ?? [])].sort()) {
      visit(dependency);
    }

    path.pop();
    visiting.delete(moduleName);
    visited.add(moduleName);
  }

  for (const moduleName of [...moduleEdges.keys()].sort()) {
    visit(moduleName);
  }

  return cycles;
}
