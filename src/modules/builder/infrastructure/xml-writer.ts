import type { Result } from "../../../shared/domain/result.js";

declare const xmlElementBrand: unique symbol;

export type XmlElement = Readonly<{ readonly [xmlElementBrand]: "XmlElement" }>;
export type XmlWriterErrorCode =
  | "INVALID_INPUT"
  | "INVALID_ELEMENT_NAME"
  | "EMPTY_CONTENT"
  | "INVALID_XML_CHARACTER";
export type XmlWriterError = Readonly<{ code: XmlWriterErrorCode; message: string }>;

type ElementData = Readonly<{
  name: string;
  text?: string;
  children?: readonly XmlElement[];
}>;

const ELEMENT_NAME = /^[A-Za-z_][A-Za-z0-9._-]*$/;
const elements = new WeakMap<XmlElement, ElementData>();
const messages: Readonly<Record<XmlWriterErrorCode, string>> = Object.freeze({
  INVALID_INPUT: "XML input has an unsupported type or shape.",
  INVALID_ELEMENT_NAME: "XML element name is invalid.",
  EMPTY_CONTENT: "XML elements must have meaningful content.",
  INVALID_XML_CHARACTER: "XML text contains an invalid XML character.",
});

function failure(code: XmlWriterErrorCode): Result<never, XmlWriterError> {
  return { ok: false, error: { code, message: messages[code] } };
}

function isValidText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if ((unit < 0x20 && unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) || unit === 0xfffe || unit === 0xffff) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function makeElement(data: ElementData): XmlElement {
  const element = Object.freeze({}) as XmlElement;
  elements.set(element, Object.freeze(data));
  return element;
}

function validateName(name: unknown): Result<string, XmlWriterError> {
  if (typeof name !== "string") return failure("INVALID_INPUT");
  return ELEMENT_NAME.test(name) ? { ok: true, value: name } : failure("INVALID_ELEMENT_NAME");
}

function escapeText(value: string): string {
  return value.replace(/["'<>&©€®]/g, (character) => ({
    '"': "&quot;", "'": "&apos;", "<": "&lt;", ">": "&gt;", "&": "&amp;",
    "©": "&#169;", "€": "&#8364;", "®": "&#174;",
  })[character] as string);
}

export function createXmlTextElement(name: unknown, value: unknown): Result<XmlElement, XmlWriterError> {
  const validName = validateName(name);
  if (!validName.ok) return validName;
  if (typeof value !== "string") return failure("INVALID_INPUT");
  const text = value;
  if (/^[ \t\r\n]*$/.test(text)) return failure("EMPTY_CONTENT");
  if (!isValidText(text)) return failure("INVALID_XML_CHARACTER");
  return { ok: true, value: makeElement({ name: validName.value, text }) };
}

export function createXmlParentElement(
  name: unknown,
  children: unknown,
): Result<XmlElement, XmlWriterError> {
  const validName = validateName(name);
  if (!validName.ok) return validName;
  try {
    if (!Array.isArray(children) || Object.getPrototypeOf(children) !== Array.prototype) {
      return failure("INVALID_INPUT");
    }
    const length = Object.getOwnPropertyDescriptor(children, "length");
    if (length === undefined || !("value" in length) || typeof length.value !== "number" || !Number.isSafeInteger(length.value)) {
      return failure("INVALID_INPUT");
    }
    const childCount: number = length.value;
    if (!length.writable || length.enumerable || length.configurable || children.length !== childCount) {
      return failure("INVALID_INPUT");
    }
    const keys = Reflect.ownKeys(children);
    if (keys.length !== childCount + 1 || keys[childCount] !== "length") return failure("INVALID_INPUT");
    if (childCount === 0) return failure("EMPTY_CONTENT");
    const snapshot: XmlElement[] = [];
    for (let index = 0; index < childCount; index += 1) {
      if (keys[index] !== String(index)) return failure("INVALID_INPUT");
      const descriptor = Object.getOwnPropertyDescriptor(children, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !elements.has(descriptor.value as XmlElement)) {
        return failure("INVALID_INPUT");
      }
      snapshot.push(descriptor.value as XmlElement);
    }
    return { ok: true, value: makeElement({ name: validName.value, children: Object.freeze(snapshot) }) };
  } catch {
    return failure("INVALID_INPUT");
  }
}

function serializeElement(element: XmlElement): string | undefined {
  const data = elements.get(element);
  if (data === undefined) return undefined;
  if (data.text !== undefined) return `<${data.name}>${escapeText(data.text)}</${data.name}>`;
  const children = data.children;
  if (children === undefined) return undefined;
  let body = "";
  for (const child of children) {
    const serialized = serializeElement(child);
    if (serialized === undefined) return undefined;
    body += serialized;
  }
  return `<${data.name}>${body}</${data.name}>`;
}

export function serializeXmlDocument(root: unknown): Result<string, XmlWriterError> {
  if (typeof root !== "object" || root === null || !elements.has(root as XmlElement)) {
    return failure("INVALID_INPUT");
  }
  const serialized = serializeElement(root as XmlElement);
  return serialized === undefined
    ? failure("INVALID_INPUT")
    : { ok: true, value: `<?xml version="1.0" encoding="utf-8"?>${serialized}` };
}
