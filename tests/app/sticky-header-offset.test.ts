import { describe, expect, it } from "@jest/globals";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource } from "../helpers/read-source";
import {
  STICKY_HEADER_ATTR,
  STICKY_HEADER_HEIGHT_VAR,
  stickyHeaderHeightValue,
} from "@/lib/shared/sticky-header";

const ROOT = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(css|tsx?)$/.test(entry)) out.push(path);
  }
  return out;
}

describe("stickyHeaderHeightValue", () => {
  it("arrondit la hauteur mesurée au pixel supérieur", () => {
    expect(stickyHeaderHeightValue(124)).toBe("124px");
    expect(stickyHeaderHeightValue(110.2)).toBe("111px");
  });

  it("rend 0px sans en-tête ou pour une mesure illisible", () => {
    expect(stickyHeaderHeightValue(null)).toBe("0px");
    expect(stickyHeaderHeightValue(undefined)).toBe("0px");
    expect(stickyHeaderHeightValue(0)).toBe("0px");
    expect(stickyHeaderHeightValue(-4)).toBe("0px");
    expect(stickyHeaderHeightValue(Number.NaN)).toBe("0px");
    expect(stickyHeaderHeightValue(Number.POSITIVE_INFINITY)).toBe("0px");
  });

  it("rend 0px quand l'en-tête n'est plus collant (écran bas)", () => {
    expect(stickyHeaderHeightValue(124, "relative")).toBe("0px");
    expect(stickyHeaderHeightValue(124, "static")).toBe("0px");
    expect(stickyHeaderHeightValue(124, null)).toBe("0px");
    expect(stickyHeaderHeightValue(124, "sticky")).toBe("124px");
    expect(stickyHeaderHeightValue(124, "fixed")).toBe("124px");
  });

  it("les en-têtes repassent bien en position relative sur écran bas", () => {
    // Le jour où ce repli disparaît, la règle `position` ci-dessus n'a plus d'objet.
    const shortScreen = /@media \(max-height: 500px\) \{[^}]*\{\s*position:\s*relative/;
    expect(readSource("components/cyber/landing/PublicHeader.module.css")).toMatch(shortScreen);
    expect(readSource("components/arena-nav.module.css")).toMatch(shortScreen);
  });
});

describe("marge d'ancre sous l'en-tête collant", () => {
  it("est posée une fois, sur <html>, depuis la hauteur mesurée", () => {
    const css = readSource("app/globals.css");
    expect(css).toMatch(
      new RegExp(`html \\{[^}]*scroll-padding-top:\\s*calc\\(var\\(${STICKY_HEADER_HEIGHT_VAR}, \\d+px\\) \\+ \\d+px\\)`),
    );
  });

  it("repli d'avant mesure : couvre l'en-tête le plus haut mesuré (134 px)", () => {
    const css = readSource("app/globals.css");
    const fallback = css.match(/var\(--sticky-header-h, (\d+)px\) \+ \d+px\)/);
    expect(Number(fallback?.[1])).toBeGreaterThanOrEqual(134);
  });

  it("les deux en-têtes collants se déclarent à la mesure", () => {
    expect(readSource("components/cyber/landing/PublicHeader.tsx")).toContain(STICKY_HEADER_ATTR);
    expect(readSource("components/arena-nav.tsx")).toContain(STICKY_HEADER_ATTR);
  });

  it("la mesure est montée par la mise en page racine", () => {
    expect(readSource("app/layout.tsx")).toContain("<StickyHeaderOffset />");
  });

  it("aucune cible ne pose de marge en pixels, qui s'ajouterait à la marge globale", () => {
    const offenders = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))]
      // Le raccourci (`scroll-margin`, `scrollMargin`) et l'axe de bloc
      // posent aussi la marge du haut ; seul l'axe en ligne reste libre.
      .filter((file) =>
        /scroll-margin(?:-top|-block(?:-start)?)?:\s*\d+px|scrollMargin(?:Top|Block(?:Start)?)?:\s*\d+/.test(
          readSource(file),
        ),
      )
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
