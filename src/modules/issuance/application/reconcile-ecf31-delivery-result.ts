import { types } from "node:util";

import type { Result } from "../../../shared/domain/result.js";

type Reason = "deadline_expired" | "cancelled" | "scheduler_error";
type Disposition = "consumed-non-reusable" | "potentially-reusable-no-blind-resend" | null;
type Outcome =
  | Readonly<{ outcome: "reconciled"; trackId: string; codigo: 1 | 2 | 4; sequenceDisposition: Disposition; replayed: boolean }>
  | Readonly<{ outcome: "reconcilable"; trackId: string; reason: Reason; replayed: boolean }>
  | Readonly<{ outcome: "superseded"; trackId: string; replayed: boolean }>
  | Readonly<{ outcome: "invalid_request" | "polling_unusable" | "attempt_not_found" | "attempt_not_reconcilable" | "ledger_refused" | "persistence_unavailable" }>;
type Error = Readonly<{ code: "INVALID_ECF31_DELIVERY_RESULT_RECONCILER_CONFIGURATION" }>;
type Methods = Readonly<{ appendEvent(input: unknown): Promise<unknown> }>;
type Planned =
  | Readonly<{ eventKey: string; kind: "RESULT_OBSERVED"; codigo: 1 | 2 | 4; sequenceDisposition: Disposition; evidence: Readonly<Record<string, unknown>> }>
  | Readonly<{ eventKey: string; kind: "POLLING_DEADLINE_EXPIRED" | "POLLING_CANCELLED" | "POLLING_ERROR"; reason: Reason }>;
export type Ecf31DeliveryResultReconciler = Readonly<{ reconcile(input: unknown): Promise<Outcome> }>;

const scheduledEvidenceKeys = ["trackId", "codigo", "classification", "estado", "rnc", "eNCF", "fechaRecepcion", "mensajes", "secuenciaUtilizada", "sequenceDisposition"] as const;
const failure = (): Result<never, Error> => Object.freeze({ ok: false, error: Object.freeze({ code: "INVALID_ECF31_DELIVERY_RESULT_RECONCILER_CONFIGURATION" }) });
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const text = (value: unknown, maximum: number): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= maximum && !/[\p{Cc}]/u.test(value);
const pending = (eventKey: string, kind: Planned["kind"], reason: Reason): Planned => freeze({ eventKey, kind: kind as "POLLING_DEADLINE_EXPIRED", reason });

function record(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const found = Reflect.ownKeys(value); if (found.length !== keys.length || !keys.every((key) => found.includes(key))) return undefined;
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined; snapshot[key] = descriptor.value; }
    return freeze(snapshot);
  } catch {
    /* v8 ignore next -- Proxy values are rejected before reflection. */
    return undefined;
  }
}

function port(value: unknown, keys: readonly string[]): Readonly<Record<string, (...arguments_: unknown[]) => unknown>> | undefined {
  const candidate = record(value, keys); if (!candidate) return undefined;
  const methods: Record<string, (...arguments_: unknown[]) => unknown> = {};
  for (const key of keys) { const method = candidate[key]; if (typeof method !== "function" || types.isProxy(method)) return undefined; methods[key] = method as (...arguments_: unknown[]) => unknown; }
  return freeze(methods);
}

function input(value: unknown): Readonly<{ allocationKey: string; attemptKey: string; trackId: string; receivedAt: number; signal: unknown }> | undefined {
  const candidate = record(value, ["allocationKey", "attemptKey", "trackId", "receivedAt"]) ?? record(value, ["allocationKey", "attemptKey", "trackId", "receivedAt", "signal"]); if (!candidate) return undefined;
  const { allocationKey, attemptKey, trackId, receivedAt, signal } = candidate;
  const usableSignal = signal === undefined || typeof signal === "object" && signal !== null && typeof (signal as AbortSignal).aborted === "boolean";
  return text(allocationKey, 128) && text(attemptKey, 128) && text(trackId, 256) && Number.isSafeInteger(receivedAt) && usableSignal ? freeze({ allocationKey, attemptKey, trackId, receivedAt: receivedAt as number, signal }) : undefined;
}

/** Projects the nine ledger evidence fields one by one; a spread would forward `classification` and the ledger rejects unknown keys. */
function observed(value: unknown, requested: string): Planned | undefined {
  const found = record(value, scheduledEvidenceKeys); if (!found) return undefined;
  const codigo = found["codigo"]; const sequenceDisposition = found["sequenceDisposition"];
  if (found["trackId"] !== requested || codigo !== 1 && codigo !== 2 && codigo !== 4 || sequenceDisposition !== null && sequenceDisposition !== "consumed-non-reusable" && sequenceDisposition !== "potentially-reusable-no-blind-resend") return undefined;
  return freeze({ eventKey: `result-observed-v1-codigo-${String(codigo)}`, kind: "RESULT_OBSERVED", codigo, sequenceDisposition, evidence: freeze({ trackId: requested, codigo, estado: found["estado"], rnc: found["rnc"], eNCF: found["eNCF"], fechaRecepcion: found["fechaRecepcion"], mensajes: found["mensajes"], secuenciaUtilizada: found["secuenciaUtilizada"], sequenceDisposition }) });
}

/**
 * `PENDING_RECONCILIATION.lastEvidence` is deliberately discarded: the scheduler only carries a
 * non-terminal codigo there, and persisting it would move `latest_result_event_id` onto a sighting
 * that is not a delivery result and split one reconciliation into two events.
 */
function plan(value: unknown, requested: string): Planned | undefined {
  const found = record(value, ["kind", "trackId", "evidence"]) ?? record(value, ["kind", "trackId", "lastEvidence"]) ?? record(value, ["kind", "trackId"]); if (!found || found["trackId"] !== requested) return undefined;
  const kind = found["kind"];
  if (kind === "TERMINAL") return observed(found["evidence"], requested);
  if (kind === "PENDING_RECONCILIATION") return pending("polling-deadline-expired-v1", "POLLING_DEADLINE_EXPIRED", "deadline_expired");
  if (kind === "CANCELLED") return pending("polling-cancelled-v1", "POLLING_CANCELLED", "cancelled");
  return kind === "SCHEDULER_ERROR" ? pending("polling-error-v1", "POLLING_ERROR", "scheduler_error") : undefined;
}

function mapped(value: unknown, planned: Planned, trackId: string): Outcome {
  const success = record(value, ["outcome", "eventId", "stateApplied", "anomaly"]); const settled = success?.["outcome"];
  if (settled === "appended" || settled === "replayed") {
    const replayed = settled === "replayed";
    if (success?.["stateApplied"] !== true || success["anomaly"] !== false) return freeze({ outcome: "superseded", trackId, replayed });
    return planned.kind === "RESULT_OBSERVED" ? freeze({ outcome: "reconciled", trackId, codigo: planned.codigo, sequenceDisposition: planned.sequenceDisposition, replayed }) : freeze({ outcome: "reconcilable", trackId, reason: planned.reason, replayed });
  }
  const refusal = record(value, ["outcome"])?.["outcome"];
  return freeze({ outcome: refusal === "missing_attempt" ? "attempt_not_found" : refusal === "invalid_transition" ? "attempt_not_reconcilable" : refusal === "conflict" || refusal === "invalid_event" ? "ledger_refused" : "persistence_unavailable" });
}

/** Reconciles one acknowledged e-CF 31 delivery attempt through ports only; it constructs nothing and never resends. */
export function createEcf31DeliveryResultReconciler(configuration: unknown): Result<Ecf31DeliveryResultReconciler, Error> {
  const config = record(configuration, ["polling", "transactions"]); const polling = port(config?.["polling"], ["poll"]); const transactions = port(config?.["transactions"], ["run"]); const poll = polling?.["poll"]; const transaction = transactions?.["run"];
  if (!config || !polling || !transactions || !poll || !transaction) return failure();
  const run = async (work: (persistence: Methods) => Promise<unknown>): Promise<unknown> => {
    try { const committed = record(await transaction(async (candidate: unknown) => { const methods = port(candidate, ["prepareAttempt", "appendEvent", "acknowledgeAttempt", "recordAcknowledgedAttempt"]); return methods ? work(methods as unknown as Methods) : undefined; }), ["outcome", "value"]); return committed?.["outcome"] === "committed" ? committed["value"] : undefined; } catch { return undefined; }
  };
  return freeze({ ok: true, value: freeze({ async reconcile(inputValue: unknown): Promise<Outcome> {
    const requested = input(inputValue); if (!requested) return freeze({ outcome: "invalid_request" });
    let polled: unknown; try { polled = await poll(freeze({ trackId: requested.trackId, receivedAt: requested.receivedAt, signal: requested.signal })); } catch { return freeze({ outcome: "polling_unusable" }); }
    const planned = plan(polled, requested.trackId); if (!planned) return freeze({ outcome: "polling_unusable" });
    const identifiers = { allocationKey: requested.allocationKey, attemptKey: requested.attemptKey, eventKey: planned.eventKey };
    const appended = await run(async (persistence) => persistence.appendEvent(planned.kind === "RESULT_OBSERVED" ? freeze({ ...identifiers, kind: planned.kind, evidence: planned.evidence }) : freeze({ ...identifiers, kind: planned.kind })));
    return mapped(appended, planned, requested.trackId);
  } }) });
}
