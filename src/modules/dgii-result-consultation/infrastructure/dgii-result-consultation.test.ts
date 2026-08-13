import { describe, expect, it } from "vitest";

import * as api from "../../../index.js";

const authorization: object = Object.freeze(Object.create(null) as unknown as object);
const accepted = '{"trackId":"track 186/&?","codigo":"1","estado":"accepted","rnc":"000000000","eNCF":"E310000000001","fechaRecepcion":"opaque","mensajes":["accepted"]}';

function client(get: (authorization: unknown, request: unknown) => Promise<unknown>) {
  const result = api.createDgiiResultConsultation({ authentication: { authorize: () => Promise.resolve({ ok: true, value: authorization }), get } });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected consultation client.");
  return result.value;
}

describe("DGII result consultation", () => {
  it("uses opaque authorization for the exact encoded S11 query and returns immutable accepted evidence", async () => {
    let request: unknown; let received: unknown;
    const result = await client((value, input) => { received = value; request = input; return Promise.resolve({ ok: true, value: { status: 200, mediaType: "application/json", body: accepted } }); }).consult("track 186/&?");

    expect(result).toEqual({ ok: true, value: { trackId: "track 186/&?", codigo: 1, classification: "accepted", estado: "accepted", rnc: "000000000", eNCF: "E310000000001", fechaRecepcion: "opaque", mensajes: ["accepted"], secuenciaUtilizada: null, sequenceDisposition: null } });
    expect(request).toEqual({ service: "ecf", path: "api/consultas/estado", trackId: "track 186/&?", accept: "json" });
    expect(received).toBe(authorization);
    if (!result.ok) throw new Error("Expected consultation evidence.");
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.mensajes)).toBe(true);
  });

  it("classifies exclusively by codigo and exposes code two sequence evidence without a resend decision", async () => {
    const cases = [
      [{ trackId: "t", codigo: 0, estado: "anything" }, { classification: "indeterminate", rnc: null, eNCF: null, fechaRecepcion: null, mensajes: [], secuenciaUtilizada: null, sequenceDisposition: null }],
      [{ trackId: "t", codigo: 3, estado: "anything", mensajes: ["pending"] }, { classification: "in-process", rnc: null, eNCF: null, fechaRecepcion: null, mensajes: [], secuenciaUtilizada: null, sequenceDisposition: null }],
      [{ trackId: "t", codigo: 2, estado: "descriptive", secuenciaUtilizada: true }, { classification: "rejected", sequenceDisposition: "consumed-non-reusable", secuenciaUtilizada: true }],
      [{ trackId: "t", codigo: 2, estado: "descriptive", secuenciaUtilizada: false }, { classification: "rejected", sequenceDisposition: "potentially-reusable-no-blind-resend", secuenciaUtilizada: false }],
      [{ trackId: "t", codigo: 4, estado: "descriptive", rnc: null, encf: "E310000000001" }, { classification: "accepted-conditional", rnc: null, eNCF: "E310000000001" }],
    ] as const;
    for (const [body, expected] of cases) await expect(client(() => Promise.resolve({ ok: true, value: { status: 200, mediaType: "application/json", body: JSON.stringify(body) } })).consult("t")).resolves.toMatchObject({ ok: true, value: expected });
  });

  it("contains invalid input, hostile responses, aliases, structural ambiguity, and upstream failures", async () => {
    const responses: unknown[] = [
      { ok: true, value: { status: 201, mediaType: "application/json", body: accepted } },
      { ok: true, value: { status: 200, mediaType: "application/json; charset=utf-8", body: accepted } },
      { ok: true, value: { status: 200, mediaType: "application/json", body: "x".repeat(65_537) } },
      { ok: true, value: { status: 200, mediaType: "application/json", body: '{"trackId":"t","trackId":"t","codigo":1,"estado":"x"}' } },
      { ok: true, value: { status: 200, mediaType: "application/json", body: JSON.stringify({ trackId: "t", codigo: "01", estado: "x" }) } },
      { ok: true, value: { status: 200, mediaType: "application/json", body: JSON.stringify({ trackId: "t", codigo: 2, estado: "x" }) } },
      { ok: true, value: { status: 200, mediaType: "application/json", body: JSON.stringify({ trackId: "t", codigo: 1, estado: "x", eNCF: "a", encf: "a" }) } },
      { ok: true, value: { status: 200, mediaType: "application/json", body: JSON.stringify({ trackId: "t", codigo: 1, estado: "x", unknown: true }) } },
      { ok: true, value: { status: 200, mediaType: "application/json", body: "{" } },
      { ok: true, value: { status: 200, mediaType: "application/json", body: "[]" } },
      { ok: true, value: { status: 200, mediaType: "application/json", body: JSON.stringify({ trackId: "t", codigo: 1, estado: "x", rnc: 1 }) } },
      { ok: true, value: { status: 200, mediaType: "application/json", body: JSON.stringify({ trackId: "t", codigo: 1, estado: "x", secuenciaUtilizada: "no" }) } },
      { ok: true, value: null },
      { ok: true, value: [] },
      { ok: true, value: { status: "200", mediaType: "application/json", body: accepted } },
      { ok: false, error: { code: "DGII_AUTHENTICATION_FAILED" } },
      { ok: true, value: new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("diagnostic"); } }) },
    ];
    for (const input of ["", " ", "x\u0000", "x".repeat(257)]) await expect(client(() => Promise.resolve(responses[0])).consult(input)).resolves.toEqual({ ok: false, error: { code: "DGII_RESULT_CONSULTATION_FAILED" } });
    for (const response of responses) await expect(client(() => Promise.resolve(response)).consult("t")).resolves.toEqual({ ok: false, error: { code: "DGII_RESULT_CONSULTATION_FAILED" } });
    expect(api.createDgiiResultConsultation({ authentication: { authorize: 1, get() {} } })).toEqual({ ok: false, error: { code: "INVALID_DGII_RESULT_CONSULTATION_CONFIGURATION" } });
    expect(api.createDgiiResultConsultation({ authentication: { authorize() {}, get() {} }, extra: true })).toEqual({ ok: false, error: { code: "INVALID_DGII_RESULT_CONSULTATION_CONFIGURATION" } });
    expect(api.createDgiiResultConsultation(new Proxy({}, { getPrototypeOf() { throw new Error("diagnostic"); } }))).toEqual({ ok: false, error: { code: "INVALID_DGII_RESULT_CONSULTATION_CONFIGURATION" } });
    const throwing = api.createDgiiResultConsultation({ authentication: { authorize() { throw new Error("diagnostic"); }, get() { return Promise.resolve({ ok: false, error: {} }); } } });
    expect(throwing.ok).toBe(true);
    if (!throwing.ok) throw new Error("Expected consultation client.");
    await expect(throwing.value.consult("t")).resolves.toEqual({ ok: false, error: { code: "DGII_RESULT_CONSULTATION_FAILED" } });
    const unauthorized = api.createDgiiResultConsultation({ authentication: { authorize() { return Promise.resolve({ ok: false, error: {} }); }, get() { return Promise.resolve({ ok: false, error: {} }); } } });
    expect(unauthorized.ok).toBe(true);
    if (!unauthorized.ok) throw new Error("Expected consultation client.");
    await expect(unauthorized.value.consult("t")).resolves.toEqual({ ok: false, error: { code: "DGII_RESULT_CONSULTATION_FAILED" } });
  });
});

it("exports DGII result consultation from the package root", () => {
  expect(api.createDgiiResultConsultation).toBeTypeOf("function");
});
