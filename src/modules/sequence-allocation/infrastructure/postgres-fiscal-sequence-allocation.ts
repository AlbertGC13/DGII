import { formatEcf31ENcf } from "../../fiscal-identity/index.js";
import type { ParsedENcf } from "../../fiscal-identity/index.js";

export type FiscalSequenceQueryClient = Readonly<{
  query(text: string, values?: readonly unknown[]): Promise<Readonly<{ rows: readonly Record<string, unknown>[] }>>;
}>;

export type AllocateFiscalSequenceInput = Readonly<{
  scopeId: string;
  ecfType: "E31";
  idempotencyKey: string;
  fingerprint: string;
  requestedOn: string;
}>;

export type AllocateFiscalSequenceOutcome =
  | Readonly<{ outcome: "allocated" | "replayed"; allocatedValue: bigint; eNcf: ParsedENcf }>
  | Readonly<{ outcome: "invalid_request" | "unprovisioned" | "idempotency_conflict" | "outside_validity" | "exhausted" | "persistence_unavailable" }>;

const ALLOCATION_QUERY = "SELECT outcome, allocated_value::text AS allocated_value FROM allocate_fiscal_sequence($1, $2, $3, $4, $5)";

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function readInput(input: unknown): AllocateFiscalSequenceInput | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  try {
    const candidate = input as Record<string, unknown>;
    const { scopeId, ecfType, idempotencyKey, fingerprint, requestedOn } = candidate;
    return isNonemptyString(scopeId) && ecfType === "E31" && isNonemptyString(idempotencyKey)
      && isNonemptyString(fingerprint) && isCanonicalDate(requestedOn)
      ? { scopeId, ecfType, idempotencyKey, fingerprint, requestedOn }
      : undefined;
  } catch {
    return undefined;
  }
}

function allocatedResult(outcome: "allocated" | "replayed", allocatedValue: unknown): AllocateFiscalSequenceOutcome | undefined {
  if (typeof allocatedValue !== "string" || !/^(?:0|[1-9]\d{0,9})$/.test(allocatedValue)) return undefined;
  const sequence = BigInt(allocatedValue);
  const eNcf = formatEcf31ENcf(sequence);
  return eNcf.ok ? { outcome, allocatedValue: sequence, eNcf: eNcf.value } : undefined;
}

function readOutcome(row: Record<string, unknown> | undefined): AllocateFiscalSequenceOutcome | undefined {
  try {
    if (row === undefined) return undefined;
    const { outcome, allocated_value: allocatedValue } = row;
    if (outcome === "allocated" || outcome === "replayed") return allocatedResult(outcome, allocatedValue);
    if ((outcome === "invalid_request" || outcome === "unprovisioned" || outcome === "idempotency_conflict"
      || outcome === "outside_validity" || outcome === "exhausted") && allocatedValue === null) return { outcome };
    return undefined;
  } catch {
    return undefined;
  }
}

export async function allocateFiscalSequence(
  client: FiscalSequenceQueryClient,
  input: unknown,
): Promise<AllocateFiscalSequenceOutcome> {
  const values = readInput(input);
  if (values === undefined) return { outcome: "invalid_request" };

  try {
    const result = await client.query(ALLOCATION_QUERY, [
      values.scopeId, values.ecfType, values.idempotencyKey, values.fingerprint, values.requestedOn,
    ]);
    return result.rows.length === 1 ? readOutcome(result.rows[0]) ?? { outcome: "persistence_unavailable" }
      : { outcome: "persistence_unavailable" };
  } catch {
    return { outcome: "persistence_unavailable" };
  }
}
