import { createHash } from "node:crypto";

import type { Result } from "../../shared/domain/result.js";

export type PosAuthorizationDenial = "authorization_denied";
export type PosApiKeyMaterial = Readonly<{ keyId: string; digest: Buffer }>;

/** The only accepted presentation: `dgii_pos_v1_<keyId:20><separator><secret:43>`, matched on the raw string. */
const presentation = /^dgii_pos_v1_[A-Za-z0-9_-]{20}_[A-Za-z0-9_-]{43}$/u;
const identifier = /^[A-Za-z0-9_-]{20}$/u;
const secretText = /^[A-Za-z0-9_-]{43}$/u;
const identifierStart = 12;
const identifierEnd = 32;
const secretStart = 33;
export const posAuthorizationDenied: Result<never, PosAuthorizationDenial> = Object.freeze({ ok: false, error: "authorization_denied" });

/**
 * The single definition of the lookup digest, `SHA-256(UTF8("dgii-pos-api-key-v1\0" + keyId + "\0" + secret))`,
 * taken over the presented secret TEXT and never over its decoded bytes. Every other derivation in the
 * repository — parsing, fixtures, provisioning — must reach this formula instead of restating it.
 */
const compute = (keyId: string, secret: string): Buffer => createHash("sha256").update(`dgii-pos-api-key-v1\0${keyId}\0${secret}`, "utf8").digest();

/**
 * Derives the lookup digest from already-separated credential material, for fixtures and the future
 * provisioning path. Material that could never appear inside a presented key yields `undefined`,
 * and no input can make this throw.
 */
export function posApiKeyDigest(keyId: unknown, secret: unknown): Buffer | undefined {
  return typeof keyId === "string" && identifier.test(keyId) && typeof secret === "string" && secretText.test(secret) ? compute(keyId, secret) : undefined;
}

/**
 * Parses a presented POS API key and derives its lookup digest through the shared formula above.
 * The secret is never returned, stored or embedded in any outcome, and no input can make this throw.
 */
export function readPosApiKey(value: unknown): Result<PosApiKeyMaterial, PosAuthorizationDenial> {
  if (typeof value !== "string" || !presentation.test(value)) return posAuthorizationDenied;
  const keyId = value.slice(identifierStart, identifierEnd);
  return Object.freeze({ ok: true, value: Object.freeze({ keyId, digest: compute(keyId, value.slice(secretStart)) }) });
}
