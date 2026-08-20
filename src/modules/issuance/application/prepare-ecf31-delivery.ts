import { createHash } from "node:crypto";
import { types } from "node:util";

import {
  isEcf31CoreDraft,
  isEcf31DerivedHeaderTotalsEvidence,
  isEcf31DetallesItemsEvidence,
  isEcf31IdDocIssuanceEvidence,
  isEcf31ItbisPriceInclusionEvidence,
} from "../../builder/index.js";
import { isVerifiedSignedXmlArtifact } from "../../xml-signer/index.js";
import type { VerifiedSignedXmlArtifact } from "../../xml-signer/index.js";
import type { Result } from "../../../shared/domain/result.js";

export type Ecf31DeliveryPreparationError = Readonly<{ code: "INVALID_ECF31_DELIVERY_PREPARATION_CONFIGURATION" | "INVALID_ECF31_DELIVERY_PREPARATION_INPUT" | "ECF31_DELIVERY_PREPARATION_FAILED" }>;
export type Ecf31DeliveryPreparationPackage = Readonly<{ issuanceEvidence: unknown; draft: unknown; derivedHeaderTotalsEvidence: unknown; detallesItemsEvidence: unknown; fechaHoraFirma: string; priceInclusionEvidence?: unknown }>;
export type Ecf31DeliveryPreparationCapabilities = Readonly<{
  assemble(input: Ecf31DeliveryPreparationPackage): unknown;
  sign(xml: string): unknown;
  serialize(signed: object): unknown;
  validate(xml: string, schemaId: "ecf-31-v1.0"): Promise<unknown>;
  verify(xml: string): unknown;
}>;
export type Ecf31DeliveryPreparation = Readonly<{ prepare(input: unknown): Promise<Result<Readonly<{ artifact: VerifiedSignedXmlArtifact; signedXmlSha256: string }>, Ecf31DeliveryPreparationError>> }>;

const CAPABILITY_KEYS = ["assemble", "sign", "serialize", "validate", "verify"] as const;
const PACKAGE_KEYS = ["issuanceEvidence", "draft", "derivedHeaderTotalsEvidence", "detallesItemsEvidence", "fechaHoraFirma"] as const;
const failure = (code: Ecf31DeliveryPreparationError["code"]): Result<never, Ecf31DeliveryPreparationError> => Object.freeze({ ok: false, error: Object.freeze({ code }) });
const own = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value as unknown : undefined;
};

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !types.isProxy(value)
      && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length
      && keys.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
      });
  } catch {
    /* v8 ignore next -- proxies are rejected before any reflective operation can throw. */
    return false;
  }
}

function capabilities(value: unknown): Ecf31DeliveryPreparationCapabilities | undefined {
  if (!exact(value, CAPABILITY_KEYS)) return undefined;
  const snapshot = CAPABILITY_KEYS.map((key) => own(value, key));
  if (!snapshot.every((capability) => typeof capability === "function")) return undefined;
  const [assemble, sign, serialize, validate, verify] = snapshot as [Ecf31DeliveryPreparationCapabilities["assemble"], Ecf31DeliveryPreparationCapabilities["sign"], Ecf31DeliveryPreparationCapabilities["serialize"], Ecf31DeliveryPreparationCapabilities["validate"], Ecf31DeliveryPreparationCapabilities["verify"]];
  return Object.freeze({ assemble, sign, serialize, validate, verify });
}

function packageInput(value: unknown): Ecf31DeliveryPreparationPackage | undefined {
  try {
    const hasPrice = typeof value === "object" && value !== null && Reflect.ownKeys(value).includes("priceInclusionEvidence");
    if (!Object.isFrozen(value) || !exact(value, hasPrice ? [...PACKAGE_KEYS, "priceInclusionEvidence"] : PACKAGE_KEYS)) return undefined;
    const read = (key: string): unknown => own(value, key);
    const issuanceEvidence = read("issuanceEvidence"); const draft = read("draft"); const derivedHeaderTotalsEvidence = read("derivedHeaderTotalsEvidence"); const detallesItemsEvidence = read("detallesItemsEvidence"); const fechaHoraFirma = read("fechaHoraFirma"); const priceInclusionEvidence = read("priceInclusionEvidence");
    if (!isEcf31IdDocIssuanceEvidence(issuanceEvidence) || !isEcf31CoreDraft(draft) || !isEcf31DerivedHeaderTotalsEvidence(derivedHeaderTotalsEvidence) || !isEcf31DetallesItemsEvidence(detallesItemsEvidence) || typeof fechaHoraFirma !== "string" || (hasPrice && !isEcf31ItbisPriceInclusionEvidence(priceInclusionEvidence))) return undefined;
    if (issuanceEvidence.header !== draft.header || detallesItemsEvidence.draft !== draft || derivedHeaderTotalsEvidence.exemptAmountEvidence.draft !== draft || derivedHeaderTotalsEvidence.additionalTaxClassificationEvidence.draft !== draft || derivedHeaderTotalsEvidence.taxableBaseEvidence?.priceInclusionEvidence.draft !== draft || derivedHeaderTotalsEvidence.totalItbisEvidence?.taxableBaseEvidence !== derivedHeaderTotalsEvidence.taxableBaseEvidence || (hasPrice && (priceInclusionEvidence as Readonly<{ draft: unknown }>).draft !== draft) || (hasPrice && priceInclusionEvidence !== derivedHeaderTotalsEvidence.taxableBaseEvidence.priceInclusionEvidence)) return undefined;
    return Object.freeze({ issuanceEvidence, draft, derivedHeaderTotalsEvidence, detallesItemsEvidence, fechaHoraFirma, ...(hasPrice ? { priceInclusionEvidence } : {}) });
  } catch { return undefined; }
}

function success(value: unknown): unknown {
  return exact(value, ["ok", "value"]) && own(value, "ok") === true ? own(value, "value") : undefined;
}

/** Prepares one fully evidenced e-CF 31 for later delivery; certificate ownership remains entirely inside the signing capability. */
export function createEcf31DeliveryPreparation(configuration: unknown): Result<Ecf31DeliveryPreparation, Ecf31DeliveryPreparationError> {
  const injected = capabilities(configuration);
  if (injected === undefined) return failure("INVALID_ECF31_DELIVERY_PREPARATION_CONFIGURATION");
  return Object.freeze({ ok: true, value: Object.freeze({ async prepare(input: unknown) {
    try {
      const packageValue = packageInput(input); if (packageValue === undefined) return failure("INVALID_ECF31_DELIVERY_PREPARATION_INPUT");
      const assembled = success(injected.assemble(packageValue)); if (typeof assembled !== "string") return failure("ECF31_DELIVERY_PREPARATION_FAILED");
      const signed = success(injected.sign(assembled)); if (typeof signed !== "object" || signed === null) return failure("ECF31_DELIVERY_PREPARATION_FAILED");
      const serialized = success(injected.serialize(signed)); if (typeof serialized !== "string") return failure("ECF31_DELIVERY_PREPARATION_FAILED");
      const validation = success(await injected.validate(serialized, "ecf-31-v1.0"));
      if (!exact(validation, ["valid"]) || Object.getOwnPropertyDescriptor(validation, "valid")?.value !== true) return failure("ECF31_DELIVERY_PREPARATION_FAILED");
      const artifact = success(injected.verify(serialized)); if (!isVerifiedSignedXmlArtifact(artifact)) return failure("ECF31_DELIVERY_PREPARATION_FAILED");
      return Object.freeze({ ok: true, value: Object.freeze({ artifact, signedXmlSha256: createHash("sha256").update(serialized, "utf8").digest("hex") }) });
    } catch { return failure("ECF31_DELIVERY_PREPARATION_FAILED"); }
  } }) });
}
