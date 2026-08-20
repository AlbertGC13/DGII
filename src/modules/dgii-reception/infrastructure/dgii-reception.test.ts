import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as api from "../../../index.js";
import type { DgiiAuthenticationError } from "../../dgii-auth/index.js";
import type { DgiiHttpResponse } from "../../http-transport/index.js";
import type { Result } from "../../../shared/domain/result.js";

const fixture = fileURLToPath(new URL("../../../../test/fixtures/certificates/synthetic-test-certificate.p12", import.meta.url));
const password = "synthetic-test-password";
const xml = "<ECF><Encabezado><IdDoc><eNCF>E310000000001</eNCF></IdDoc><Emisor><RNCEmisor>000000000</RNCEmisor></Emisor></Encabezado></ECF>";

async function artifact(sourceXml = xml) {
  const identity = api.parseTaxpayerIdentifier("000000000");
  if (!identity.ok) throw new Error("Synthetic identity did not parse.");
  const certificate = api.loadInMemoryPkcs12({ bytes: await readFile(fixture), password, expectedSignerIdentity: identity.value });
  if (!certificate.ok) throw new Error("Synthetic certificate did not load.");
  const signed = api.signXmlWithAuthenticatedCertificate({ xml: sourceXml, certificateMaterial: certificate.value });
  if (!signed.ok) throw new Error("Synthetic XML did not sign.");
  const serialized = api.serializeSignedXmlArtifact(signed.value);
  if (!serialized.ok) throw new Error("Synthetic XML did not serialize.");
  const verified = api.verifyDgiiXmlSignature({ xml: serialized.value });
  if (!verified.ok) throw new Error("Synthetic XML did not verify.");
  return { artifact: verified.value, signed: serialized.value };
}

type PostResult = Result<DgiiHttpResponse, DgiiAuthenticationError>;

function response(status: number, mediaType: string, body: string): PostResult {
  return Object.freeze({ ok: true, value: Object.freeze({ status, mediaType, body }) });
}

function reception(post: (input: unknown) => Promise<PostResult>, authorization: unknown = Object.freeze(Object.create(null))) {
  const result = api.createDgiiReception({ authentication: { authorize: () => Promise.resolve({ ok: true, value: authorization }), postMultipart: (_: unknown, input: unknown) => post(input) } });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected reception.");
  return result.value;
}

describe("DGII reception", () => {
  it("submits only a genuine verified artifact as the official XML file and returns a TrackId", async () => {
    const source = await artifact(); let request: unknown;
    const result = await reception((input) => { request = input; return Promise.resolve(response(200, "application/json", '{"trackId":"track-142","error":null,"mensaje":null}')); }).submit(source.artifact);

    expect(result).toEqual({ ok: true, value: { trackId: "track-142" } });
    expect(request).toEqual({ service: "ecf", path: "api/facturaselectronicas", accept: "json", file: { fieldName: "xml", mediaType: "text/xml", fileName: "000000000E310000000001.xml", content: source.signed } });
  });

  it("rejects route overrides and posts only to the documented outbound path", () => {
    const authentication = { authorize() {}, postMultipart() {} };

    expect(api.createDgiiReception({ authentication, path: "api/ecf" })).toEqual({ ok: false, error: { code: "INVALID_DGII_RECEPTION_CONFIGURATION" } });
    expect(api.createDgiiReception({ authentication, path: "api/facturaselectronicas" })).toEqual({ ok: false, error: { code: "INVALID_DGII_RECEPTION_CONFIGURATION" } });
  });

  it("contains a rejected outbound submission after preparing a genuine verified artifact", async () => {
    const source = await artifact(); let calls = 0;
    const client = reception(() => { calls += 1; return Promise.reject(new Error("token <ECF>secret</ECF>")); });

    await expect(client.submit(source.artifact)).resolves.toEqual({ ok: false, error: { code: "DGII_RECEPTION_FAILED" } });
    expect(calls).toBe(1);
  });

  it("rejects forged artifacts, malformed authenticated identities, hostile capabilities, and contained failures", async () => {
    const source = await artifact();
    const signed = api.serializeVerifiedSignedXml(source.artifact);
    if (!signed.ok) throw new Error("Verified XML did not serialize.");
    const badXml = api.verifyDgiiXmlSignature({ xml: signed.value.replace("E310000000001", "bad") });
    const client = reception(() => Promise.reject(new Error("token <ECF>secret</ECF>")));
    for (const input of [{}, new Proxy(source.artifact, {}), badXml.ok ? badXml.value : source.artifact]) {
      await expect(client.submit(input)).resolves.toEqual({ ok: false, error: { code: "DGII_RECEPTION_FAILED" } });
    }
    const accessorAuthentication = {};
    Object.defineProperty(accessorAuthentication, "authentication", { enumerable: true, get: () => ({ authorize() {}, postMultipart() {} }) });
    const accessorPath = { authentication: { authorize() {}, postMultipart() {} } };
    Object.defineProperty(accessorPath, "path", { enumerable: true, get: () => "api/facturaselectronicas" });
    for (const configuration of [null, {}, { authentication: 1 }, { authentication: { authorize: 1, postMultipart() {} } }, { authentication: { authorize() {}, postMultipart: 1 } }, accessorAuthentication, accessorPath, new Proxy({}, { getPrototypeOf() { throw new Error("secret"); } }), new Proxy({}, { ownKeys() { throw new Error("secret"); } })]) {
      expect(api.createDgiiReception(configuration)).toEqual({ ok: false, error: { code: "INVALID_DGII_RECEPTION_CONFIGURATION" } });
    }
    const invalidIdentity = (await artifact("<ECF><Encabezado><IdDoc><eNCF>invalid</eNCF></IdDoc><Emisor><RNCEmisor>invalid</RNCEmisor></Emisor></Encabezado></ECF>")).artifact;
    await expect(client.submit(invalidIdentity)).resolves.toEqual({ ok: false, error: { code: "DGII_RECEPTION_FAILED" } });
    const incompleteIdentity = (await artifact("<ECF><Encabezado><Emisor><RNCEmisor>000000000</RNCEmisor></Emisor></Encabezado></ECF>")).artifact;
    await expect(client.submit(incompleteIdentity)).resolves.toEqual({ ok: false, error: { code: "DGII_RECEPTION_FAILED" } });
  });

  it("requires exact success JSON fields and rejects substantive errors without admitting polling", async () => {
    const source = (await artifact()).artifact;
    for (const upstream of [
      { status: 201, mediaType: "application/json", body: '{"trackId":"x","error":null,"mensaje":null}' },
      { status: 200, mediaType: "application/json", body: '{"trackId":" ","error":null,"mensaje":null}' },
      { status: 200, mediaType: "application/json", body: '{"trackId":"x","error":" rejected ","mensaje":null}' },
      { status: 200, mediaType: "application/json", body: '{"trackId":"x","error":null}' },
      { status: 200, mediaType: "text/plain", body: "synthetic" },
      { status: 200, mediaType: "application/json", body: "{" },
      [],
      { status: "200", mediaType: "application/json", body: "{}" },
      new Proxy({}, { get() { throw new Error("diagnostic"); } }),
    ]) await expect(reception(() => Promise.resolve({ ok: true, value: upstream } as never)).submit(source)).resolves.toEqual({ ok: false, error: { code: "DGII_RECEPTION_FAILED" } });

    await expect(reception(() => Promise.resolve(response(200, "application/json", '{"trackId":" x ","error":" ","mensaje":" "}'))).submit(source)).resolves.toEqual({ ok: true, value: { trackId: "x" } });
    await expect(reception(() => Promise.resolve({ ok: false, error: Object.freeze({ code: "DGII_AUTHENTICATION_FAILED" }) })).submit(source)).resolves.toEqual({ ok: false, error: { code: "DGII_RECEPTION_FAILED" } });
    for (const malformed of [undefined, null, [], { status: 200, mediaType: "application/json", body: '{"trackId":"x","error":null,"mensaje":null}' }, new Proxy({}, { get() { throw new Error("diagnostic"); } })]) {
      await expect(reception(() => Promise.resolve(malformed as never)).submit(source)).resolves.toEqual({ ok: false, error: { code: "DGII_RECEPTION_FAILED" } });
    }
    const unavailable = api.createDgiiReception({ authentication: { authorize: () => Promise.resolve({ ok: false, error: { code: "DGII_AUTHENTICATION_FAILED" } }), postMultipart: () => Promise.resolve({ ok: false, error: { code: "DGII_AUTHENTICATION_FAILED" } }) } });
    if (!unavailable.ok) throw new Error("Expected reception.");
    await expect(unavailable.value.submit(source)).resolves.toEqual({ ok: false, error: { code: "DGII_RECEPTION_FAILED" } });
  });

  it("requires one direct identity hierarchy and bounds hostile response fields before parsing", async () => {
    const nested = "<ECF><Encabezado><IdDoc><eNCF>E310000000001</eNCF><eNCF>E310000000002</eNCF></IdDoc><Emisor><RNCEmisor>000000000</RNCEmisor></Emisor></Encabezado></ECF>";
    await expect(reception(() => Promise.resolve(response(200, "application/json", '{"trackId":"x","error":null,"mensaje":null}'))).submit((await artifact(nested)).artifact)).resolves.toMatchObject({ ok: false });
    const valid = (await artifact()).artifact;
    for (const body of ["x".repeat(65_537), JSON.stringify({ trackId: "x".repeat(257), error: null, mensaje: null }), JSON.stringify({ trackId: "x", error: "x".repeat(257), mensaje: null }), JSON.stringify({ trackId: "x", error: null, mensaje: "x".repeat(257) })]) {
      await expect(reception(() => Promise.resolve(response(200, "application/json", body))).submit(valid)).resolves.toMatchObject({ ok: false });
    }
  });

  it("acquires opaque authorization before its owning capability applies it", async () => {
    const valid = (await artifact()).artifact; const owner: object = Object.freeze(Object.create(null) as unknown as object); let received: unknown;
    const result = api.createDgiiReception({ authentication: { authorize: () => Promise.resolve({ ok: true, value: owner }), postMultipart: (authorization: unknown) => { received = authorization; return Promise.resolve(response(200, "application/json", '{"trackId":"x","error":null,"mensaje":null}')); } } });
    if (!result.ok) throw new Error("Expected reception.");
    await expect(result.value.submit(valid)).resolves.toEqual({ ok: true, value: { trackId: "x" } });
    expect(received).toBe(owner);
  });
});

it("exports DGII reception from the package root", () => {
  expect(api.createDgiiReception).toBeTypeOf("function");
});
