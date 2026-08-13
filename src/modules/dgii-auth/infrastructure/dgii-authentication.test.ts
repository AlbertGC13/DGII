import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import * as api from "../../../index.js";

const fixturePath = fileURLToPath(new URL("../../../../test/fixtures/certificates/synthetic-test-certificate.p12", import.meta.url));
const seed = "<SemillaModel><valor>synthetic-seed</valor><fecha>2026-08-10T12:00:00Z</fecha></SemillaModel>";
const roots = Object.freeze({ ecf: "https://ecf.example.test", rfce: "https://rfce.example.test" });

async function certificateMaterial() {
  const identity = api.parseTaxpayerIdentifier("000000000");
  if (!identity.ok) throw new Error("Expected synthetic identity.");
  const loaded = api.loadInMemoryPkcs12({ bytes: await readFile(fixturePath), password: "synthetic-test-password", expectedIdentity: identity.value });
  if (!loaded.ok) throw new Error("Expected synthetic certificate.");
  return loaded.value;
}

describe("DGII authentication", () => {
  it("rejects invalid configuration and contains hostile input without diagnostics", async () => {
    const material = await certificateMaterial();
    const transport = api.createDgiiHttpTransport({ environment: "TesteCF", roots, executor: () => Promise.resolve(new Response()) });
    if (!transport.ok) throw new Error("Expected transport.");
    for (const input of [null, {}, { environment: "unknown", authenticationRoot: roots.ecf, transport: transport.value, certificateMaterial: material, clock: () => new Date() }, { environment: "TesteCF", authenticationRoot: "http://unsafe.test", transport: transport.value, certificateMaterial: material, clock: () => new Date() }, { environment: "TesteCF", authenticationRoot: roots.ecf, transport: {}, certificateMaterial: {}, clock: () => new Date() }, new Proxy({}, { get() { throw new Error("diagnostic"); } })]) {
      expect(api.createDgiiAuthentication(input)).toMatchObject({ ok: false, error: { code: "INVALID_DGII_AUTHENTICATION_CONFIGURATION" } });
    }
  });
  it("gets an unsigned Semilla, signs and validates it, then posts only XML for a strict JSON token", async () => {
    const requests: Request[] = [];
    const material = await certificateMaterial();
    const transport = api.createDgiiHttpTransport({ environment: "TesteCF", roots, executor: (request: Request) => {
      requests.push(request);
      return Promise.resolve(request.method === "GET" ? new Response(seed, { headers: { "content-type": "application/xml" } }) : new Response('{"token":"synthetic-token","expira":"2026-08-10T13:00:00Z","expedido":"2026-08-10T12:00:00Z"}', { headers: { "content-type": "application/json" } }));
    } });
    if (!transport.ok) throw new Error("Expected transport.");
    const configured = api.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: "https://cache-hit.example.test", transport: transport.value, certificateMaterial: material, clock: () => new Date("2026-08-10T12:00:00Z") });
    if (!configured.ok) throw new Error("Expected authentication client.");
    const authorization = await configured.value.authorize();
    expect(authorization).toMatchObject({ ok: true });
    if (!authorization.ok) return;
    const posted = await configured.value.postMultipart(authorization.value, { service: "ecf", path: "api/facturaselectronicas", accept: "json", file: { fieldName: "xml", mediaType: "text/xml", content: "<ECF/>" } });
    expect(posted).toMatchObject({ ok: true });
    await expect(configured.value.postMultipart(null, {})).resolves.toMatchObject({ ok: false });
    await configured.value.authorize();
    expect(JSON.stringify(authorization.value)).not.toContain("synthetic-token");
    expect(requests.map((request) => [request.method, request.headers.get("accept"), request.headers.has("authorization")])).toEqual([["GET", "application/xml", false], ["POST", "application/json", false], ["POST", "application/json", true]]);
  });

  it("single-flights cache misses, refreshes five minutes early, falls back only before expiry, and invalidates", async () => {
    let now = new Date("2026-08-10T12:00:00Z"); let gets = 0;
    const material = await certificateMaterial();
    const transport = api.createDgiiHttpTransport({ environment: "TesteCF", roots, executor: (request: Request) => {
      if (request.method === "GET") { gets += 1; return Promise.resolve(new Response(seed, { headers: { "content-type": "application/xml" } })); }
      if (gets === 2) return Promise.resolve(new Response(null, { status: 503 }));
      return Promise.resolve(new Response(`{"token":"token-${String(gets)}","expira":"2026-08-10T12:10:00Z","expedido":"2026-08-10T12:00:00Z"}`, { headers: { "content-type": "application/json" } }));
    } });
    if (!transport.ok) throw new Error("Expected transport.");
    const configured = api.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: roots.ecf, transport: transport.value, certificateMaterial: material, clock: () => now });
    if (!configured.ok) throw new Error("Expected authentication client.");
    configured.value.invalidate();
    await Promise.all([configured.value.authorize(), configured.value.authorize()]);
    now = new Date("2026-08-10T12:06:00Z"); await configured.value.authorize();
    now = new Date("2026-08-10T12:11:00Z"); await expect(configured.value.authorize()).resolves.toMatchObject({ ok: false });
    now = new Date("2026-08-10T12:00:00Z"); configured.value.invalidate(); await configured.value.authorize();
    expect(gets).toBe(4);
  });

  it("contains malformed Semilla, signatures, unsafe syntax, transport, and token failures behind catalog errors", async () => {
    const material = await certificateMaterial();
    for (const response of ["<", "<SemillaModel><valor>x<!--x--></valor><fecha>2026-08-10T12:00:00Z</fecha></SemillaModel>", "<SemillaModel><valor>x</valor></SemillaModel>", "<SemillaModel><valor>x</valor><fecha>2026-08-10T12:00:00Z</fecha><Signature/></SemillaModel>", "<!DOCTYPE SemillaModel><SemillaModel><valor>x</valor><fecha>2026-08-10T12:00:00Z</fecha></SemillaModel>", "<SemillaModel><valor>x</valor><fecha>2026-02-31T12:00:00.123+00:00</fecha></SemillaModel>"]) {
      const transport = api.createDgiiHttpTransport({ environment: "TesteCF", roots, executor: () => Promise.resolve(new Response(response, { headers: { "content-type": "application/xml" } })) });
      if (!transport.ok) continue;
      const configured = api.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: roots.ecf, transport: transport.value, certificateMaterial: material, clock: () => new Date() });
      if (configured.ok) { configured.value.invalidate(); await expect(configured.value.authorize()).resolves.toMatchObject({ ok: false, error: { code: "DGII_AUTHENTICATION_FAILED" } }); }
    }
  });

  it("rejects non-JSON, non-object, extra-field, invalid-date, and expired token responses", async () => {
    const material = await certificateMaterial();
    for (const body of ["not-json", "[]", "{}", '{"token":"x","expira":"2026-08-10T13:00:00Z","expedido":null}', '{"token":"x","expira":"invalid","expedido":"2026-08-10T12:00:00Z"}', '{"token":"x","expira":"2026-09-31T13:00:00.123+00:00","expedido":"2026-08-10T12:00:00.123+00:00"}', '{"token":"x","expira":"2026-08-10T12:00:00Z","expedido":"2026-08-10T12:00:00Z"}', '{"token":"x","expira":"2026-08-10T13:00:00Z","expedido":"2026-08-10T12:00:00Z","extra":true}']) {
      const transport = api.createDgiiHttpTransport({ environment: "TesteCF", roots, executor: (request: Request) => Promise.resolve(request.method === "GET" ? new Response(seed, { headers: { "content-type": "application/xml" } }) : new Response(body, { headers: { "content-type": "application/json" } })) });
      if (!transport.ok) continue;
      const configured = api.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: roots.ecf, transport: transport.value, certificateMaterial: material, clock: () => new Date("2026-08-10T12:00:00Z") });
      if (configured.ok) { configured.value.invalidate(); await expect(configured.value.authorize()).resolves.toMatchObject({ ok: false, error: { code: "DGII_AUTHENTICATION_FAILED" } }); }
    }
  });

  it("requires strict ISO dates and contains hostile capabilities without leaking diagnostics", async () => {
    const material = await certificateMaterial();
    const hostile = { get() { throw new Error("synthetic-secret"); }, postMultipart() { throw new Error("synthetic-secret"); } };
    for (const clock of [() => { throw new Error("synthetic-secret"); }, (() => { let calls = 0; return () => calls++ === 0 ? new Date() : ({ getTime() { throw new Error("synthetic-secret"); } } as unknown as Date); })()]) {
      const configured = api.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: roots.ecf, transport: hostile, certificateMaterial: material, clock });
      if (configured.ok) { configured.value.invalidate(); await expect(configured.value.authorize()).resolves.toMatchObject({ ok: false, error: { code: "DGII_AUTHENTICATION_FAILED" } }); }
    }
    expect(api.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: roots.ecf, transport: {}, certificateMaterial: material, clock: () => new Date() })).toMatchObject({ ok: false });
    for (const date of ["2026-08-10 13:00:00Z", "2026-08-10T13:00:00", "2026-08-10T13:00:00+99:00"]) {
      const transport = api.createDgiiHttpTransport({ environment: "TesteCF", roots, executor: (request: Request) => Promise.resolve(request.method === "GET" ? new Response(seed, { headers: { "content-type": "application/xml" } }) : new Response(`{"token":"x","expira":"${date}","expedido":"2026-08-10T12:00:00.123+00:00"}`, { headers: { "content-type": "application/json" } })) });
      if (!transport.ok) continue;
      const configured = api.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: roots.ecf, transport: transport.value, certificateMaterial: material, clock: () => new Date("2026-08-10T12:00:00Z") });
      if (configured.ok) { configured.value.invalidate(); await expect(configured.value.authorize()).resolves.toMatchObject({ ok: false }); }
    }
  });

  it("accepts offsets through plus or minus fourteen hours only in Semilla and tokens", async () => {
    const material = await certificateMaterial();
    for (const [offset, valid] of [["+14:00", true], ["-14:00", true], ["+14:01", false], ["-14:01", false], ["+15:00", false], ["-15:00", false]] as const) for (const target of ["seed", "token"] as const) {
      const datedSeed = seed.replace("Z", offset); const token = `{"token":"x","expira":"2026-08-11T12:00:00${offset}","expedido":"2026-08-10T12:00:00${offset}"}`;
      const transport = api.createDgiiHttpTransport({ environment: "TesteCF", roots, executor: (request: Request) => Promise.resolve(request.method === "GET" ? new Response(target === "seed" ? datedSeed : seed, { headers: { "content-type": "application/xml" } }) : new Response(token, { headers: { "content-type": "application/json" } })) });
      if (!transport.ok) throw new Error("Expected transport.");
      const configured = api.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: `https://${target}-${offset.replace(/[^\d]/gu, "")}.example.test`, transport: transport.value, certificateMaterial: material, clock: () => new Date("2026-08-10T00:00:00Z") });
      if (!configured.ok) throw new Error("Expected authentication client.");
      await expect(configured.value.authorize()).resolves.toMatchObject(valid ? { ok: true } : { ok: false, error: { code: "DGII_AUTHENTICATION_FAILED" } });
    }
  });

  it("does not cache a flight invalidated while pending and cleans that exact flight", async () => {
    let resolve!: (response: Response) => void; let gets = 0;
    const material = await certificateMaterial();
    const transport = api.createDgiiHttpTransport({ environment: "TesteCF", roots, executor: (request: Request) => {
      if (request.method === "GET") { gets += 1; return gets === 1 ? new Promise((done) => { resolve = done; }) : Promise.resolve(new Response(seed, { headers: { "content-type": "application/xml" } })); }
      return Promise.resolve(new Response('{"token":"x","expira":"2026-08-10T13:00:00Z","expedido":"2026-08-10T12:00:00Z"}', { headers: { "content-type": "application/json" } }));
    } });
    if (!transport.ok) throw new Error("Expected transport.");
    const configured = api.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: roots.ecf, transport: transport.value, certificateMaterial: material, clock: () => new Date("2026-08-10T12:00:00Z") });
    if (!configured.ok) throw new Error("Expected authentication client.");
    const flight = configured.value.authorize(); configured.value.invalidate(); resolve(new Response(seed, { headers: { "content-type": "application/xml" } }));
    await flight; await configured.value.authorize();
    expect(gets).toBe(2);
  });

  it("does not let post-invalidation callers join an obsolete flight", async () => {
    let resolve!: (response: Response) => void; let gets = 0;
    const material = await certificateMaterial();
    const transport = api.createDgiiHttpTransport({ environment: "TesteCF", roots, executor: (request: Request) => {
      if (request.method === "GET") { gets += 1; return gets === 1 ? new Promise((done) => { resolve = done; }) : Promise.resolve(new Response(seed, { headers: { "content-type": "application/xml" } })); }
      return Promise.resolve(new Response(`{"token":"token-${String(gets)}","expira":"2026-08-10T13:00:00Z","expedido":"2026-08-10T12:00:00Z"}`, { headers: { "content-type": "application/json" } }));
    } });
    if (!transport.ok) throw new Error("Expected transport.");
    const configured = api.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: "https://race.example.test", transport: transport.value, certificateMaterial: material, clock: () => new Date("2026-08-10T12:00:00Z") });
    if (!configured.ok) throw new Error("Expected authentication client.");
    const before = configured.value.authorize(); configured.value.invalidate(); const after = configured.value.authorize();
    resolve(new Response(seed, { headers: { "content-type": "application/xml" } }));
    const [oldAuthorization, newAuthorization] = await Promise.all([before, after]);
    expect([oldAuthorization, newAuthorization].some((result) => result.ok)).toBe(true);
    expect(gets).toBe(2);
  });

  it("rejects authorization artifacts created by another instance and hostile requests", async () => {
    const material = await certificateMaterial();
    const transport = api.createDgiiHttpTransport({ environment: "TesteCF", roots, executor: (request: Request) => Promise.resolve(request.method === "GET" ? new Response(seed, { headers: { "content-type": "application/xml" } }) : new Response('{"token":"synthetic-token","expira":"2026-08-10T13:00:00Z","expedido":"2026-08-10T12:00:00Z"}', { headers: { "content-type": "application/json" } })) });
    if (!transport.ok) throw new Error("Expected transport.");
    const first = api.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: "https://instance-a.example.test", transport: transport.value, certificateMaterial: material, clock: () => new Date("2026-08-10T12:00:00Z") });
    const second = api.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: "https://instance-b.example.test", transport: transport.value, certificateMaterial: material, clock: () => new Date("2026-08-10T12:00:00Z") });
    if (!first.ok || !second.ok) throw new Error("Expected authentication clients.");
    const authorization = await first.value.authorize();
    if (!authorization.ok) throw new Error("Expected authorization.");
    await expect(second.value.postMultipart(authorization.value, { service: "ecf", path: "api/facturaselectronicas", accept: "json", file: { fieldName: "xml", mediaType: "text/xml", content: "<ECF/>" } })).resolves.toMatchObject({ ok: false });
    await expect(first.value.postMultipart(authorization.value, new Proxy({}, { get() { throw new Error("diagnostic"); } }))).resolves.toMatchObject({ ok: false });
    await expect(first.value.postMultipart(authorization.value, Object.defineProperty({}, "service", { enumerable: true, get() { throw new Error("diagnostic"); } }))).resolves.toMatchObject({ ok: false });
  });

  it("separates representable cache keys and cleans failed flights", async () => {
    let gets = 0; const material = await certificateMaterial();
    const transport = api.createDgiiHttpTransport({ environment: "TesteCF", roots, executor: (request: Request) => {
      if (request.method === "GET") { gets += 1; return Promise.resolve(new Response(seed, { headers: { "content-type": "application/xml" } })); }
      return Promise.resolve(gets === 4 ? new Response(null, { status: 503 }) : new Response('{"token":"x","expira":"2026-08-10T13:00:00Z","expedido":"2026-08-10T12:00:00Z"}', { headers: { "content-type": "application/json" } }));
    } });
    if (!transport.ok) throw new Error("Expected transport.");
    const client = (environment: api.DgiiEnvironment, authenticationRoot: string) => api.createDgiiAuthentication({ environment, authenticationRoot, transport: transport.value, certificateMaterial: material, clock: () => new Date("2026-08-10T12:00:00Z") });
    for (const configured of [client("TesteCF", "https://keys-a.example.test"), client("CerteCF", "https://keys-a.example.test"), client("TesteCF", "https://keys-b.example.test")]) if (configured.ok) await configured.value.authorize();
    const failed = client("production", "https://keys-a.example.test"); if (!failed.ok) throw new Error("Expected authentication client.");
    await failed.value.authorize(); await failed.value.authorize();
    expect(gets).toBe(5);
  });

  it("contains signing, serialization, and XSD capability failures", async () => {
    for (const failure of ["sign", "serialize", "validate"] as const) {
      vi.resetModules();
      vi.doMock("../../certificate/index.js", () => ({ getAuthenticatedCertificateMetadata: () => ({ fingerprint256: "synthetic-fingerprint" }) }));
      vi.doMock("../../xml-signer/index.js", () => ({ signXmlWithAuthenticatedCertificate: () => failure === "sign" ? { ok: false } : { ok: true, value: {} }, serializeSignedXmlArtifact: () => failure === "serialize" ? { ok: false } : { ok: true, value: "<signed/>" } }));
      vi.doMock("../../builder/index.js", () => ({ isValidSignedSemilla: () => failure === "validate" ? Promise.reject(new Error("synthetic-secret")) : Promise.resolve(true) }));
      const subject = await import("./dgii-authentication.js");
      const transport = { get: () => Promise.resolve({ ok: true, value: { mediaType: "application/xml", body: seed } }), postMultipart: () => Promise.resolve({ ok: true, value: { mediaType: "application/json", body: '{"token":"x","expira":"2026-08-10T13:00:00Z","expedido":"2026-08-10T12:00:00Z"}' } }) } as unknown as api.DgiiHttpTransport;
      const configured = subject.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: roots.ecf, transport, certificateMaterial: {}, clock: () => new Date("2026-08-10T12:00:00Z") });
      if (configured.ok) await expect(configured.value.authorize()).resolves.toMatchObject({ ok: false, error: { code: "DGII_AUTHENTICATION_FAILED" } });
      vi.doUnmock("../../certificate/index.js"); vi.doUnmock("../../xml-signer/index.js"); vi.doUnmock("../../builder/index.js");
    }
  });

  it("contains parser failures and rejects incomplete certificate metadata", async () => {
    vi.resetModules();
    let metadataCalls = 0; vi.doMock("../../certificate/index.js", () => ({ getAuthenticatedCertificateMetadata: () => metadataCalls++ === 0 ? { fingerprint256: "synthetic" } : undefined }));
    const subject = await import("./dgii-authentication.js");
    expect(subject.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: roots.ecf, transport: { get() {}, postMultipart() {} }, certificateMaterial: {}, clock: () => new Date() })).toMatchObject({ ok: false });
    vi.doUnmock("../../certificate/index.js");
    const material = await certificateMaterial();
    const transport = api.createDgiiHttpTransport({ environment: "TesteCF", roots, executor: (request: Request) => Promise.resolve(request.method === "GET" ? new Response("<", { headers: { "content-type": "application/xml" } }) : new Response('{"token":"x","expira":"2026-08-10T12:00:00Z","expedido":"2026-08-10T11:00:00Z"}', { headers: { "content-type": "application/json" } })) });
    if (!transport.ok) throw new Error("Expected transport.");
    const configured = api.createDgiiAuthentication({ environment: "TesteCF", authenticationRoot: roots.ecf, transport: transport.value, certificateMaterial: material, clock: () => new Date() });
    if (configured.ok) await expect(configured.value.authorize()).resolves.toMatchObject({ ok: false });
  });
});
