import { types } from "node:util";

import { isEcf31IdDocIssuanceEvidence } from "../../builder/index.js";
import { isVerifiedSignedXmlArtifact } from "../../xml-signer/index.js";
import type { Result } from "../../../shared/domain/result.js";

type Environment = "TesteCF" | "CerteCF" | "production";
type Outcome = Readonly<{ outcome: "acknowledged"; trackId: string }> | Readonly<{ outcome: "outcome_unknown"; trackId?: string }> | Readonly<{ outcome: "invalid_request" | "preparation_failed" | "delivery_not_ready" | "delivery_conflict" | "persistence_unavailable" | "automatic_resend_blocked" }>;
type Error = Readonly<{ code: "INVALID_ECF31_DELIVERY_COORDINATOR_CONFIGURATION" }>;
type Methods = Readonly<{ prepareAttempt(input: unknown): Promise<unknown>; appendEvent(input: unknown): Promise<unknown>; acknowledgeAttempt(input: unknown): Promise<unknown> }>;
export type Ecf31DeliveryCoordinator = Readonly<{ coordinate(input: unknown): Promise<Outcome> }>;

const failure = (): Result<never, Error> => Object.freeze({ ok: false, error: Object.freeze({ code: "INVALID_ECF31_DELIVERY_COORDINATOR_CONFIGURATION" }) });
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const text = (value: unknown, maximum: number): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= maximum && !/[\p{Cc}]/u.test(value);

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

function input(value: unknown): Readonly<{ allocationKey: string; attemptKey: string; environment: Environment; evidence: unknown }> | undefined {
  const candidate = record(value, ["allocationKey", "attemptKey", "environment", "evidence"]); if (!candidate) return undefined;
  const { allocationKey, attemptKey, environment, evidence } = candidate;
  return text(allocationKey, 128) && text(attemptKey, 128) && (environment === "TesteCF" || environment === "CerteCF" || environment === "production") ? freeze({ allocationKey, attemptKey, environment, evidence }) : undefined;
}

function prepared(value: unknown): Readonly<{ artifact: object; signedXmlSha256: string }> | undefined {
  const result = record(value, ["ok", "value"]); const output = result?.["ok"] === true ? record(result["value"], ["artifact", "signedXmlSha256"]) : undefined;
  return output && isVerifiedSignedXmlArtifact(output["artifact"]) && typeof output["signedXmlSha256"] === "string" && /^[0-9a-f]{64}$/u.test(output["signedXmlSha256"]) ? freeze({ artifact: output["artifact"], signedXmlSha256: output["signedXmlSha256"] }) : undefined;
}

function invalidPreparation(value: unknown): boolean { const result = record(value, ["ok", "error"]); const error = result?.["ok"] === false ? record(result["error"], ["code"]) : undefined; return error?.["code"] === "INVALID_ECF31_DELIVERY_PREPARATION_INPUT"; }
function committed(value: unknown): unknown { const result = record(value, ["outcome", "value"]); return result?.["outcome"] === "committed" ? result["value"] : undefined; }
function identity(evidence: unknown): Readonly<{ eNcf: string; issuerRnc: string }> | undefined {
  const packageValue = record(evidence, ["issuanceEvidence", "draft", "derivedHeaderTotalsEvidence", "detallesItemsEvidence", "fechaHoraFirma"]) ?? record(evidence, ["issuanceEvidence", "draft", "derivedHeaderTotalsEvidence", "detallesItemsEvidence", "priceInclusionEvidence", "fechaHoraFirma"]);
  if (!packageValue || !isEcf31IdDocIssuanceEvidence(packageValue["issuanceEvidence"])) return undefined;
  const header = packageValue["issuanceEvidence"].header;
  return freeze({ eNcf: header.eNcf.value, issuerRnc: header.issuer.taxpayerIdentifier.value });
}

function preparationOutcome(value: unknown): Outcome | undefined {
  const outcome = record(value, ["outcome"])?.["outcome"];
  return outcome === "missing_allocation" || outcome === "missing_snapshot" ? freeze({ outcome: "delivery_not_ready" }) : outcome === "conflict" ? freeze({ outcome: "delivery_conflict" }) : outcome === "invalid_attempt" ? freeze({ outcome: "invalid_request" }) : outcome === "persistence_unavailable" ? freeze({ outcome: "persistence_unavailable" }) : undefined;
}
function started(value: unknown): boolean { const event = record(value, ["outcome", "eventId", "stateApplied", "anomaly"]); return event?.["outcome"] === "appended" && event["stateApplied"] === true && event["anomaly"] === false; }
function track(value: unknown): string | undefined { const result = record(value, ["ok", "value"]); const output = result?.["ok"] === true ? record(result["value"], ["trackId"]) : undefined; return output && text(output["trackId"], 256) ? output["trackId"] : undefined; }

/** Coordinates verified e-CF 31 delivery without turning ambiguous reception into a resend. */
export function createEcf31DeliveryCoordinator(configuration: unknown): Result<Ecf31DeliveryCoordinator, Error> {
  const config = record(configuration, ["preparation", "transactions", "reception"]); const preparation = port(config?.["preparation"], ["prepare"]); const transactions = port(config?.["transactions"], ["run"]); const reception = port(config?.["reception"], ["submit"]); const prepare = preparation?.["prepare"]; const transaction = transactions?.["run"]; const submit = reception?.["submit"];
  if (!config || !preparation || !transactions || !reception || !prepare || !transaction || !submit) return failure();
  const run = async (work: (persistence: Methods) => Promise<unknown>): Promise<unknown> => {
    try { return committed(await transaction(async (candidate: unknown) => { const methods = port(candidate, ["prepareAttempt", "appendEvent", "acknowledgeAttempt", "recordAcknowledgedAttempt"]); return methods ? work(methods as unknown as Methods) : undefined; })); } catch { return undefined; }
  };
  const unknown = async (request: Readonly<{ allocationKey: string; attemptKey: string }>): Promise<void> => { await run(async (persistence) => persistence.appendEvent(freeze({ ...request, eventKey: "outcome-unknown-v1", kind: "OUTCOME_UNKNOWN" }))); };
  return freeze({ ok: true, value: freeze({ async coordinate(inputValue: unknown): Promise<Outcome> {
    const request = input(inputValue); if (!request) return freeze({ outcome: "invalid_request" });
    let local: unknown; try { local = await prepare(request.evidence); } catch { return freeze({ outcome: "preparation_failed" }); }
    const preparedValue = prepared(local); if (!preparedValue) return freeze({ outcome: invalidPreparation(local) ? "invalid_request" : "preparation_failed" });
    const derived = identity(request.evidence); if (!derived) return freeze({ outcome: "preparation_failed" });
    const attempt = await run(async (persistence) => persistence.prepareAttempt(freeze({ allocationKey: request.allocationKey, attemptKey: request.attemptKey, environment: request.environment, ...preparedValue, ...derived }))); const attemptFailure = preparationOutcome(attempt); if (attemptFailure) return attemptFailure;
    if (!record(attempt, ["outcome", "attemptNo"]) || !["prepared", "replayed"].includes(record(attempt, ["outcome", "attemptNo"])?.["outcome"] as string)) return freeze({ outcome: "persistence_unavailable" });
    const start = await run(async (persistence) => persistence.appendEvent(freeze({ allocationKey: request.allocationKey, attemptKey: request.attemptKey, eventKey: "post-started-v1", kind: "POST_STARTED" }))); if (start === undefined || record(start, ["outcome"])?.["outcome"] === "persistence_unavailable") return freeze({ outcome: "persistence_unavailable" }); if (!started(start)) return freeze({ outcome: "automatic_resend_blocked" });
    let receptionResult: unknown; try { receptionResult = await submit(preparedValue.artifact); } catch { await unknown(request); return freeze({ outcome: "outcome_unknown" }); }
    const trackId = track(receptionResult); if (!trackId) { await unknown(request); return freeze({ outcome: "outcome_unknown" }); }
    const acknowledged = await run(async (persistence) => { const acknowledgement = await persistence.acknowledgeAttempt(freeze({ allocationKey: request.allocationKey, attemptKey: request.attemptKey, environment: request.environment, trackId })); if (record(acknowledgement, ["outcome", "attemptNo", "acknowledgedAt"])?.["outcome"] !== "recorded" && record(acknowledgement, ["outcome", "attemptNo", "acknowledgedAt"])?.["outcome"] !== "replayed") throw new Error("ROLLBACK"); const event = await persistence.appendEvent(freeze({ allocationKey: request.allocationKey, attemptKey: request.attemptKey, eventKey: "reception-acknowledged-v1", kind: "RECEPTION_ACKNOWLEDGED" })); if (!started(event)) throw new Error("ROLLBACK"); return true; });
    if (acknowledged !== true) { await unknown(request); return freeze({ outcome: "outcome_unknown", trackId }); }
    return freeze({ outcome: "acknowledged", trackId });
  } }) });
}
