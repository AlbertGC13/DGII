import {
  restoreEcf31PersistableDraftEvidence,
  serializeEcf31PersistableDraftEvidence,
} from "../../builder/index.js";
import type { Ecf31PersistableDraftEvidence } from "../../builder/index.js";

export type TransactionScopedPgClient = Readonly<{
  query(text: string, values?: unknown[]): Promise<Readonly<{ rows: readonly Record<string, unknown>[] }>>;
}>;

export type SaveEcf31DraftEvidenceInput = Readonly<{
  scopeId: string;
  eNcf: string;
  idempotencyKey: string;
  fingerprint: string;
  evidence: Ecf31PersistableDraftEvidence;
}>;

export type SaveEcf31DraftEvidenceOutcome = Readonly<{
  outcome: "stored" | "replayed" | "conflict" | "missing_allocation" | "invalid_input" | "persistence_unavailable";
}>;

export type FindEcf31DraftEvidenceOutcome =
  | Readonly<{ outcome: "found"; evidence: Ecf31PersistableDraftEvidence }>
  | Readonly<{ outcome: "not_found" | "corrupt_stored_evidence" | "invalid_input" | "persistence_unavailable" }>;

type StoreRow = Readonly<{ outcome?: unknown }>;

function safeString(input: unknown): input is string {
  return typeof input === "string" && input.trim().length > 0;
}

function readSaveInput(input: unknown): SaveEcf31DraftEvidenceInput | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  try {
    const candidate = input as Record<string, unknown>;
    const { scopeId, eNcf, idempotencyKey, fingerprint, evidence } = candidate;
    return safeString(scopeId) && safeString(eNcf) && safeString(idempotencyKey) && safeString(fingerprint)
      ? { scopeId, eNcf, idempotencyKey, fingerprint, evidence: evidence as Ecf31PersistableDraftEvidence }
      : undefined;
  } catch {
    return undefined;
  }
}

function readFindInput(input: unknown): Readonly<{ scopeId: string; eNcf: string }> | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  try {
    const candidate = input as Record<string, unknown>;
    return safeString(candidate["scopeId"]) && safeString(candidate["eNcf"])
      ? { scopeId: candidate["scopeId"], eNcf: candidate["eNcf"] }
      : undefined;
  } catch {
    return undefined;
  }
}

function knownStoreOutcome(row: StoreRow | undefined): SaveEcf31DraftEvidenceOutcome | undefined {
  try {
    const outcome = row?.outcome;
    return outcome === "stored" || outcome === "replayed" || outcome === "conflict" || outcome === "missing_allocation"
      ? { outcome }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function saveEcf31DraftEvidence(
  client: TransactionScopedPgClient,
  input: unknown,
): Promise<SaveEcf31DraftEvidenceOutcome> {
  const values = readSaveInput(input);
  if (values === undefined) return { outcome: "invalid_input" };
  const snapshot = serializeEcf31PersistableDraftEvidence(values.evidence);
  if (!snapshot.ok) return { outcome: "invalid_input" };

  try {
    const result = await client.query(
      "SELECT outcome FROM store_ecf31_draft_evidence($1, $2, $3, $4, $5::jsonb)",
      [values.scopeId, values.eNcf, values.idempotencyKey, values.fingerprint, JSON.stringify(snapshot.value)],
    );
    return knownStoreOutcome(result.rows.length === 1 ? result.rows[0] : undefined) ?? { outcome: "persistence_unavailable" };
  } catch {
    return { outcome: "persistence_unavailable" };
  }
}

export async function findEcf31DraftEvidence(
  client: TransactionScopedPgClient,
  input: unknown,
): Promise<FindEcf31DraftEvidenceOutcome> {
  const values = readFindInput(input);
  if (values === undefined) return { outcome: "invalid_input" };

  try {
    const result = await client.query(
      "SELECT snapshot FROM ecf31_draft_evidence_snapshots WHERE scope_id = $1 AND e_ncf = $2",
      [values.scopeId, values.eNcf],
    );
    if (result.rows.length === 0) return { outcome: "not_found" };
    if (result.rows.length !== 1) return { outcome: "persistence_unavailable" };
    const restored = restoreEcf31PersistableDraftEvidence(result.rows[0]?.["snapshot"]);
    return restored.ok ? { outcome: "found", evidence: restored.value } : { outcome: "corrupt_stored_evidence" };
  } catch {
    return { outcome: "persistence_unavailable" };
  }
}
