import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyOfficialResourceManifest } from "./official-resource-integrity.js";

const roots: string[] = [];
const officialPath = "resources/dgii/official";
type Artifact = Record<string, unknown>;

function createArtifact(repositoryPath: string, storage = "vendored", content = "fixture"): Artifact {
  return {
    repository_path: repositoryPath,
    storage,
    byte_size: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function createFixture(artifacts: unknown, files: Readonly<Record<string, string>> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "dgii-resource-integrity-"));
  roots.push(root);
  mkdirSync(join(root, officialPath), { recursive: true });
  writeFileSync(join(root, officialPath, "manifest.json"), JSON.stringify({ schema_version: 3, artifacts }));
  for (const [repositoryPath, content] of Object.entries(files)) {
    const filePath = join(root, repositoryPath);
    mkdirSync(resolve(filePath, ".."), { recursive: true });
    writeFileSync(filePath, content);
  }
  return root;
}

function codes(root: string): readonly string[] {
  return verifyOfficialResourceManifest(root).map(({ code }) => code);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("verifyOfficialResourceManifest", () => {
  it("accepts synthetic vendored bytes and an absent external artifact", () => {
    const path = `${officialPath}/fixture.txt`;
    const root = createFixture([
      createArtifact(path, "vendored", "fixture"),
      createArtifact(`${officialPath}/not-downloaded.txt`, "external"),
    ], { [path]: "fixture" });

    expect(codes(root)).toEqual([]);
  });

  it("reports safe deterministic manifest diagnostics", () => {
    const root = createFixture([null, createArtifact(`${officialPath}/a`, "unknown"), {
      repository_path: 1, storage: "vendored", byte_size: -1, sha256: "UPPER",
    }, { ...createArtifact(`${officialPath}/size`), byte_size: 1.5 }, {
      ...createArtifact(`${officialPath}/hash`), sha256: "UPPER",
    }, { ...createArtifact(`${officialPath}/string-size`), byte_size: "bad" }]);

    expect(codes(root)).toEqual([
      "invalid-manifest-entry", "invalid-storage", "invalid-repository-path",
      "invalid-byte-size", "invalid-sha256", "invalid-byte-size",
    ]);
  });

  it("rejects malformed JSON and manifest structures", () => {
    const root = createFixture({});
    writeFileSync(join(root, officialPath, "manifest.json"), "not-json");

    expect(codes(root)).toEqual(["invalid-manifest-json"]);
    writeFileSync(join(root, officialPath, "manifest.json"), JSON.stringify({ schema_version: 3, artifacts: {} }));
    expect(codes(root)).toEqual(["invalid-manifest-structure"]);
    writeFileSync(join(root, officialPath, "manifest.json"), "[]");
    expect(codes(root)).toEqual(["invalid-manifest-structure"]);
  });

  it("requires schema version 3", () => {
    const root = createFixture([]);
    const manifestPath = join(root, officialPath, "manifest.json");

    writeFileSync(manifestPath, JSON.stringify({ artifacts: [] }));
    expect(codes(root)).toEqual(["missing-schema-version"]);
    writeFileSync(manifestPath, JSON.stringify({ schema_version: "3", artifacts: [] }));
    expect(codes(root)).toEqual(["invalid-schema-version"]);
    writeFileSync(manifestPath, JSON.stringify({ schema_version: 4, artifacts: [] }));
    expect(codes(root)).toEqual(["unsupported-schema-version"]);
  });

  it("rejects duplicate physical targets differing only by a trailing separator", () => {
    const path = `${officialPath}/fixture.txt`;
    const root = createFixture([createArtifact(path), createArtifact(`${path}/`)], { [path]: "fixture" });

    expect(codes(root)).toEqual(["duplicate-repository-path"]);
  });

    const path = `${officialPath}/fixture.txt`;
  it("rejects duplicate, absolute, escaping, and non-official paths", () => {
    const root = createFixture([
      createArtifact(path), createArtifact(path.replace("/official/", "/official/./")),
      createArtifact("/tmp/file"), createArtifact("C:\\temp\\file"),
      createArtifact(`${officialPath}/../outside`), createArtifact("resources/dgii/other/file"),
    ], { [path]: "fixture" });

    expect(codes(root)).toEqual([
      "duplicate-repository-path", "invalid-repository-path", "invalid-repository-path",
      "invalid-repository-path", "invalid-repository-path",
    ]);
  });

  it("reports missing, symlinked, directory, size, and hash vendored files", () => {
    const good = `${officialPath}/good.txt`;
    const root = createFixture([
      createArtifact(`${officialPath}/missing.txt`), createArtifact(`${officialPath}/link/good.txt`),
      createArtifact(`${officialPath}/directory`), createArtifact(good, "vendored", "wrong"),
      { ...createArtifact(`${officialPath}/hash.txt`), sha256: "0".repeat(64) },
    ], { [good]: "fixture", [`${officialPath}/hash.txt`]: "fixture" });
    mkdirSync(join(root, officialPath, "directory"));
    symlinkSync(join(root, officialPath), join(root, officialPath, "link"), "junction");

    expect(codes(root)).toEqual([
      "vendored-file-missing", "vendored-file-symlink", "vendored-file-not-regular",
      "vendored-size-mismatch", "vendored-sha256-mismatch",
    ]);
  });

  it("accepts the repository byte-preserved official snapshot", () => {
    const manifest = JSON.parse(readFileSync(join(resolve("."), officialPath, "manifest.json"), "utf8")) as {
      artifacts: readonly { storage: string }[];
    };

    expect(manifest.artifacts.filter(({ storage }) => storage === "vendored")).toHaveLength(25);
    expect(manifest.artifacts.filter(({ storage }) => storage === "external")).toHaveLength(1);
    expect(codes(resolve("."))).toEqual([]);
  });
});
