import { createHash } from "node:crypto";

import type { Result } from "../../shared/domain/result.js";

export type PosAuthorizationDenial = "authorization_denied";
export type PosApiKeyMaterial = Readonly<{ keyId: string; digest: Buffer }>;

/** The only accepted presentation: `dgii_pos_v1_<keyId:20><separator><secret:43>`, matched on the raw string. */
const presentation = /^dgii_pos_v1_[A-Za-z0-9_-]{20}_[A-Za-z0-9_-]{43}$/u;
const identifierStart = 12;
const identifierEnd = 32;
const secretStart = 33;
export const posAuthorizationDenied: Result<never, PosAuthorizationDenial> = Object.freeze({ ok: false, error: "authorization_denied" });

/**
 * Parses a presented POS API key and derives its lookup digest as
 * `SHA-256(UTF8("dgii-pos-api-key-v1\0" + keyId + "\0" + secret))` over the presented secret TEXT.
 * The secret is never returned, stored or embedded in any outcome, and no input can make this throw.
 */
export function readPosApiKey(value: unknown): Result<PosApiKeyMaterial, PosAuthorizationDenial> {
  if (typeof value !== "string" || !presentation.test(value)) return posAuthorizationDenied;
  const keyId = value.slice(identifierStart, identifierEnd);
  const digest = createHash("sha256").update(`dgii-pos-api-key-v1\0${keyId}\0${value.slice(secretStart)}`, "utf8").digest();
  return Object.freeze({ ok: true, value: Object.freeze({ keyId, digest }) });
}
