import { describe, expect, it } from "@jest/globals";
import { skipLinkTarget, type SkipLinkNode } from "@/lib/shared/skip-link";

type FakeNode = SkipLinkNode & { name: string; children: FakeNode[] };

/** Un élément réduit à ce que lit la résolution. */
function node(
  tagName: string,
  { name = tagName, attrs = {}, children = [] }: { name?: string; attrs?: Record<string, string>; children?: FakeNode[] } = {},
): FakeNode {
  return { tagName, name, children, getAttribute: (key) => attrs[key] ?? null };
}

describe("skipLinkTarget", () => {
  it("vise le premier enfant de <main> quand rien ne le précède (espace connecté)", () => {
    const main = node("MAIN", { children: [node("DIV", { name: "page" }), node("SECTION")] });
    expect(skipLinkTarget(main).name).toBe("page");
  });

  it("saute l'en-tête rendu dans <main>, et le JSON-LD qui le précède (vitrine)", () => {
    const main = node("MAIN", {
      children: [node("SCRIPT"), node("HEADER"), node("SECTION", { name: "hero" }), node("FOOTER")],
    });
    expect(skipLinkTarget(main).name).toBe("hero");
  });

  it("saute une navigation et un décor masqué aux technologies d'assistance", () => {
    const main = node("MAIN", {
      children: [
        node("NAV"),
        node("DIV", { name: "décor", attrs: { "aria-hidden": "true" } }),
        node("DIV", { name: "contenu" }),
      ],
    });
    expect(skipLinkTarget(main).name).toBe("contenu");
  });

  it("ne saute qu'en tête : un en-tête placé après le contenu en fait partie", () => {
    const main = node("MAIN", {
      children: [node("SECTION", { name: "intro" }), node("HEADER", { name: "second" })],
    });
    expect(skipLinkTarget(main).name).toBe("intro");
  });

  it("lit la balise sans tenir compte de la casse (documents XHTML, SVG)", () => {
    const main = node("main", { children: [node("header"), node("section", { name: "hero" })] });
    expect(skipLinkTarget(main).name).toBe("hero");
  });

  it("garde un élément `aria-hidden` à une autre valeur que « true »", () => {
    const main = node("MAIN", { children: [node("DIV", { name: "visible", attrs: { "aria-hidden": "false" } })] });
    expect(skipLinkTarget(main).name).toBe("visible");
  });

  it("retombe sur <main> lui-même quand il n'a que de l'habillage, ou rien", () => {
    const onlyChrome = node("MAIN", { name: "main", children: [node("HEADER"), node("SCRIPT")] });
    expect(skipLinkTarget(onlyChrome).name).toBe("main");
    expect(skipLinkTarget(node("MAIN", { name: "vide" })).name).toBe("vide");
  });
});
