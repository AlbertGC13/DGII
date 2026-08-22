import { types } from "node:util";

import type { Result } from "../../../shared/domain/result.js";
import type { FiscalEnvironment } from "../backend-scope-authority.js";
import { posAuthorizationDenied, readPosApiKey, type PosAuthorizationDenial } from "../pos-api-key.js";

/**
 * A NATIVE `pg.Pool` OR `pg.PoolClient` STRUCTURALLY SATISFIES THIS TYPE BUT IS DELIBERATELY REJECTED AT RUNTIME:
 * the dependency gate demands a plain `Object.prototype` object holding exactly one own `query` data property, and a
 * driver instance carries neither. Passing one typechecks and then denies every request with no diagnostic, so callers
 * MUST wrap it: `{ client: { query: (text, values) => pool.query(text, values) } }`.
 */
export type PosAuthorizationQueryClient = Readonly<{ query(text: string, values?: readonly unknown[]): Promise<unknown> }>;
export type ResolvedPosAuthorization = Readonly<{ subjectId: string; credentialRevision: string; credentialExpiresAtMs: number; scopeId: string; environment: FiscalEnvironment; membershipRevision: string; membershipExpiresAtMs: number }>;
export type PosAuthorizationResolver = Readonly<{ resolve(presentedKey: unknown): Promise<Result<ResolvedPosAuthorization, PosAuthorizationDenial>> }>;

const columns = ["outcome", "subject_id", "credential_revision", "credential_expires_at_ms", "scope_id", "environment", "membership_revision", "membership_expires_at_ms"] as const;
/** Projects a timestamptz expiry as epoch milliseconds. NULL and `infinity` both mean "does not expire" and project to NULL; `-infinity` projects to a sentinel that fails `epochMilliseconds` and therefore denies. Builtins are schema-qualified because this runs in the caller's session, not under the resolver's pinned search_path. */
const expiryColumn = (column: "credential_expires_at" | "membership_expires_at") => `CASE WHEN ${column} IS NULL THEN NULL WHEN pg_catalog.isfinite(${column}) THEN (pg_catalog.extract('epoch', ${column}) * 1000)::pg_catalog.int8::pg_catalog.text WHEN ${column} > pg_catalog.now() THEN NULL ELSE 'not_finite' END AS ${column}_ms`;
const resolverQuery = `SELECT outcome, subject_id, credential_revision, ${expiryColumn("credential_expires_at")}, scope_id, environment, membership_revision, ${expiryColumn("membership_expires_at")} FROM resolve_pos_authorization($1, $2)`;
const identifier = /^[A-Za-z0-9_-]{1,128}$/u;
const revision = /^[1-9][0-9]{0,15}$/u;
const epochMilliseconds = /^(?:0|[1-9][0-9]{0,15})$/u;
const own = (value: object, key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const isEnvironment = (value: unknown): value is FiscalEnvironment => value === "TesteCF" || value === "CerteCF" || value === "production";

function shape(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const present = Reflect.ownKeys(value);
    if (types.isProxy(value) || present.length !== keys.length || !keys.every((key) => present.includes(key))) return undefined;
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch { return undefined; }
}

function oneRow(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || types.isProxy(value)) return undefined;
    const rows = Object.getOwnPropertyDescriptor(value, "rows");
    if (rows === undefined || !("value" in rows)) return undefined;
    const listed: unknown = rows.value;
    if (!Array.isArray(listed) || Object.getPrototypeOf(listed) !== Array.prototype || types.isProxy(listed) || listed.length !== 1) return undefined;
    const first = Object.getOwnPropertyDescriptor(listed, "0");
    return first === undefined || !("value" in first) ? undefined : shape(first.value, keys);
  } catch { return undefined; }
}

function bound(value: unknown): PosAuthorizationQueryClient | undefined {
  const input = shape(value, ["client"]);
  if (input === undefined) return undefined;
  const client = own(input, "client");
  const inspected = shape(client, ["query"]);
  return inspected !== undefined && typeof own(inspected, "query") === "function" ? client as PosAuthorizationQueryClient : undefined;
}

/** A NULL expiry declares "does not expire"; the downstream authority still bounds it by its own maximum TTL. */
function expiry(value: unknown): number | undefined {
  if (value === null) return Number.MAX_SAFE_INTEGER;
  if (!matches(value, epochMilliseconds)) return undefined;
  const milliseconds = Number(value);
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

/** `resolved` is the only accepted outcome; the declared denial and any unknown outcome collapse into the same denial. */
function readRow(row: Readonly<Record<string, unknown>>): Result<ResolvedPosAuthorization, PosAuthorizationDenial> {
  const subjectId = own(row, "subject_id"); const credentialRevision = own(row, "credential_revision"); const scopeId = own(row, "scope_id");
  const environment = own(row, "environment"); const membershipRevision = own(row, "membership_revision");
  const credentialExpiresAtMs = expiry(own(row, "credential_expires_at_ms")); const membershipExpiresAtMs = expiry(own(row, "membership_expires_at_ms"));
  if (own(row, "outcome") !== "resolved" || !matches(subjectId, identifier) || !matches(credentialRevision, revision) || !matches(scopeId, identifier) || !isEnvironment(environment) || !matches(membershipRevision, revision) || credentialExpiresAtMs === undefined || membershipExpiresAtMs === undefined) return posAuthorizationDenied;
  return Object.freeze({ ok: true, value: Object.freeze({ subjectId, credentialRevision, credentialExpiresAtMs, scopeId, environment, membershipRevision, membershipExpiresAtMs }) });
}

/**
 * Reads one POS authorization from the PostgreSQL kernel through parameterised calls to `resolve_pos_authorization`.
 * A malformed presentation, hostile dependencies, an unexpected result envelope, a malformed row, an unknown outcome
 * and any driver or database failure all collapse into the single `authorization_denied` outcome; nothing derived from
 * the presented credential ever reaches an outcome, and no input can make this throw. A malformed presentation is
 * refused before any round trip: its rejection depends only on the format the caller already knows, never on stored
 * state, so the constant-time comparison the resolver performs over real candidates stays the only secret-dependent path.
 * It builds no ports and performs no transaction control.
 */
export function createPostgresPosAuthorizationResolver(value: unknown): PosAuthorizationResolver {
  const client = bound(value);
  return Object.freeze({ async resolve(presentedKey: unknown): Promise<Result<ResolvedPosAuthorization, PosAuthorizationDenial>> {
    const material = readPosApiKey(presentedKey);
    if (!material.ok || client === undefined) return posAuthorizationDenied;
    try {
      const row = oneRow(await client.query(resolverQuery, [material.value.keyId, material.value.digest]), columns);
      return row === undefined ? posAuthorizationDenied : readRow(row);
    } catch { return posAuthorizationDenied; }
  } });
}
