import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";

const roots = Object.freeze({
  ecf: "https://ecf.example.test/testecf",
  rfce: "https://fc.example.test/testecf",
});

function transport(executor: rootApi.DgiiHttpExecutor) {
  const result = rootApi.createDgiiHttpTransport({ environment: "TesteCF", roots, executor });
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(`Expected transport, received ${result.error.code}`);
  return result.value;
}

describe("DGII HTTP transport", () => {
  it("accepts separately configured HTTPS roots for every typed environment without deriving hosts", async () => {
    const requests: Request[] = [];
    const executor: rootApi.DgiiHttpExecutor = (request) => {
      requests.push(request);
      return Promise.resolve(new Response("synthetic", { status: 200 }));
    };

    for (const environment of ["TesteCF", "CerteCF", "production"] as const) {
      const result = rootApi.createDgiiHttpTransport({ environment, roots, executor });
      expect(result.ok).toBe(true);
    }
    const client = transport(executor);
    await client.get({ service: "rfce", path: "consulta", query: "trackid=synthetic" }, "json", "synthetic-token");

    expect(requests[0]?.url).toBe("https://fc.example.test/testecf/consulta?trackid=synthetic");
    expect(requests[0]?.url).not.toContain("ecf.example.test");
  });

  it("rejects invalid environments, roots, and targets without calling the executor", async () => {
    const executor = (): Promise<Response> => Promise.resolve(new Response());
    const invalidConfigurations: unknown[] = [
      {}, { environment: "TesteCF", roots: { ...roots, ecf: "http://ecf.example.test" }, executor },
      { environment: "unknown", roots, executor },
      { environment: "CerteCF", roots: { ecf: "not a url", rfce: roots.rfce }, executor },
    ];
    for (const input of invalidConfigurations) {
      expect(rootApi.createDgiiHttpTransport(input)).toMatchObject({ ok: false, error: { code: "INVALID_HTTP_TRANSPORT_CONFIGURATION" } });
    }
    const client = transport(executor);
    for (const target of [{ service: "ecf", path: "/absolute" }, { service: "ecf", path: "../escape" }, { service: "other", path: "safe" }] as const) {
      expect(await client.get(target as unknown as rootApi.DgiiHttpTarget, "xml")).toMatchObject({ ok: false, error: { code: "INVALID_HTTP_TRANSPORT_REQUEST" } });
    }
  });

  it("executes GET requests with only the requested XML or JSON Accept media type and preserves safe response facts", async () => {
    const requests: Request[] = [];
    const client = transport((request) => {
      requests.push(request);
      return Promise.resolve(new Response("<Synthetic />", { status: 202, headers: { "content-type": "application/xml; charset=utf-8" } }));
    });

    const result = await client.get({ service: "ecf", path: "autenticacion/api/semilla" }, "xml");

    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("accept")).toBe("application/xml");
    expect(result).toEqual({ ok: true, value: { status: 202, mediaType: "application/xml", body: "<Synthetic />" } });
  });

  it("rejects runtime-invalid GET accept values without calling the executor", async () => {
    let calls = 0;
    const client = transport(() => {
      calls += 1;
      return Promise.resolve(new Response());
    });
    const result = await client.get({ service: "ecf", path: "safe" }, "html" as unknown as "xml");

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_HTTP_TRANSPORT_REQUEST" } });
    expect(calls).toBe(0);
  });

  it("contains aborts before and after the injected executor", async () => {
    const before = new AbortController(); before.abort(); let calls = 0;
    await expect(transport(() => { calls += 1; return Promise.resolve(new Response()); }).get({ service: "ecf", path: "safe" }, "xml", undefined, before.signal)).resolves.toMatchObject({ ok: false });
    const after = new AbortController();
    await expect(transport(() => { after.abort(); return Promise.resolve(new Response(new ReadableStream({ cancel() { return Promise.reject(new Error("synthetic cancellation failure")); } }))); }).get({ service: "ecf", path: "safe" }, "xml", undefined, after.signal)).resolves.toMatchObject({ ok: false });
    expect(calls).toBe(0);
  });

  it("contains non-success responses and their diagnostics behind bounded safe facts", async () => {
    const diagnostic = "synthetic upstream diagnostic";
    const client = transport(() => Promise.resolve(new Response(diagnostic, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })));
    const result = await client.get({ service: "ecf", path: "safe" }, "json");

    expect(result).toEqual({
      ok: false,
      error: { code: "HTTP_TRANSPORT_HTTP_FAILED", status: 503, mediaType: "text/plain" },
    });
    expect(JSON.stringify(result)).not.toContain(diagnostic);
  });

  it("preserves the safe HTTP failure when response cancellation rejects", async () => {
    const client = transport(() => Promise.resolve(new Response(new ReadableStream({
      cancel() { return Promise.reject(new Error("synthetic cancellation failure")); },
    }), { status: 503, headers: { "content-type": "text/plain" } })));

    await expect(client.get({ service: "ecf", path: "safe" }, "json")).resolves.toEqual({
      ok: false,
      error: { code: "HTTP_TRANSPORT_HTTP_FAILED", status: 503, mediaType: "text/plain" },
    });
  });

  it("rejects an oversized streamed response before accumulating its body", async () => {
    const oversized = new Uint8Array(1_048_577);
    const client = transport(() => Promise.resolve(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(oversized);
        controller.close();
      },
    }))));
    await expect(client.get({ service: "ecf", path: "safe" }, "xml")).resolves.toMatchObject({
      ok: false,
      error: { code: "HTTP_TRANSPORT_RESPONSE_TOO_LARGE" },
    });
  });

  it("preserves the oversized response error when reader cancellation rejects", async () => {
    const oversized = new Uint8Array(1_048_577);
    const client = transport(() => Promise.resolve(new Response(new ReadableStream({
      start(controller) { controller.enqueue(oversized); },
      cancel() { return Promise.reject(new Error("synthetic cancellation failure")); },
    }))));

    await expect(client.get({ service: "ecf", path: "safe" }, "xml")).resolves.toMatchObject({
      ok: false,
      error: { code: "HTTP_TRANSPORT_RESPONSE_TOO_LARGE" },
    });
  });

  it("sends only the required XML multipart file part, requested response type, optional Bearer authorization, and no manual boundary", async () => {
    let request: Request | undefined;
    const client = transport((captured) => {
      request = captured;
      return Promise.resolve(new Response("{}", { headers: { "content-type": "application/json" } }));
    });

    const result = await client.postMultipart({
      service: "ecf",
      path: "api/facturaselectronicas",
      accept: "json",
      file: { fieldName: "xml", mediaType: "text/xml", content: "<ECF>synthetic</ECF>" },
      bearerToken: "synthetic-token",
    });

    expect(result).toMatchObject({ ok: true, value: { status: 200, mediaType: "application/json", body: "{}" } });
    expect(request?.headers.get("authorization")).toBe("Bearer synthetic-token");
    expect(request?.headers.get("accept")).toBe("application/json");
    expect(request?.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/u);
    const form = await request?.formData();
    expect([...form?.keys() ?? []]).toEqual(["xml"]);
    const file = form?.get("xml");
    expect(file).toBeInstanceOf(File);
    expect((file as File).type).toBe("text/xml");
    expect(await (file as File).text()).toBe("<ECF>synthetic</ECF>");

    await client.postMultipart({ service: "ecf", path: "api/facturaselectronicas", accept: "json", file: { fieldName: "xml", mediaType: "text/xml", content: "<ECF/>", fileName: "000000000E310000000001.xml" } });
    expect((await request?.formData())?.get("xml")).toMatchObject({ name: "000000000E310000000001.xml" });
    await expect(client.postMultipart({ service: "ecf", path: "safe", accept: "json", file: { fieldName: "xml", mediaType: "text/xml", content: "<ECF/>", fileName: "unsafe.xml" } })).resolves.toMatchObject({ ok: false });
  });

  it("rejects runtime-invalid multipart response negotiation without calling the executor", async () => {
    let calls = 0;
    const client = transport(() => { calls += 1; return Promise.resolve(new Response()); });

    await expect(client.postMultipart({ service: "ecf", path: "safe", accept: "html" as unknown as "json", file: { fieldName: "xml", mediaType: "text/xml", content: "<Synthetic/>" } })).resolves.toMatchObject({ ok: false, error: { code: "INVALID_HTTP_TRANSPORT_REQUEST" } });
    expect(calls).toBe(0);
  });

  it("contains invalid multipart input and executor failures behind catalog errors without leaking secrets", async () => {
    const token = "synthetic-secret-token";
    const client = transport(() => Promise.reject(new Error(`diagnostic ${token} <ECF>secret</ECF>`)));
    const invalid = await client.postMultipart({ service: "ecf", path: "recepcion", accept: "json", file: { fieldName: "other", mediaType: "application/json", content: "<ECF/>" } } as unknown as rootApi.DgiiMultipartPost);
    const failed = await client.postMultipart({ service: "ecf", path: "recepcion", accept: "json", file: { fieldName: "xml", mediaType: "text/xml", content: "<ECF>secret</ECF>" }, bearerToken: token });

    expect(invalid).toMatchObject({ ok: false, error: { code: "INVALID_HTTP_TRANSPORT_REQUEST" } });
    expect(failed).toMatchObject({ ok: false, error: { code: "HTTP_TRANSPORT_EXECUTION_FAILED" } });
    expect(JSON.stringify(failed)).not.toContain(token);
    expect(JSON.stringify(failed)).not.toContain("<ECF>");
  });

  it("contains malformed executor output behind the same safe execution error", async () => {
    const client = transport(() => Promise.resolve({ status: 200 } as Response));

    await expect(client.get({ service: "ecf", path: "safe" }, "json")).resolves.toMatchObject({
      ok: false,
      error: { code: "HTTP_TRANSPORT_EXECUTION_FAILED" },
    });
  });

  it("contains hostile configuration and request proxies behind catalog errors", async () => {
    const executor = (): Promise<Response> => Promise.resolve(new Response());
    const client = transport(executor);
    const hostile = new Proxy({}, { get() { throw new Error("internal diagnostic"); } });

    expect(rootApi.createDgiiHttpTransport(hostile)).toMatchObject({ ok: false, error: { code: "INVALID_HTTP_TRANSPORT_CONFIGURATION" } });
    await expect(client.get(hostile as rootApi.DgiiHttpTarget, "xml")).resolves.toMatchObject({ ok: false, error: { code: "INVALID_HTTP_TRANSPORT_REQUEST" } });
    await expect(client.postMultipart(hostile as rootApi.DgiiMultipartPost)).resolves.toMatchObject({ ok: false, error: { code: "INVALID_HTTP_TRANSPORT_REQUEST" } });
  });

  it("rejects every unsafe root and request shape while preserving a root trailing slash", async () => {
    const executor = (): Promise<Response> => Promise.resolve(new Response("synthetic"));
    for (const roots_ of [
      { ecf: 1, rfce: roots.rfce }, { ecf: "https://user@ecf.example.test", rfce: roots.rfce },
      { ecf: "https://ecf.example.test?query", rfce: roots.rfce }, { ecf: "https://ecf.example.test#fragment", rfce: roots.rfce },
    ]) {
      expect(rootApi.createDgiiHttpTransport({ environment: "TesteCF", roots: roots_, executor })).toMatchObject({ ok: false });
    }
    const result = rootApi.createDgiiHttpTransport({ environment: "TesteCF", roots: { ecf: `${roots.ecf}/`, rfce: `${roots.rfce}/` }, executor });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid trailing-slash roots.");

    const response = await result.value.get({ service: "ecf", path: "safe" }, "json");
    expect(response).toEqual({ ok: true, value: { status: 200, mediaType: "text/plain", body: "synthetic" } });
    for (const target of [null, [], { service: "ecf", path: 1 }, { service: "ecf", path: "unsafe?query" }] as const) {
      await expect(result.value.get(target as unknown as rootApi.DgiiHttpTarget, "xml")).resolves.toMatchObject({ ok: false });
    }
  });

  it("handles optional multipart authorization and absent response media type", async () => {
    let request: Request | undefined;
    const client = transport((captured) => {
      request = captured;
      return Promise.resolve(new Response(null));
    });

    const result = await client.postMultipart({ service: "rfce", path: "safe", accept: "xml", file: { fieldName: "xml", mediaType: "text/xml", content: "<Synthetic/>" } });
    expect(result).toEqual({ ok: true, value: { status: 200, mediaType: "", body: "" } });
    expect(request?.headers.has("authorization")).toBe(false);
    await expect(client.postMultipart({ service: "rfce", path: "safe", accept: "xml", file: { fieldName: "xml", mediaType: "text/xml", content: "<Synthetic/>" }, bearerToken: "bad\ntoken" } as unknown as rootApi.DgiiMultipartPost)).resolves.toMatchObject({ ok: false });
    await expect(client.postMultipart({ service: "invalid", path: "safe", accept: "xml", file: { fieldName: "xml", mediaType: "text/xml", content: "<Synthetic/>" } } as unknown as rootApi.DgiiMultipartPost)).resolves.toMatchObject({ ok: false });
  });
});

it("preserves the documented outbound reception resource below the recepcion service root", async () => {
  let request: Request | undefined;
  const result = rootApi.createDgiiHttpTransport({ environment: "TesteCF", roots: { ecf: "https://ecf.example.test/recepcion", rfce: roots.rfce }, executor: (captured: Request) => { request = captured; return Promise.resolve(new Response()); } });
  if (!result.ok) throw new Error("Expected transport.");
  await result.value.postMultipart({ service: "ecf", path: "api/facturaselectronicas", accept: "json", file: { fieldName: "xml", mediaType: "text/xml", content: "<ECF/>" } });
  expect(request?.url).toBe("https://ecf.example.test/recepcion/api/facturaselectronicas");
});

it("exports the HTTP transport module from the package root", () => {
  expect(rootApi.createDgiiHttpTransport).toBeTypeOf("function");
});
