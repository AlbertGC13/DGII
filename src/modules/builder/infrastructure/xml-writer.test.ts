import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Result } from "../../../shared/domain/result.js";
import {
  createXmlParentElement,
  createXmlTextElement,
  serializeXmlDocument,
} from "./xml-writer.js";

const XML_DECLARATION = '<?xml version="1.0" encoding="utf-8"?>';

function errorCode(result: unknown): string {
  return (result as { error: { code: string } }).error.code;
}

function successful<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error("Expected success.");
  return result.value;
}

describe("XML writer primitives", () => {
  it("serializes exact UTF-8 bytes, nested children, and repeated names in order", () => {
    const first = createXmlTextElement("Item", "first");
    const second = createXmlTextElement("Item", "0");
    const group = createXmlParentElement("Items", [successful(first), successful(second)]);
    const root = createXmlParentElement("Root", [successful(group)]);
    const result = successful(serializeXmlDocument(successful(root)));
    const xml = `${XML_DECLARATION}<Root><Items><Item>first</Item><Item>0</Item></Items></Root>`;

    expect(result).toBe(xml);
    expect(successful(serializeXmlDocument(successful(root)))).toBe(result);
    expect(result).not.toContain("/>");
    expect([...new TextEncoder().encode(result)]).toEqual([
      60, 63, 120, 109, 108, 32, 118, 101, 114, 115, 105, 111, 110, 61, 34, 49, 46, 48, 34,
      32, 101, 110, 99, 111, 100, 105, 110, 103, 61, 34, 117, 116, 102, 45, 56, 34, 63, 62,
      ...new TextEncoder().encode("<Root><Items><Item>first</Item><Item>0</Item></Items></Root>"),
    ]);
  });

  it("escapes mandated characters once while preserving valid Unicode", () => {
    const text = createXmlTextElement("Text", '"\'<> & © € ® 😀 &lt;\tline\nnext\rend');
    const result = serializeXmlDocument(successful(text));

    expect(result).toEqual({
      ok: true,
      value: `${XML_DECLARATION}<Text>&quot;&apos;&lt;&gt; &amp; &#169; &#8364; &#174; 😀 &amp;lt;\tline\nnext\rend</Text>`,
    });
  });

  it("rejects invalid names, empty content, invalid characters, and unsupported input without coercion", () => {
    const invalidNames = ["", "1Root", "a:b", "a b", "é"];
    const invalidCharacters = ["\u0000", "\u000B", "\uFFFE", "\uFFFF", "\uD800"];
    const coercionTrap = { toString: () => { throw new Error("coerced"); } };

    for (const name of invalidNames) expect(errorCode(createXmlTextElement(name, "x"))).toBe("INVALID_ELEMENT_NAME");
    for (const value of ["", " \t\n\r"]) {
      expect(errorCode(createXmlTextElement("Value", value))).toBe("EMPTY_CONTENT");
    }
    for (const value of invalidCharacters) {
      expect(errorCode(createXmlTextElement("Value", value))).toBe("INVALID_XML_CHARACTER");
    }
    expect(createXmlTextElement("Value", " \ttext\r\n").ok).toBe(true);
    expect(errorCode(createXmlTextElement(coercionTrap, "x"))).toBe("INVALID_INPUT");
    expect(errorCode(createXmlTextElement("Value", coercionTrap))).toBe("INVALID_INPUT");
    for (const value of [0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(errorCode(createXmlTextElement("Value", value))).toBe("INVALID_INPUT");
    }
  });

  it("creates opaque frozen handles and isolates child input mutations", () => {
    const child = createXmlTextElement("Child", "value");
    const children = [successful(child)];
    const parent = createXmlParentElement("Root", children);
    children.length = 0;

    expect(Object.isFrozen(successful(child))).toBe(true);
    expect(Object.isFrozen(successful(parent))).toBe(true);
    expect(serializeXmlDocument(successful(parent))).toEqual({
      ok: true,
      value: `${XML_DECLARATION}<Root><Child>value</Child></Root>`,
    });
  });

  it("rejects forged nodes, empty or sparse children, and hostile collection inputs safely", () => {
    const child = createXmlTextElement("Child", "value");
    const sparse = new Array(1);
    const accessor = [] as unknown[];
    Object.defineProperty(accessor, "0", { get: () => { throw new Error("read"); } });
    accessor.length = 1;
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    const extra = [successful(child)] as unknown[];
    const symbol = [successful(child)] as unknown[];
    const noncanonical = [successful(child)] as unknown[];
    Object.defineProperty(extra, "extra", { value: true });
    Object.defineProperty(symbol, Symbol("extra"), { value: true });
    Object.defineProperty(noncanonical, "01", { value: successful(child) });
    const customPrototype = [successful(child)] as unknown[];
    Object.setPrototypeOf(customPrototype, {});
    class ChildArray extends Array<unknown> {}
    const subclass = new ChildArray();
    subclass.push(successful(child));
    const inputs = [sparse, [{}], accessor, extra, symbol, noncanonical, customPrototype, subclass, new Proxy([successful(child)], { get: () => { throw new Error("read"); } }), revoked.proxy];

    expect(errorCode(createXmlParentElement("Root", []))).toBe("EMPTY_CONTENT");
    for (const input of inputs) expect(errorCode(createXmlParentElement("Root", input))).toBe("INVALID_INPUT");
    expect(errorCode(serializeXmlDocument({}))).toBe("INVALID_INPUT");
  });

  it("remains internal and excludes prohibited XML capabilities", () => {
    const builderIndex = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    const rootIndex = readFileSync(new URL("../../../index.ts", import.meta.url), "utf8");
    const source = readFileSync(new URL("./xml-writer.ts", import.meta.url), "utf8");

    expect(`${builderIndex}\n${rootIndex}`).not.toMatch(/xml-writer|createXml|serializeXml/);
    expect(source).not.toMatch(/attributes|DOCTYPE|CDATA|Comment|node:fs|readFile|writeFile|schema|sign|canonical/i);
  });
});
