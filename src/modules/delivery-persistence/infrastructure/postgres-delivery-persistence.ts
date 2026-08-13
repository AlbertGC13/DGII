import { types } from "node:util";

export type DeliveryPersistenceQueryClient = Readonly<{ query(text: string, values?: readonly unknown[]): Promise<unknown> }>;
export type RecordAcknowledgedAttemptInput = Readonly<{ allocationKey: string; attemptKey: string; environment: "TesteCF" | "CerteCF" | "production"; signedXmlSha256: string; trackId: string }>;
export type AppendDeliveryEventInput = Readonly<{ allocationKey: string; attemptKey: string; eventKey: string; kind: "RECEPTION_ACKNOWLEDGED" | "POLLING_DEADLINE_EXPIRED" | "POLLING_CANCELLED" | "POLLING_ERROR" }> | Readonly<{ allocationKey: string; attemptKey: string; eventKey: string; kind: "RESULT_OBSERVED"; evidence: Readonly<{ trackId: string; codigo: 0 | 1 | 2 | 3 | 4; estado: string; rnc: string | null; eNCF: string | null; fechaRecepcion: string | null; mensajes: readonly string[]; secuenciaUtilizada: boolean | null; sequenceDisposition: "consumed-non-reusable" | "potentially-reusable-no-blind-resend" | null }> }>;
export type RecordAcknowledgedAttemptOutcome = Readonly<{ outcome: "recorded" | "replayed"; attemptNo: number; acknowledgedAt: string }> | Readonly<{ outcome: "conflict" | "track_id_conflict" | "missing_allocation" | "invalid_attempt" | "persistence_unavailable" }>;
export type AppendDeliveryEventOutcome = Readonly<{ outcome: "appended" | "replayed"; eventId: bigint; stateApplied: boolean; anomaly: boolean }> | Readonly<{ outcome: "conflict" | "missing_attempt" | "invalid_event" | "persistence_unavailable" }>;
export type DeliveryPersistence = Readonly<{ recordAcknowledgedAttempt(input: unknown): Promise<RecordAcknowledgedAttemptOutcome>; appendEvent(input: unknown): Promise<AppendDeliveryEventOutcome> }>;

type Bound = Readonly<{ client: DeliveryPersistenceQueryClient; scopeId: string }>;
type Evidence = Extract<AppendDeliveryEventInput, { kind: "RESULT_OBSERVED" }>["evidence"];
const attemptQuery = "SELECT outcome, attempt_no, acknowledged_at::text AS acknowledged_at FROM record_ecf31_delivery_attempt($1, $2, $3, $4, $5, $6, $7)";
const eventQuery = "SELECT outcome, event_id::text AS event_id, state_applied, anomaly FROM append_ecf31_delivery_event($1, $2, $3, $4, $5, $6, $7::smallint, $8, $9, $10, $11, $12::jsonb, $13)";
const timestamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-3])(?::?[0-5]\d)?|[+-]14(?::?00)?)$/u;
const own = (value: object, key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
const text = (value: unknown, maximum: number): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= maximum && !/[\p{Cc}]/u.test(value);
const maximumEventId = "9223372036854775807";

function shape(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const inputKeys = Reflect.ownKeys(value);
    if (types.isProxy(value) || inputKeys.length !== keys.length || !keys.every((key) => inputKeys.includes(key))) return undefined;
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      /* v8 ignore next -- a non-proxy own-key/descriptor mismatch cannot be constructed. */
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch { return undefined; }
}

function array(value: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    const length = value.length; const keys = Reflect.ownKeys(value);
    if (types.isProxy(value) || !Number.isSafeInteger(length) || keys.length !== length + 1 || !keys.includes("length")) return undefined;
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch { return undefined; }
}
const unavailableAttempt = (): RecordAcknowledgedAttemptOutcome => ({ outcome: "persistence_unavailable" });
const unavailableEvent = (): AppendDeliveryEventOutcome => ({ outcome: "persistence_unavailable" });

function bound(value: unknown): Bound | undefined {
  const input = shape(value, ["client", "scopeId"]);
  if (input === undefined) return undefined;
  const client = own(input, "client"); const scopeId = own(input, "scopeId");
  const clientInput = shape(client, ["query"]);
  return clientInput !== undefined && typeof own(clientInput, "query") === "function" && text(scopeId, 256) ? Object.freeze({ client: client as DeliveryPersistenceQueryClient, scopeId }) : undefined;
}

function attempt(value: unknown): RecordAcknowledgedAttemptInput | undefined {
  const input = shape(value, ["allocationKey", "attemptKey", "environment", "signedXmlSha256", "trackId"]);
  if (input === undefined) return undefined;
  const allocationKey = own(input, "allocationKey"); const attemptKey = own(input, "attemptKey"); const environment = own(input, "environment"); const signedXmlSha256 = own(input, "signedXmlSha256"); const trackId = own(input, "trackId");
  return text(allocationKey, 128) && text(attemptKey, 128) && (environment === "TesteCF" || environment === "CerteCF" || environment === "production") && typeof signedXmlSha256 === "string" && /^[0-9a-f]{64}$/u.test(signedXmlSha256) && text(trackId, 256) ? { allocationKey, attemptKey, environment, signedXmlSha256, trackId } : undefined;
}

function canonicalEvidence(value: unknown): Evidence | undefined {
  const input = shape(value, ["trackId", "codigo", "estado", "rnc", "eNCF", "fechaRecepcion", "mensajes", "secuenciaUtilizada", "sequenceDisposition"]);
  if (input === undefined) return undefined;
  const trackId = own(input, "trackId"); const codigo = own(input, "codigo"); const estado = own(input, "estado"); const rnc = own(input, "rnc"); const eNCF = own(input, "eNCF"); const fechaRecepcion = own(input, "fechaRecepcion"); const mensajes = array(own(input, "mensajes")); const secuenciaUtilizada = own(input, "secuenciaUtilizada"); const sequenceDisposition = own(input, "sequenceDisposition");
  if (!text(trackId, 256) || typeof codigo !== "number" || !Number.isInteger(codigo) || codigo < 0 || codigo > 4 || !text(estado, 256) || ![rnc, eNCF].every((item) => item === null || text(item, 32)) || (fechaRecepcion !== null && !text(fechaRecepcion, 256)) || mensajes === undefined || mensajes.length > 100 || !mensajes.every((message) => text(message, 256))) return undefined;
  if ((codigo === 0 || codigo === 3) && (rnc !== null || eNCF !== null || fechaRecepcion !== null || mensajes.length !== 0 || secuenciaUtilizada !== null || sequenceDisposition !== null)) return undefined;
  if ((codigo === 1 || codigo === 4) && (secuenciaUtilizada !== null || sequenceDisposition !== null)) return undefined;
  if (codigo === 2 && (typeof secuenciaUtilizada !== "boolean" || sequenceDisposition !== (secuenciaUtilizada ? "consumed-non-reusable" : "potentially-reusable-no-blind-resend"))) return undefined;
  return Object.freeze({ trackId, codigo: codigo as Evidence["codigo"], estado, rnc: rnc as string | null, eNCF: eNCF as string | null, fechaRecepcion, mensajes, secuenciaUtilizada: secuenciaUtilizada as boolean | null, sequenceDisposition: sequenceDisposition as Evidence["sequenceDisposition"] });
}

function event(value: unknown): AppendDeliveryEventInput | undefined {
  const input = shape(value, ["allocationKey", "attemptKey", "eventKey", "kind"]) ?? shape(value, ["allocationKey", "attemptKey", "eventKey", "kind", "evidence"]);
  if (input === undefined) return undefined;
  const allocationKey = own(input, "allocationKey"); const attemptKey = own(input, "attemptKey"); const eventKey = own(input, "eventKey"); const kind = own(input, "kind");
  if (!text(allocationKey, 128) || !text(attemptKey, 128) || !text(eventKey, 128)) return undefined;
  if (kind === "RESULT_OBSERVED") { const evidence = canonicalEvidence(own(input, "evidence")); return evidence === undefined ? undefined : { allocationKey, attemptKey, eventKey, kind, evidence }; }
  return kind === "RECEPTION_ACKNOWLEDGED" || kind === "POLLING_DEADLINE_EXPIRED" || kind === "POLLING_CANCELLED" || kind === "POLLING_ERROR" ? { allocationKey, attemptKey, eventKey, kind } : undefined;
}

function oneRow(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "rows");
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    const rows = array(descriptor.value);
    return rows?.length === 1 ? shape(rows[0], keys) : undefined;
  } catch { return undefined; }
}

function recorded(row: Record<string, unknown>): RecordAcknowledgedAttemptOutcome | undefined {
  const outcome = own(row, "outcome"); const number = own(row, "attempt_no"); const acknowledgedAt = own(row, "acknowledged_at");
  if ((outcome === "recorded" || outcome === "replayed") && Number.isSafeInteger(number) && (number as number) > 0 && typeof acknowledgedAt === "string" && timestamp.test(acknowledgedAt) && !Number.isNaN(Date.parse(acknowledgedAt))) return { outcome, attemptNo: number as number, acknowledgedAt };
  return (outcome === "conflict" || outcome === "track_id_conflict" || outcome === "missing_allocation" || outcome === "invalid_attempt") && number === null && acknowledgedAt === null ? { outcome } : undefined;
}

function appended(row: Record<string, unknown>): AppendDeliveryEventOutcome | undefined {
  const outcome = own(row, "outcome"); const eventId = own(row, "event_id"); const stateApplied = own(row, "state_applied"); const anomaly = own(row, "anomaly");
  if ((outcome === "appended" || outcome === "replayed") && typeof eventId === "string" && /^[1-9]\d*$/u.test(eventId) && (eventId.length < maximumEventId.length || eventId.length === maximumEventId.length && eventId <= maximumEventId) && typeof stateApplied === "boolean" && typeof anomaly === "boolean") return { outcome, eventId: BigInt(eventId), stateApplied, anomaly };
  return (outcome === "conflict" || outcome === "missing_attempt" || outcome === "invalid_event") && eventId === null && stateApplied === null && anomaly === null ? { outcome } : undefined;
}

/** Binds a trusted scope to a caller-owned transaction client; it performs no authorization or transaction control. */
export function createPostgresDeliveryPersistence(value: unknown): DeliveryPersistence {
  const values = bound(value);
  return Object.freeze({ async recordAcknowledgedAttempt(input) {
    const request = attempt(input); if (!request || !values) return request ? unavailableAttempt() : { outcome: "invalid_attempt" };
    try { const row = oneRow(await values.client.query(attemptQuery, [values.scopeId, "E31", request.allocationKey, request.attemptKey, request.environment === "TesteCF" ? "testecf" : request.environment === "CerteCF" ? "certecf" : "ecf", request.signedXmlSha256, request.trackId]), ["outcome", "attempt_no", "acknowledged_at"]); return row === undefined ? unavailableAttempt() : recorded(row) ?? unavailableAttempt(); } catch { return unavailableAttempt(); }
  }, async appendEvent(input) {
    const request = event(input); if (!request || !values) return request ? unavailableEvent() : { outcome: "invalid_event" };
    const evidence = request.kind === "RESULT_OBSERVED" ? request.evidence : undefined;
    try { const row = oneRow(await values.client.query(eventQuery, [values.scopeId, "E31", request.allocationKey, request.attemptKey, request.eventKey, request.kind, evidence?.codigo ?? null, evidence?.estado ?? null, evidence?.rnc ?? null, evidence?.eNCF ?? null, evidence?.fechaRecepcion ?? null, JSON.stringify(evidence?.mensajes ?? []), evidence?.secuenciaUtilizada ?? null]), ["outcome", "event_id", "state_applied", "anomaly"]); return row === undefined ? unavailableEvent() : appended(row) ?? unavailableEvent(); } catch { return unavailableEvent(); }
  } });
}
