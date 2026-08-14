import type { Result } from "../../shared/domain/result.js";

export const BACKEND_ACTION = "delivery:evidence:record" as const;
export type BackendAction = typeof BACKEND_ACTION;
export type FiscalEnvironment = "TesteCF" | "CerteCF" | "production";
export type TrustedPrincipal = Readonly<{ subjectId: string; credentialRevision: string; expiresAtMs: number }>;
export type ActiveFiscalScope = Readonly<{ scopeId: string; environment: FiscalEnvironment; membershipRevision: string; membershipExpiresAtMs: number; active: true }>;
export type FreshAuthorization = Readonly<{ principal: TrustedPrincipal; scope: ActiveFiscalScope }>;
export type Capability = () => never;
type Context = Readonly<{ scopeId: string; environment: FiscalEnvironment }>;
type State = Readonly<{ principal: TrustedPrincipal; scope: ActiveFiscalScope; expiresAtMs: number; monotonicMs: number; wallMs: number; used: boolean }>;
type Denial = "authorization_denied";

export type BackendScopeAuthority = Readonly<{
  issue(action: unknown, evidence: unknown): Promise<Result<Capability, Denial>>;
  use<T>(capability: unknown, action: unknown, operation: (context: Context) => Promise<T> | T): Promise<Result<T, Denial | "operation_failed">>;
}>;
export type BackendScopeAuthorityDependencies = Readonly<{
  identify(evidence: unknown): Promise<TrustedPrincipal>;
  resolve(principal: TrustedPrincipal, action: BackendAction): Promise<ActiveFiscalScope>;
  refresh(principal: TrustedPrincipal, scope: ActiveFiscalScope, action: BackendAction): Promise<FreshAuthorization>;
  clock(): Readonly<{ monotonicMs: number; wallMs: number }>;
  maxTtlMs: number;
}>;

export function createBackendScopeAuthority(dependencies: BackendScopeAuthorityDependencies): BackendScopeAuthority {
  const ports = readDependencies(dependencies);
  const states = new WeakMap<Capability, State>();
  const deny = (): Result<never, Denial> => ({ ok: false, error: "authorization_denied" });
  const issue = async (action: unknown, evidence: unknown): Promise<Result<Capability, Denial>> => {
    if (ports === undefined || action !== BACKEND_ACTION) return deny();
    try {
      const clock = readClock(ports.clock());
      if (clock === undefined) return deny();
      const principal = readPrincipal(await ports.identify(evidence));
      if (principal === undefined) return deny();
      const scope = readScope(await ports.resolve(principal, BACKEND_ACTION));
      if (scope === undefined) return deny();
      const expiresAtMs = Math.min(principal.expiresAtMs, scope.membershipExpiresAtMs, clock.wallMs + ports.maxTtlMs);
      if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= clock.wallMs) return deny();
      const capability = (): never => { throw new TypeError("opaque capability"); };
      states.set(capability, { principal, scope, expiresAtMs, monotonicMs: clock.monotonicMs, wallMs: clock.wallMs, used: false });
      return { ok: true, value: capability };
    } catch { return deny(); }
  };
  const use = async <T>(capability: unknown, action: unknown, operation: (context: Context) => Promise<T> | T): Promise<Result<T, Denial | "operation_failed">> => {
    if (ports === undefined || !isCapability(capability) || action !== BACKEND_ACTION || typeof operation !== "function") return deny();
    const state = states.get(capability);
    if (state === undefined || state.used) return deny();
    states.set(capability, { ...state, used: true });
    let refreshed: FreshAuthorization | undefined;
    try {
      const clock = readClock(ports.clock());
      if (clock === undefined || clock.monotonicMs < state.monotonicMs || clock.wallMs < state.wallMs || clock.wallMs >= state.expiresAtMs) return deny();
      refreshed = readFresh(await ports.refresh(state.principal, state.scope, BACKEND_ACTION));
      const finalClock = readClock(ports.clock());
      if (finalClock === undefined || finalClock.monotonicMs < clock.monotonicMs || finalClock.wallMs < clock.wallMs || finalClock.wallMs >= state.expiresAtMs || refreshed === undefined || finalClock.wallMs >= refreshed.principal.expiresAtMs || finalClock.wallMs >= refreshed.scope.membershipExpiresAtMs || !samePrincipal(state.principal, refreshed.principal) || !sameScope(state.scope, refreshed.scope)) return deny();
    } catch { return deny(); }
    try {
      return { ok: true, value: await operation({ scopeId: state.scope.scopeId, environment: state.scope.environment }) };
    } catch { return { ok: false, error: "operation_failed" }; }
  };
  return { issue, use };
}

function readDependencies(value: unknown): BackendScopeAuthorityDependencies | undefined {
  const fields = readValues(value, ["identify", "resolve", "refresh", "clock", "maxTtlMs"]);
  if (fields === undefined || typeof fields["identify"] !== "function" || typeof fields["resolve"] !== "function" || typeof fields["refresh"] !== "function" || typeof fields["clock"] !== "function" || !isDuration(fields["maxTtlMs"])) return undefined;
  return { identify: fields["identify"] as BackendScopeAuthorityDependencies["identify"], resolve: fields["resolve"] as BackendScopeAuthorityDependencies["resolve"], refresh: fields["refresh"] as BackendScopeAuthorityDependencies["refresh"], clock: fields["clock"] as BackendScopeAuthorityDependencies["clock"], maxTtlMs: fields["maxTtlMs"] };
}
function readClock(value: unknown): Readonly<{ monotonicMs: number; wallMs: number }> | undefined {
  const fields = readValues(value, ["monotonicMs", "wallMs"]);
  if (fields === undefined || !isTime(fields["monotonicMs"]) || !isTime(fields["wallMs"])) return undefined;
  return { monotonicMs: fields["monotonicMs"], wallMs: fields["wallMs"] };
}
function readPrincipal(value: unknown): TrustedPrincipal | undefined {
  const fields = readValues(value, ["subjectId", "credentialRevision", "expiresAtMs"]);
  if (fields === undefined || !isText(fields["subjectId"]) || !isText(fields["credentialRevision"]) || !isTime(fields["expiresAtMs"])) return undefined;
  return { subjectId: fields["subjectId"], credentialRevision: fields["credentialRevision"], expiresAtMs: fields["expiresAtMs"] };
}
function readScope(value: unknown): ActiveFiscalScope | undefined {
  const fields = readValues(value, ["scopeId", "environment", "membershipRevision", "membershipExpiresAtMs", "active"]);
  if (fields === undefined || !isText(fields["scopeId"]) || !isEnvironment(fields["environment"]) || !isText(fields["membershipRevision"]) || !isTime(fields["membershipExpiresAtMs"]) || fields["active"] !== true) return undefined;
  return { scopeId: fields["scopeId"], environment: fields["environment"], membershipRevision: fields["membershipRevision"], membershipExpiresAtMs: fields["membershipExpiresAtMs"], active: true };
}
function readFresh(value: unknown): FreshAuthorization | undefined {
  const fields = readValues(value, ["principal", "scope"]);
  if (fields === undefined) return undefined;
  const principal = readPrincipal(fields["principal"]);
  const scope = readScope(fields["scope"]);
  if (principal === undefined || scope === undefined) return undefined;
  return { principal, scope };
}
function readValues(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || !own.every((key) => typeof key === "string" && keys.includes(key))) return undefined;
    const fields: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) return undefined;
      fields[key] = descriptor.value;
    }
    return fields;
  } catch { return undefined; }
}
function isText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function isTime(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function isDuration(value: unknown): value is number { return isTime(value) && value > 0 && value <= 86_400_000; }
function isEnvironment(value: unknown): value is FiscalEnvironment { return value === "TesteCF" || value === "CerteCF" || value === "production"; }
function isCapability(value: unknown): value is Capability { return typeof value === "function"; }
function sameScope(left: ActiveFiscalScope, right: ActiveFiscalScope): boolean { return left.scopeId === right.scopeId && left.environment === right.environment && left.membershipRevision === right.membershipRevision; }
function samePrincipal(left: TrustedPrincipal, right: TrustedPrincipal): boolean { return left.subjectId === right.subjectId && left.credentialRevision === right.credentialRevision; }
