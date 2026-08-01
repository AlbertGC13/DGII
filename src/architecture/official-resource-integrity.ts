import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, posix, relative, resolve, sep, win32 } from "node:path";

const officialSegments = ["resources", "dgii", "official"] as const;
const sha256Pattern = /^[0-9a-f]{64}$/;
const supportedSchemaVersion = 3;

export type OfficialResourceDiagnosticCode =
  | "duplicate-repository-path"
  | "invalid-byte-size"
  | "invalid-manifest-entry"
  | "invalid-manifest-json"
  | "invalid-manifest-structure"
  | "invalid-repository-path"
  | "invalid-sha256"
  | "invalid-storage"
  | "invalid-schema-version"
  | "missing-schema-version"
  | "unsupported-schema-version"
  | "vendored-file-missing"
  | "vendored-file-not-regular"
  | "vendored-file-symlink"
  | "vendored-sha256-mismatch"
  | "vendored-size-mismatch";

export type OfficialResourceDiagnostic = Readonly<{ code: OfficialResourceDiagnosticCode }>;

type ManifestEntry = Readonly<{
  repository_path: string;
  storage: "external" | "vendored";
  byte_size: number;
  sha256: string;
}>;

export function verifyOfficialResourceManifest(repositoryRoot: string): readonly OfficialResourceDiagnostic[] {
  return verifyResourceAuthorityRoot(repositoryRoot, officialSegments);
}

export function verifyResourceAuthorityRoot(
  repositoryRoot: string,
  authoritySegments: readonly string[],
): readonly OfficialResourceDiagnostic[] {
  const authorityRoot = resolve(repositoryRoot, ...authoritySegments);
  const manifestPath = resolve(authorityRoot, "manifest.json");
  const manifest = readManifest(manifestPath);
  if (!isManifestEntries(manifest)) return [manifest];

  const diagnostics: OfficialResourceDiagnostic[] = [];
  const paths = new Set<string>();
  for (const entry of manifest) {
    const parsed = parseEntry(entry, repositoryRoot, authorityRoot, authoritySegments, paths);
    if ("code" in parsed) {
      diagnostics.push(parsed);
      continue;
    }
    if (parsed.storage === "vendored") diagnostics.push(...verifyVendored(parsed, authorityRoot, authoritySegments));
  }
  return diagnostics;
}

function readManifest(manifestPath: string): readonly unknown[] | OfficialResourceDiagnostic {
  try {
    const value: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!isRecord(value)) return { code: "invalid-manifest-structure" };
    const schemaVersion = value["schema_version"];
    if (schemaVersion === undefined) return { code: "missing-schema-version" };
    if (typeof schemaVersion !== "number") return { code: "invalid-schema-version" };
    if (schemaVersion !== supportedSchemaVersion) return { code: "unsupported-schema-version" };
    const artifacts = value["artifacts"];
    return isManifestEntries(artifacts)
      ? artifacts
      : { code: "invalid-manifest-structure" };
  } catch {
    return { code: "invalid-manifest-json" };
  }
}

function parseEntry(
  value: unknown,
  repositoryRoot: string,
  authorityRoot: string,
  authoritySegments: readonly string[],
  paths: Set<string>,
): ManifestEntry | OfficialResourceDiagnostic {
  if (!isRecord(value)) return { code: "invalid-manifest-entry" };
  const repositoryPath = value["repository_path"];
  if (typeof repositoryPath !== "string") return { code: "invalid-repository-path" };
  const normalizedPath = normalizePath(repositoryPath, repositoryRoot, authorityRoot, authoritySegments);
  if (normalizedPath === undefined) return { code: "invalid-repository-path" };
  if (paths.has(normalizedPath)) return { code: "duplicate-repository-path" };
  paths.add(normalizedPath);
  const storage = value["storage"];
  const byteSize = value["byte_size"];
  const sha256 = value["sha256"];
  if (storage !== "external" && storage !== "vendored") return { code: "invalid-storage" };
  if (typeof byteSize !== "number" || !Number.isSafeInteger(byteSize) || byteSize < 0) return { code: "invalid-byte-size" };
  if (typeof sha256 !== "string" || !sha256Pattern.test(sha256)) return { code: "invalid-sha256" };
  return { repository_path: normalizedPath, storage, byte_size: byteSize, sha256 };
}

function normalizePath(
  repositoryPath: string,
  repositoryRoot: string,
  authorityRoot: string,
  authoritySegments: readonly string[],
): string | undefined {
  if (repositoryPath.length === 0 || isAbsolute(repositoryPath) || win32.isAbsolute(repositoryPath)) return undefined;
  const normalized = posix.normalize(repositoryPath.replaceAll("\\", "/"));
  const canonicalPath = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  const segments = canonicalPath.split("/");
  if (
    segments.length <= authoritySegments.length ||
    authoritySegments.some((segment, index) => segments[index] !== segment) ||
    relative(authorityRoot, resolve(repositoryRoot, ...segments)).split(sep).includes("..")
  ) return undefined;
  return canonicalPath;
}

function verifyVendored(
  entry: ManifestEntry,
  authorityRoot: string,
  authoritySegments: readonly string[],
): readonly OfficialResourceDiagnostic[] {
  const target = resolve(authorityRoot, ...entry.repository_path.split("/").slice(authoritySegments.length));
  const segments = relative(authorityRoot, target).split(sep);
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const stat = lstatSync(resolve(authorityRoot, ...segments.slice(0, index + 1)));
      if (stat.isSymbolicLink()) return [{ code: "vendored-file-symlink" }];
    }
  } catch {
    return [{ code: "vendored-file-missing" }];
  }
  const stat = lstatSync(target);
  if (!stat.isFile()) return [{ code: "vendored-file-not-regular" }];
  if (stat.size !== entry.byte_size) return [{ code: "vendored-size-mismatch" }];
  return createHash("sha256").update(readFileSync(target)).digest("hex") === entry.sha256
    ? []
    : [{ code: "vendored-sha256-mismatch" }];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManifestEntries(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
