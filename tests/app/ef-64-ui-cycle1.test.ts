import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(__dirname, "..", "..", path), "utf8");

describe("EF-64 UI cycle 1 : connexion", () => {
  const login = read("app/connexion/_components/LoginForm.tsx");

  it("le retour à l'adresse est inerte pendant un envoi", () => {
    const block = login.slice(login.indexOf("page.changeAccount") - 1100, login.indexOf("page.changeAccount"));
    expect(block).toContain("aria-disabled={loading || undefined}");
    expect(block).toContain("if (inFlight.current) return;");
  });

  it("l'attente est annoncée dans une zone d'état polie, en FR et en EN", () => {
    expect(login).toMatch(/<output className="sr-only" aria-live="polite">\s*\{busyLabel\}/);
    for (const key of ["page.sending", "page.verifying"]) {
      for (const lang of ["fr", "en"]) {
        const file = read(`messages/${lang}/login.json`);
        const [group, name] = key.split(".");
        expect(JSON.parse(file)[group][name]).toBeTruthy();
      }
    }
  });

  it("une navigation sans issue est relancée en chargement complet, formulaire fermé", () => {
    expect(login).toContain("NAVIGATION_RELEASE_MS");
    expect(login).toMatch(/if \(releaseTimer\.current\) clearTimeout\(releaseTimer\.current\);\s*releaseTimer\.current = setTimeout\(\(\) => globalThis\.location\.assign\(target\), NAVIGATION_RELEASE_MS\)/);
    expect(login).toContain("clearTimeout(releaseTimer.current)");
  });
});

describe("EF-64 UI cycle 1 : barre élargie et info-bulle", () => {
  it("la barre suit une page large même derrière un habillage", () => {
    expect(read("app/globals.css")).toContain("[data-sticky-header]:has(~ .page-shell .page-wide) .container");
  });

  it("la langue ambiante déclarée l'emporte sur celle du DOM", () => {
    expect(read("components/ui/info-hint.tsx")).toContain(
      'infoHintLocale(ambientLang ?? rootRef.current?.closest("[lang]")?.getAttribute("lang"), pageLocale)',
    );
  });
});
