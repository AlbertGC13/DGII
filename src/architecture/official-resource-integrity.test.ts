import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyOfficialResourceManifest, verifyResourceAuthorityRoot } from "./official-resource-integrity.js";

const roots: string[] = [];
const officialPath = "resources/dgii/official";
const w3cPath = "resources/standards/w3c";
type Artifact = Record<string, unknown>;

function createArtifact(repositoryPath: string, storage = "vendored", content = "fixture"): Artifact {
  return {
    repository_path: repositoryPath,
    storage,
    byte_size: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function createFixture(
  artifacts: unknown,
  files: Readonly<Record<string, string>> = {},
  authorityPath = officialPath,
): string {
  const root = mkdtempSync(join(tmpdir(), "dgii-resource-integrity-"));
  roots.push(root);
  mkdirSync(join(root, authorityPath), { recursive: true });
  writeFileSync(join(root, authorityPath, "manifest.json"), JSON.stringify({ schema_version: 3, artifacts }));
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

function authorityCodes(root: string, authorityPath: string): readonly string[] {
  return verifyResourceAuthorityRoot(root, authorityPath.split("/")).map(({ code }) => code);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("verifyOfficialResourceManifest", () => {
  it("confines configured authority roots independently", () => {
    const path = `${w3cPath}/xsd/fixture.xsd`;
    const root = createFixture([
      createArtifact(path),
      createArtifact(`${officialPath}/outside.txt`),
    ], { [path]: "fixture" }, w3cPath);

    expect(authorityCodes(root, w3cPath)).toEqual(["invalid-repository-path"]);
  });

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

  it("accepts the separate byte-preserved W3C XMLDSig schema snapshot", () => {
    const manifest = JSON.parse(readFileSync(join(resolve("."), w3cPath, "manifest.json"), "utf8")) as {
      schema_version: number;
      retrieved_at_utc: string;
      artifacts: readonly Record<string, unknown>[];
    };

    expect(manifest.schema_version).toBe(3);
    expect(manifest.retrieved_at_utc).toBe("2026-08-01T13:27:05Z");
    expect(manifest.artifacts).toEqual([expect.objectContaining({
      authority: "W3C",
      source_url: "https://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd",
      repository_path: `${w3cPath}/xsd/xmldsig-core-schema.xsd`,
      byte_size: 10292,
      sha256: "d102ad3df7664c307e0c2c776ba4a90513b1969974d8a940bae1a77f9f21e15d",
      namespace: "http://www.w3.org/2000/09/xmldsig#",
      response: {
        final_url: "https://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd",
        http_status: 200,
        content_type: "application/xml",
        last_modified: "2013-04-16T12:48:49Z",
      },
      version: { revision: "1.2", date: "2013-04-16", schema_version: "0.1" },
      license: "W3C Software License (1998-07-20)",
    })]);
    expect(authorityCodes(resolve("."), w3cPath)).toEqual([]);
  });
});
