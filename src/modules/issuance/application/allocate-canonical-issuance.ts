import {
  allocateFiscalSequence,
  type FiscalSequenceQueryClient,
} from "../../sequence-allocation/index.js";
import type { ParsedENcf } from "../../fiscal-identity/index.js";
import {
  canonicalizeIssuanceCommand,
  fingerprintCanonicalIssuanceCommand,
} from "../domain/canonical-issuance-command.js";

export type AllocateCanonicalIssuanceInput = Readonly<{
  idempotencyKey: string;
  command: unknown;
}>;

export type AllocateCanonicalIssuanceOutcome =
  | Readonly<{ outcome: "allocated" | "replayed"; allocatedValue: bigint; eNcf: ParsedENcf; fingerprint: string }>
  | Readonly<{ outcome: "invalid_request" | "unprovisioned" | "idempotency_conflict" | "outside_validity" | "exhausted" | "persistence_unavailable" }>;

function readInput(input: unknown): AllocateCanonicalIssuanceInput | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || !keys.includes("idempotencyKey") || !keys.includes("command")) return undefined;
    const idempotencyKey = Object.getOwnPropertyDescriptor(input, "idempotencyKey");
    const command = Object.getOwnPropertyDescriptor(input, "command");
    if (idempotencyKey === undefined || command === undefined || !("value" in idempotencyKey) || !("value" in command)
      || !idempotencyKey.enumerable || !command.enumerable || typeof idempotencyKey.value !== "string" || idempotencyKey.value.trim() === "") return undefined;
    return { idempotencyKey: idempotencyKey.value, command: command.value };
  } catch { return undefined; }
}

export async function allocateCanonicalIssuance(
  client: FiscalSequenceQueryClient,
  input: unknown,
): Promise<AllocateCanonicalIssuanceOutcome> {
  const request = readInput(input);
  if (request === undefined) return { outcome: "invalid_request" };

  const command = canonicalizeIssuanceCommand(request.command);
  if (!command.ok || command.value.ecfType !== "31") return { outcome: "invalid_request" };
  const fingerprint = fingerprintCanonicalIssuanceCommand(command.value);
  if (!fingerprint.ok) return { outcome: "invalid_request" };

  const result = await allocateFiscalSequence(client, {
    scopeId: command.value.issuer.tenantId,
    ecfType: "E31",
    idempotencyKey: request.idempotencyKey,
    fingerprint: fingerprint.value,
    requestedOn: command.value.requestedOn,
  });
  return result.outcome === "allocated" || result.outcome === "replayed"
    ? { ...result, fingerprint: fingerprint.value }
    : { outcome: result.outcome };
}
