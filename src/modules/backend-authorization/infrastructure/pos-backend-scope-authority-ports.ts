import { timingSafeEqual } from "node:crypto";
import { types } from "node:util";

import { BACKEND_ACTION, type ActiveFiscalScope, type FiscalEnvironment, type FreshAuthorization, type TrustedPrincipal } from "../backend-scope-authority.js";
import type { PosAuthorizationResolver, ResolvedPosAuthorization } from "./postgres-pos-authorization.js";

/**
 * The three ports `createBackendScopeAuthority` consumes, widened to `unknown` at every parameter because each one is a
 * boundary: the authority is the only intended caller, but nothing in the runtime enforces that. The authority rejects on a
 * thrown port, so unlike the rest of the house these three signal denial by rejecting rather than by returning a `Result`.
 */
export type PosBackendScopeAuthorityPorts = Readonly<{
  identify(evidence: unknown): Promise<TrustedPrincipal>;
  resolve(principal: unknown, action: unknown): Promise<ActiveFiscalScope>;
  refresh(principal: unknown, scope: unknown, action: unknown): Promise<FreshAuthorization>;
}>;

type Binding = Readonly<{ resolver: PosAuthorizationResolver; presentedKey: unknown }>;

const authorizationFields = ["subjectId", "credentialRevision", "credentialExpiresAtMs", "scopeId", "environment", "membershipRevision", "membershipExpiresAtMs"] as const;
/** One frozen module-scoped instance, so every rejection carries the same constant message and the same load-time stack: no call site, no argument, no driver text, nothing derived from the credential. */
const denial: Error = Object.freeze(new Error("authorization_denied"));
const own = (value: object, key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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

function bind(value: unknown): Binding | undefined {
  const input = shape(value, ["resolver", "presentedKey"]);
  if (input === undefined) return undefined;
  const resolver = own(input, "resolver");
  const inspected = shape(resolver, ["resolve"]);
  if (inspected === undefined || typeof own(inspected, "resolve") !== "function") return undefined;
  return { resolver: resolver as PosAuthorizationResolver, presentedKey: own(input, "presentedKey") };
}

/** The resolver is a dependency, not a trusted collaborator: its envelope and every projected field are re-read before anything reaches the authority. */
function readAuthorization(value: unknown): ResolvedPosAuthorization | undefined {
  const outcome = shape(value, ["ok", "value"]);
  if (outcome === undefined || own(outcome, "ok") !== true) return undefined;
  const row = shape(own(outcome, "value"), authorizationFields);
  if (row === undefined) return undefined;
  const subjectId = own(row, "subjectId"); const credentialRevision = own(row, "credentialRevision"); const credentialExpiresAtMs = own(row, "credentialExpiresAtMs");
  const scopeId = own(row, "scopeId"); const environment = own(row, "environment"); const membershipRevision = own(row, "membershipRevision"); const membershipExpiresAtMs = own(row, "membershipExpiresAtMs");
  if (!isText(subjectId) || !isText(credentialRevision) || !isTime(credentialExpiresAtMs) || !isText(scopeId) || !isEnvironment(environment) || !isText(membershipRevision) || !isTime(membershipExpiresAtMs)) return undefined;
  return { subjectId, credentialRevision, credentialExpiresAtMs, scopeId, environment, membershipRevision, membershipExpiresAtMs };
}

/**
 * EVIDENCE CONFUSION RULE: the ports are bound to ONE presented credential, so `identify` authorises only when the caller
 * presents that exact credential and denies otherwise. Ignoring the evidence would let a caller holding an unrelated key obtain
 * a capability minted from the bound subject, and honouring the evidence instead would identify one credential while `resolve`
 * and `refresh` kept re-reading another. The comparison is constant-time over equal lengths; length itself is not secret
 * because the accepted presentation format fixes it.
 */
function sameCredential(bound: unknown, evidence: unknown): boolean {
  if (typeof bound !== "string" || typeof evidence !== "string") return false;
  const left = Buffer.from(bound, "utf8"); const right = Buffer.from(evidence, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Defence in depth against a port being called with values that never came from this presentation: the authority already
 * compares subject, credential revision, scope, environment and membership revision across `issue` and `refresh`, and these
 * ports compare EVERY projected field, expiries included. The kernel makes `expires_at` immutable — the only permitted update
 * is a one-way revocation leaving every other column untouched — so a diverging expiry is a forged argument, never new state.
 */
function samePrincipal(value: unknown, row: ResolvedPosAuthorization): boolean {
  const fields = shape(value, ["subjectId", "credentialRevision", "expiresAtMs"]);
  return fields !== undefined && own(fields, "subjectId") === row.subjectId && own(fields, "credentialRevision") === row.credentialRevision && own(fields, "expiresAtMs") === row.credentialExpiresAtMs;
}
function sameScope(value: unknown, row: ResolvedPosAuthorization): boolean {
  const fields = shape(value, ["scopeId", "environment", "membershipRevision", "membershipExpiresAtMs", "active"]);
  return fields !== undefined && own(fields, "scopeId") === row.scopeId && own(fields, "environment") === row.environment && own(fields, "membershipRevision") === row.membershipRevision && own(fields, "membershipExpiresAtMs") === row.membershipExpiresAtMs && own(fields, "active") === true;
}

const principalOf = (row: ResolvedPosAuthorization): TrustedPrincipal => Object.freeze({ subjectId: row.subjectId, credentialRevision: row.credentialRevision, expiresAtMs: row.credentialExpiresAtMs });
const scopeOf = (row: ResolvedPosAuthorization): ActiveFiscalScope => Object.freeze({ scopeId: row.scopeId, environment: row.environment, membershipRevision: row.membershipRevision, membershipExpiresAtMs: row.membershipExpiresAtMs, active: true });

/**
 * Binds a POS authorization resolver to ONE presented API key and returns the three authority ports over it. Every port
 * performs its own `resolver.resolve` round trip: no digest, resolved row or principal is memoised between calls, so `refresh`
 * re-validates live against committed state and a revocation, a rotation or a membership replacement lands on the very next
 * port call. Hostile factory input yields ports that reject every call rather than a throwing factory, matching the resolver
 * adapter it wraps; a denial, a malformed resolution, a diverging argument, a wrong action, foreign evidence and any driver
 * failure all reject with the same detail-free value, and no input can make a port reject with anything else.
 */
export function createPosBackendScopeAuthorityPorts(value: unknown): PosBackendScopeAuthorityPorts {
  const binding = bind(value);
  const current = async (): Promise<ResolvedPosAuthorization> => {
    if (binding === undefined) throw denial;
    let outcome: unknown;
    try { outcome = await binding.resolver.resolve(binding.presentedKey); } catch { throw denial; }
    const row = readAuthorization(outcome);
    if (row === undefined) throw denial;
    return row;
  };
  const identify = async (evidence: unknown): Promise<TrustedPrincipal> => {
    if (!sameCredential(binding?.presentedKey, evidence)) throw denial;
    return principalOf(await current());
  };
  const resolve = async (principal: unknown, action: unknown): Promise<ActiveFiscalScope> => {
    if (action !== BACKEND_ACTION) throw denial;
    const row = await current();
    if (!samePrincipal(principal, row)) throw denial;
    return scopeOf(row);
  };
  const refresh = async (principal: unknown, scope: unknown, action: unknown): Promise<FreshAuthorization> => {
    if (action !== BACKEND_ACTION) throw denial;
    const row = await current();
    if (!samePrincipal(principal, row) || !sameScope(scope, row)) throw denial;
    return Object.freeze({ principal: principalOf(row), scope: scopeOf(row) });
  };
  return Object.freeze({ identify, resolve, refresh });
}
