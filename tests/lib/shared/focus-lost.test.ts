import { describe, expect, it } from "@jest/globals";
import { isFocusLost } from "@/lib/shared/focus-lost";

const body = { tag: "body" } as unknown as HTMLElement;
const html = { tag: "html" } as unknown as HTMLElement;
const button = { tag: "button" } as unknown as HTMLElement;
const doc = (activeElement: Element | null) => ({ activeElement, body, documentElement: html }) as unknown as Document;

describe("isFocusLost", () => {
  it("activeElementIsNull_lost", () => {
    expect(isFocusLost(doc(null))).toBe(true);
  });

  it("activeElementIsBody_lost", () => {
    expect(isFocusLost(doc(body))).toBe(true);
  });

  it("activeElementIsDocumentElement_lost", () => {
    expect(isFocusLost(doc(html))).toBe(true);
  });

  it("activeElementIsAButton_notLost", () => {
    expect(isFocusLost(doc(button))).toBe(false);
  });
});
