import type { Result } from "../../../shared/domain/result.js";
import type { DgiiResultConsultation, DgiiResultEvidence } from "./dgii-result-consultation.js";

export type DgiiResultPollingSchedulerError = Readonly<{ code: "INVALID_DGII_RESULT_POLLING_SCHEDULER_CONFIGURATION" }>;
export type DgiiResultPollingOutcome = Readonly<{ kind: "TERMINAL"; trackId: string; evidence: DgiiResultEvidence }> | Readonly<{ kind: "PENDING_RECONCILIATION"; trackId: string; lastEvidence?: DgiiResultEvidence }> | Readonly<{ kind: "CANCELLED"; trackId: string }> | Readonly<{ kind: "SCHEDULER_ERROR"; trackId: string }>;
export type DgiiResultPollingScheduler = Readonly<{ poll(input: Readonly<{ trackId: string; receivedAt: number; signal?: AbortSignal }>): Promise<DgiiResultPollingOutcome> }>;
type Dependencies = Readonly<{ clock: () => number; sleeper: (delay: number, signal: AbortSignal) => Promise<void>; random: () => number; consultation: Pick<DgiiResultConsultation, "consult"> }>;

const DEADLINE_MS = 120_000;
const BASE_DELAYS = [1_000, 2_000, 5_000, 15_000, 30_000] as const;
const EVIDENCE_KEYS = ["trackId", "codigo", "classification", "estado", "rnc", "eNCF", "fechaRecepcion", "mensajes", "secuenciaUtilizada", "sequenceDisposition"] as const;
const own = (value: object, key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
const safeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const trackId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 256 && !Array.from(value).some((character) => { const point = character.codePointAt(0); return point !== undefined && (point <= 31 || point === 127); });
const disposition = (value: unknown): value is DgiiResultEvidence["sequenceDisposition"] => value === null || value === "consumed-non-reusable" || value === "potentially-reusable-no-blind-resend";
const used = (value: unknown): value is boolean | null => value === null || typeof value === "boolean";
const frozen = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const exact = (value: object, keys: readonly string[]): boolean => Object.getPrototypeOf(value) === Object.prototype && Object.isFrozen(value) && Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
const outcome = (kind: DgiiResultPollingOutcome["kind"], track: string, evidence?: DgiiResultEvidence): DgiiResultPollingOutcome => kind === "TERMINAL" ? frozen({ kind, trackId: track, evidence: evidence as DgiiResultEvidence }) : kind === "PENDING_RECONCILIATION" && evidence !== undefined ? frozen({ kind, trackId: track, lastEvidence: evidence }) : frozen({ kind, trackId: track });
const aborted = (signal: AbortSignal): boolean => Reflect.get(signal, "aborted");

function dependencies(value: unknown): Dependencies | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 4) return undefined;
    const clock = own(value, "clock"); const sleeper = own(value, "sleeper"); const random = own(value, "random"); const consultation = own(value, "consultation");
    if (typeof clock !== "function" || typeof sleeper !== "function" || typeof random !== "function" || typeof consultation !== "object" || consultation === null || Object.getPrototypeOf(consultation) !== Object.prototype || Reflect.ownKeys(consultation).length !== 1 || typeof own(consultation, "consult") !== "function") return undefined;
    return frozen({ clock: clock as Dependencies["clock"], sleeper: sleeper as Dependencies["sleeper"], random: random as Dependencies["random"], consultation: consultation as Dependencies["consultation"] });
  } catch { return undefined; }
}

function request(value: unknown): Readonly<{ trackId: string; receivedAt: number; signal: AbortSignal }> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const id = own(value, "trackId"); const receivedAt = own(value, "receivedAt"); const signal = own(value, "signal");
    if (!trackId(id) || !safeInteger(receivedAt) || receivedAt > Number.MAX_SAFE_INTEGER - DEADLINE_MS || (signal !== undefined && (typeof signal !== "object" || signal === null || typeof (signal as AbortSignal).aborted !== "boolean"))) return undefined;
    return frozen({ trackId: id, receivedAt, signal: (signal ?? new AbortController().signal) as AbortSignal });
  } catch { return undefined; }
}

function evidence(value: unknown, requestedTrackId: string): DgiiResultEvidence | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !exact(value, EVIDENCE_KEYS)) return undefined;
    const id = own(value, "trackId"); const codigo = own(value, "codigo"); const classification = own(value, "classification"); const estado = own(value, "estado"); const rnc = own(value, "rnc"); const eNCF = own(value, "eNCF"); const fechaRecepcion = own(value, "fechaRecepcion"); const mensajes = own(value, "mensajes"); const secuenciaUtilizada = own(value, "secuenciaUtilizada"); const sequenceDisposition = own(value, "sequenceDisposition");
    const classifications = ["indeterminate", "accepted", "rejected", "in-process", "accepted-conditional"] as const;
    if (!trackId(id) || id !== requestedTrackId || !safeInteger(codigo) || codigo < 0 || codigo > 4 || classification !== classifications[codigo] || !trackId(estado) || ![rnc, eNCF, fechaRecepcion].every((item) => item === null || trackId(item)) || !Array.isArray(mensajes) || !Object.isFrozen(mensajes) || mensajes.length > 100 || !used(secuenciaUtilizada) || !disposition(sequenceDisposition)) return undefined;
    const messageSnapshot: string[] = [];
    for (let index = 0; index < mensajes.length; index += 1) {
      const message = own(mensajes, String(index));
      if (message === undefined || !trackId(message)) return undefined;
      messageSnapshot.push(message);
    }
    return frozen({ trackId: id, codigo: codigo as DgiiResultEvidence["codigo"], classification: classification as DgiiResultEvidence["classification"], estado, rnc: rnc as string | null, eNCF: eNCF as string | null, fechaRecepcion: fechaRecepcion as string | null, mensajes: frozen(messageSnapshot), secuenciaUtilizada, sequenceDisposition });
  } catch { return undefined; }
}

function consultationResult(value: unknown, requestedTrackId: string): DgiiResultEvidence | "failure" | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || !Object.isFrozen(value)) return undefined;
    if (exact(value, ["ok", "value"]) && own(value, "ok") === true) return evidence(own(value, "value"), requestedTrackId);
    return exact(value, ["ok", "error"]) && own(value, "ok") === false ? "failure" : undefined;
  } catch { return undefined; }
}

/** Polls only through the supplied one-shot capability. The sleeper and monotonic clock are coupled: every positive sleep must advance the clock by at least its requested duration. */
export function createDgiiResultPollingScheduler(value: unknown): Result<DgiiResultPollingScheduler, DgiiResultPollingSchedulerError> {
  const values = dependencies(value);
  if (!values) return { ok: false, error: frozen({ code: "INVALID_DGII_RESULT_POLLING_SCHEDULER_CONFIGURATION" }) };
  return { ok: true, value: frozen({ async poll(input) {
    const task = request(input); if (!task) return frozen({ kind: "SCHEDULER_ERROR", trackId: "" });
    let lastEvidence: DgiiResultEvidence | undefined; let observed = task.receivedAt;
    const clock = (): number | undefined => { const next = values.clock(); if (!safeInteger(next) || next < observed) return undefined; observed = next; return next; };
    try {
      const deadline = task.receivedAt + DEADLINE_MS;
      const started = clock(); if (started === undefined || started < task.receivedAt) return outcome("SCHEDULER_ERROR", task.trackId);
      for (let attempt = 0; ; attempt += 1) {
        if (aborted(task.signal)) return outcome("CANCELLED", task.trackId);
        const remaining = deadline - observed; if (remaining <= 0) return outcome("PENDING_RECONCILIATION", task.trackId, lastEvidence);
        const sample = values.random(); if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0 || sample > 1) return outcome("SCHEDULER_ERROR", task.trackId);
        const base = BASE_DELAYS[Math.min(attempt, BASE_DELAYS.length - 1)] as number;
        const delay = Math.min(remaining, Math.max(0, base + Math.round(sample * 500) - 250));
        const beforeSleep = observed;
        await values.sleeper(delay, task.signal);
        if (aborted(task.signal)) return outcome("CANCELLED", task.trackId);
        const now = clock(); if (now === undefined) return outcome("SCHEDULER_ERROR", task.trackId);
        if (aborted(task.signal)) return outcome("CANCELLED", task.trackId);
        if (delay > 0 && now - beforeSleep < delay) return outcome("SCHEDULER_ERROR", task.trackId);
        if (now >= deadline) return outcome("PENDING_RECONCILIATION", task.trackId, lastEvidence);
        if (aborted(task.signal)) return outcome("CANCELLED", task.trackId);
        // The capability has no signal; an abort after this point preserves its actual result.
        const consulted = consultationResult(await values.consultation.consult(task.trackId), task.trackId);
        if (consulted === undefined || consulted === "failure") return outcome("SCHEDULER_ERROR", task.trackId);
        if (consulted.codigo === 0 || consulted.codigo === 3) { lastEvidence = consulted; continue; }
        return outcome("TERMINAL", task.trackId, consulted);
      }
    } catch { return outcome("SCHEDULER_ERROR", task.trackId); }
  } }) };
}
