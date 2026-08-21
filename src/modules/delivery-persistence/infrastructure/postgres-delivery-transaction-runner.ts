import { types } from "node:util";

import { createPostgresDeliveryPersistence, type DeliveryPersistence } from "./postgres-delivery-persistence.js";

type Query = (text: string, values?: readonly unknown[]) => Promise<unknown>;
type Release = () => unknown;
type QueryClient = Readonly<{ query: Query; release: Release }>;
type InspectedClient = Readonly<{ query: Query | undefined; release: Release | undefined }>;
type Bound = Readonly<{ connect(): Promise<unknown>; scopeId: string }>;
export type DeliveryTransactionOutcome<Value> = Readonly<{ outcome: "committed"; value: Value }> | Readonly<{ outcome: "rolled_back" }> | Readonly<{ outcome: "transaction_unavailable" }>;
export type DeliveryTransactionRunner = Readonly<{ run<Value>(work: (persistence: DeliveryPersistence) => Promise<Value>): Promise<DeliveryTransactionOutcome<Value>> }>;

const unavailable = <Value>(): DeliveryTransactionOutcome<Value> => Object.freeze({ outcome: "transaction_unavailable" });
const rolledBack = <Value>(): DeliveryTransactionOutcome<Value> => Object.freeze({ outcome: "rolled_back" });
const committed = <Value>(value: Value): DeliveryTransactionOutcome<Value> => Object.freeze({ outcome: "committed", value });
const own = (value: object, key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 256 && !/[\p{Cc}]/u.test(value);
const maximumPrototypeDepth = 8;

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

function bound(value: unknown): Bound | undefined {
  const input = shape(value, ["connectionSource", "scopeId"]);
  if (input === undefined) return undefined;
  const source = shape(own(input, "connectionSource"), ["connect"]); const scopeId = own(input, "scopeId");
  return source !== undefined && typeof own(source, "connect") === "function" && text(scopeId) ? Object.freeze({ connect: own(source, "connect") as () => Promise<unknown>, scopeId }) : undefined;
}

function method(value: object, key: string): ((...arguments_: unknown[]) => unknown) | undefined {
  try {
    let target: object | null = value;
    for (let depth = 0; target !== null && depth < maximumPrototypeDepth; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor !== undefined) {
        const candidate: unknown = descriptor.value;
        if (!("value" in descriptor) || typeof candidate !== "function" || types.isProxy(candidate)) return undefined;
        return (...arguments_): unknown => Reflect.apply(candidate, value, arguments_) as unknown;
      }
      target = Object.getPrototypeOf(target) as object | null;
    }
  } catch { return undefined; }
  return undefined;
}

function queryClient(value: unknown): InspectedClient | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || types.isProxy(value)) return undefined;
  const release = method(value, "release"); const query = method(value, "query");
  return Object.freeze({ query: query === undefined ? undefined : (text, values) => (values === undefined ? query(text) : query(text, values)) as Promise<unknown>, release: release === undefined ? undefined : () => release() });
}

function work(value: unknown): value is (persistence: DeliveryPersistence) => Promise<unknown> {
  return typeof value === "function" && !types.isProxy(value);
}

async function released(release: Release): Promise<boolean> {
  try { await release(); return true; } catch { return false; }
}

/** Binds one trusted scope to fresh, explicitly wrapped PostgreSQL clients; it performs no authorization or network work. */
export function createPostgresDeliveryTransactionRunner(value: unknown): DeliveryTransactionRunner {
  const values = bound(value);
  return Object.freeze({ async run<Result>(callback: (persistence: DeliveryPersistence) => Promise<Result>): Promise<DeliveryTransactionOutcome<Result>> {
    if (values === undefined || !work(callback)) return unavailable();
    let client: QueryClient;
    try {
      const connected = queryClient(await values.connect());
      if (connected === undefined) return unavailable();
      if (connected.query === undefined || connected.release === undefined) {
        if (connected.release !== undefined) await released(connected.release);
        return unavailable();
      }
      client = connected as QueryClient;
    } catch { return unavailable(); }
    try { await client.query("BEGIN"); } catch { await released(client.release); return unavailable(); }
    const persistence = createPostgresDeliveryPersistence({ client: { query: client.query }, scopeId: values.scopeId });
    let result: Result;
    try { result = await callback(persistence); } catch {
      try { await client.query("ROLLBACK"); } catch { await released(client.release); return unavailable(); }
      return await released(client.release) ? rolledBack() : unavailable();
    }
    try { await client.query("COMMIT"); } catch { await released(client.release); return unavailable(); }
    return await released(client.release) ? committed(result) : unavailable();
  } });
}
