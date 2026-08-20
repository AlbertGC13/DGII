import { describe, expect, it } from "vitest";

import { createTesteCfEcf31ProbeDiagnostics, redactTesteCfProbeOutput } from "./testecf-ecf31-probe-diagnostics.js";

function responseFields(body: string): Readonly<Record<string, string>> {
  const diagnostics = createTesteCfEcf31ProbeDiagnostics();
  diagnostics.observeAuthorization({ ok: true, value: {} });
  diagnostics.observeReceptionTransport({ ok: true, value: { status: 200, mediaType: "application/json", body } });
  return Object.freeze(Object.fromEntries(diagnostics.fields().map(({ field, value }) => [field, value])));
}

const structuralFieldNames = new Set([
  "RESPONSE_SHAPE", "RESPONSE_KEY_COUNT", "UNKNOWN_KEY_COUNT", "DUPLICATE_KEY_COUNT",
  "TRACK_ID_KEY", "TRACK_ID_STATE", "ERROR_KEY", "ERROR_STATE", "MESSAGE_KEY", "MESSAGE_STATE", "RESPONSE_SUCCESS_COMPATIBLE",
]);

function legacyFields(diagnostics: ReturnType<typeof createTesteCfEcf31ProbeDiagnostics>) {
  return diagnostics.fields().filter(({ field }) => !structuralFieldNames.has(field));
}

describe("TesteCF e-CF 31 probe diagnostics", () => {
  it("classifies reception JSON structurally without exposing values or unknown keys", () => {
    expect(responseFields("{")).toMatchObject({ RESPONSE_SHAPE: "INVALID_JSON" });
    expect(responseFields("null")).toMatchObject({ RESPONSE_SHAPE: "NON_OBJECT" });
    expect(responseFields("[]")).toMatchObject({ RESPONSE_SHAPE: "ARRAY" });

    expect(responseFields('{"trackId":"accepted-track","error":null,"mensaje":" "}')).toMatchObject({
      RESPONSE_SHAPE: "OBJECT",
      RESPONSE_KEY_COUNT: "3",
      UNKNOWN_KEY_COUNT: "0",
      DUPLICATE_KEY_COUNT: "0",
      TRACK_ID_KEY: "EXACT",
      TRACK_ID_STATE: "STRING_NONBLANK",
      ERROR_KEY: "EXACT",
      ERROR_STATE: "NULL",
      MESSAGE_KEY: "EXACT",
      MESSAGE_STATE: "STRING_BLANK",
      RESPONSE_SUCCESS_COMPATIBLE: "YES",
    });

    expect(responseFields('{"TRACKID":null,"ERROR":7,"MENSAJE":"x","unexpected":"private"}')).toMatchObject({
      RESPONSE_SHAPE: "OBJECT",
      RESPONSE_KEY_COUNT: "4",
      UNKNOWN_KEY_COUNT: "4",
      DUPLICATE_KEY_COUNT: "0",
      TRACK_ID_KEY: "NONCANONICAL",
      TRACK_ID_STATE: "NULL",
      ERROR_KEY: "NONCANONICAL",
      ERROR_STATE: "INVALID_TYPE",
      MESSAGE_KEY: "NONCANONICAL",
      MESSAGE_STATE: "STRING_NONBLANK",
      RESPONSE_SUCCESS_COMPATIBLE: "NO",
    });

    expect(responseFields('{"other":true}')).toMatchObject({
      RESPONSE_SHAPE: "OBJECT",
      RESPONSE_KEY_COUNT: "1",
      UNKNOWN_KEY_COUNT: "1",
      TRACK_ID_KEY: "MISSING",
      TRACK_ID_STATE: "MISSING",
      ERROR_KEY: "MISSING",
      ERROR_STATE: "MISSING",
      MESSAGE_KEY: "MISSING",
      MESSAGE_STATE: "MISSING",
      RESPONSE_SUCCESS_COMPATIBLE: "NO",
    });

    expect(responseFields(`{"trackId":"${"x".repeat(257)}","error":"${"x".repeat(257)}","mensaje":[]}`)).toMatchObject({
      TRACK_ID_STATE: "OVER_LIMIT",
      ERROR_STATE: "OVER_LIMIT",
      MESSAGE_STATE: "INVALID_TYPE",
      RESPONSE_SUCCESS_COMPATIBLE: "NO",
    });

    expect(responseFields('{"trackId":"first","trackId":"second","error":"Rejected","mensaje":null}')).toMatchObject({
      DUPLICATE_KEY_COUNT: "1",
      ERROR_STATE: "STRING_NONBLANK",
      RESPONSE_SUCCESS_COMPATIBLE: "NO",
    });

    expect(responseFields('{"trackId":"x\\": not a key","error":null,"mensaje":null}')).toMatchObject({
      DUPLICATE_KEY_COUNT: "0",
      RESPONSE_SUCCESS_COMPATIBLE: "YES",
    });
  });

  it("reports an authorization failure before the reception POST", () => {
    const diagnostics = createTesteCfEcf31ProbeDiagnostics();

    diagnostics.observeAuthorization({ ok: false, error: { code: "DGII_AUTHENTICATION_FAILED" } });

    expect(legacyFields(diagnostics)).toEqual([{ field: "FAILURE_STAGE", value: "AUTHORIZATION" }]);
  });

  it("reports a reception transport failure without a response", () => {
    const diagnostics = createTesteCfEcf31ProbeDiagnostics();
    diagnostics.observeAuthorization({ ok: true, value: {} });

    diagnostics.observeReceptionTransport({ ok: false, error: { code: "HTTP_TRANSPORT_EXECUTION_FAILED" } });

    expect(legacyFields(diagnostics)).toEqual([{ field: "FAILURE_STAGE", value: "RECEPTION_NO_RESPONSE" }]);
  });

  it("suppresses DGII fields containing control characters", () => {
    const diagnostics = createTesteCfEcf31ProbeDiagnostics();
    diagnostics.observeAuthorization({ ok: true, value: {} });

    diagnostics.observeReceptionTransport({
      ok: true,
      value: {
        status: 200,
        mediaType: "application/json",
        body: '{"trackId":"rejected-track","error":"REJECTED\\nCODE","mensaje":"No aprobado\\tahora"}',
      },
    });

    expect(legacyFields(diagnostics)).toEqual([
      { field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" },
      { field: "HTTP_STATUS", value: "200" },
      { field: "RESPONSE_MEDIA_TYPE", value: "application/json" },
    ]);
  });

  it("reports HTTP status and media type for a rejected HTTP response without reading a body", () => {
    const diagnostics = createTesteCfEcf31ProbeDiagnostics();
    diagnostics.observeAuthorization({ ok: true, value: {} });

    diagnostics.observeReceptionTransport({
      ok: false,
      error: { code: "HTTP_TRANSPORT_HTTP_FAILED", status: 401, mediaType: "text/plain" },
    });

    expect(legacyFields(diagnostics)).toEqual([
      { field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" },
      { field: "HTTP_STATUS", value: "401" },
      { field: "RESPONSE_MEDIA_TYPE", value: "text/plain" },
    ]);
  });

  it("does not disclose a token, track ID, malformed response fields, or arbitrary body", () => {
    const diagnostics = createTesteCfEcf31ProbeDiagnostics();
    diagnostics.observeAuthorization({ ok: true, value: { token: "eyJhbGciOiJIUzI1NiJ9.payload.signature" } });

    diagnostics.observeReceptionTransport({
      ok: true,
      value: {
        status: 200,
        mediaType: "application/json",
        body: '{"trackId":"rejected-track","error":"eyJhbGciOiJIUzI1NiJ9.payload.signature","mensaje":"<ECF>private XML</ECF>","extra":"not allowed"}',
      },
    });

    expect(legacyFields(diagnostics)).toEqual([
      { field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" },
      { field: "HTTP_STATUS", value: "200" },
      { field: "RESPONSE_MEDIA_TYPE", value: "application/json" },
    ]);
  });

  it("fails closed for hostile inputs and malformed JSON without throwing", () => {
    const authorization = createTesteCfEcf31ProbeDiagnostics();
    authorization.observeAuthorization(new Proxy({}, { getPrototypeOf: () => { throw new Error("hostile"); } }));
    expect(legacyFields(authorization)).toEqual([{ field: "FAILURE_STAGE", value: "AUTHORIZATION" }]);

    const transport = createTesteCfEcf31ProbeDiagnostics();
    transport.observeAuthorization(new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("hostile"); } }));
    transport.observeReceptionTransport({
      ok: true,
      value: { status: 200, mediaType: "application/json", body: "{" },
    });
    expect(legacyFields(transport)).toEqual([
      { field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" },
      { field: "HTTP_STATUS", value: "200" },
      { field: "RESPONSE_MEDIA_TYPE", value: "application/json" },
    ]);
  });

  it("suppresses a JWT in an otherwise valid DGII field and omits unsafe or empty text", () => {
    const diagnostics = createTesteCfEcf31ProbeDiagnostics();
    diagnostics.observeAuthorization({ ok: true, value: {} });
    diagnostics.observeReceptionTransport({
      ok: true,
      value: {
        status: 202,
        mediaType: "application/json",
        body: '{"trackId":"not-emitted","error":"eyJhbGciOiJIUzI1NiJ9.payload.signature","mensaje":"<xml>"}',
      },
    });

    expect(legacyFields(diagnostics)).toEqual([
      { field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" },
      { field: "HTTP_STATUS", value: "202" },
      { field: "RESPONSE_MEDIA_TYPE", value: "application/json" },
    ]);
  });

  it("omits unsupported and invalid DGII responses without exposing their bodies", () => {
    const noResponse = createTesteCfEcf31ProbeDiagnostics();
    noResponse.observeAuthorization({ ok: true, value: {} });
    noResponse.observeReceptionTransport(undefined);
    expect(legacyFields(noResponse)).toEqual([{ field: "FAILURE_STAGE", value: "RECEPTION_NO_RESPONSE" }]);

    const nonJson = createTesteCfEcf31ProbeDiagnostics();
    nonJson.observeAuthorization({ ok: true, value: {} });
    nonJson.observeReceptionTransport({ ok: true, value: { status: 204, mediaType: "text/plain", body: "private body" } });
    expect(legacyFields(nonJson)).toEqual([
      { field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" },
      { field: "HTTP_STATUS", value: "204" },
      { field: "RESPONSE_MEDIA_TYPE", value: "text/plain" },
    ]);

    const oversized = createTesteCfEcf31ProbeDiagnostics();
    oversized.observeAuthorization({ ok: true, value: {} });
    oversized.observeReceptionTransport({
      ok: true,
      value: { status: 200, mediaType: "application/json", body: `{"trackId":"not-emitted","error":"${"x".repeat(257)}","mensaje":null}` },
    });
    expect(legacyFields(oversized)).toEqual([
      { field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" },
      { field: "HTTP_STATUS", value: "200" },
      { field: "RESPONSE_MEDIA_TYPE", value: "application/json" },
    ]);

    const oversizedTrackId = createTesteCfEcf31ProbeDiagnostics();
    oversizedTrackId.observeAuthorization({ ok: true, value: {} });
    oversizedTrackId.observeReceptionTransport({
      ok: true,
      value: { status: 200, mediaType: "application/json", body: `{"trackId":"${"x".repeat(257)}","error":null,"mensaje":null}` },
    });
    expect(legacyFields(oversizedTrackId)).toEqual([
      { field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" },
      { field: "HTTP_STATUS", value: "200" },
      { field: "RESPONSE_MEDIA_TYPE", value: "application/json" },
    ]);

    const nullableAndEmpty = createTesteCfEcf31ProbeDiagnostics();
    nullableAndEmpty.observeAuthorization({ ok: true, value: {} });
    nullableAndEmpty.observeReceptionTransport({
      ok: true,
      value: { status: 200, mediaType: "application/json", body: '{"trackId":"not-emitted","error":"","mensaje":""}' },
    });
    expect(legacyFields(nullableAndEmpty)).toEqual([
      { field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" },
      { field: "HTTP_STATUS", value: "200" },
      { field: "RESPONSE_MEDIA_TYPE", value: "application/json" },
    ]);

    const nullable = createTesteCfEcf31ProbeDiagnostics();
    nullable.observeAuthorization({ ok: true, value: {} });
    nullable.observeReceptionTransport({
      ok: true,
      value: { status: 200, mediaType: "application/json", body: '{"trackId":"not-emitted","error":null,"mensaje":null}' },
    });
    expect(legacyFields(nullable)).toEqual([
      { field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" },
      { field: "HTTP_STATUS", value: "200" },
      { field: "RESPONSE_MEDIA_TYPE", value: "application/json" },
    ]);
  });

  it.each([
    "password=hunter2",
    "credential: opaque-value",
    "Authorization: Bearer opaque-value",
    "token=opaque-value",
    "X-Api-Key: opaque-value",
    "Header: opaque-value",
    "-----BEGIN PRIVATE KEY-----",
    "-----BEGIN CERTIFICATE-----",
    "mensaje\u0000oculto",
  ])("suppresses a sensitive DGII error and message: %s", (sensitive) => {
    const diagnostics = createTesteCfEcf31ProbeDiagnostics();
    diagnostics.observeAuthorization({ ok: true, value: {} });
    diagnostics.observeReceptionTransport({
      ok: true,
      value: {
        status: 200,
        mediaType: "application/json",
        body: JSON.stringify({ trackId: "not-emitted", error: sensitive, mensaje: sensitive }),
      },
    });

    expect(legacyFields(diagnostics)).toEqual([
      { field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" },
      { field: "HTTP_STATUS", value: "200" },
      { field: "RESPONSE_MEDIA_TYPE", value: "application/json" },
    ]);
  });

  it("keeps a short human-readable DGII message while suppressing only its sensitive peer", () => {
    const diagnostics = createTesteCfEcf31ProbeDiagnostics();
    diagnostics.observeAuthorization({ ok: true, value: {} });
    diagnostics.observeReceptionTransport({
      ok: true,
      value: {
        status: 200,
        mediaType: "application/json",
        body: '{"trackId":"not-emitted","error":"Código rechazado","mensaje":"Authorization: Bearer opaque-value"}',
      },
    });

    expect(legacyFields(diagnostics)).toEqual([
      { field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" },
      { field: "HTTP_STATUS", value: "200" },
      { field: "RESPONSE_MEDIA_TYPE", value: "application/json" },
      { field: "DGII_ERROR", value: "Código rechazado" },
    ]);
  });

  it("keeps a short human-readable DGII message", () => {
    const diagnostics = createTesteCfEcf31ProbeDiagnostics();
    diagnostics.observeAuthorization({ ok: true, value: {} });
    diagnostics.observeReceptionTransport({
      ok: true,
      value: {
        status: 200,
        mediaType: "application/json",
        body: '{"trackId":"not-emitted","error":null,"mensaje":"Documento rechazado por datos incompletos"}',
      },
    });

    expect(legacyFields(diagnostics)).toEqual([
      { field: "FAILURE_STAGE", value: "RECEPTION_HTTP_RESPONSE" },
      { field: "HTTP_STATUS", value: "200" },
      { field: "RESPONSE_MEDIA_TYPE", value: "application/json" },
      { field: "DGII_MESSAGE", value: "Documento rechazado por datos incompletos" },
    ]);
  });

  it.each([
    "password=hunter2",
    "Authorization: Bearer opaque-value",
    "token=opaque-value",
    "X-Api-Key: opaque-value",
    "Header: opaque-value",
    "-----BEGIN CERTIFICATE-----",
    "message\u0000hidden",
  ])("redacts sensitive top-level probe output: %s", (sensitive) => {
    expect(redactTesteCfProbeOutput(sensitive)).toBe("<REDACTED-SENSITIVE>");
  });

  it("preserves JWT redaction for top-level probe output", () => {
    expect(redactTesteCfProbeOutput("DGII token eyJhbGciOiJIUzI1NiJ9.payload.signature rejected")).toBe("DGII token <REDACTED-JWT> rejected");
  });

  it("fails closed when top-level output cannot be converted to text", () => {
    expect(redactTesteCfProbeOutput(Object.create(null))).toBe("<REDACTED-SENSITIVE>");
  });
});
