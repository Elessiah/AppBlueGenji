import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * Repli mobile des formulaires et des tableaux (audit UI, lot formulaires).
 *
 * - `.form-grid` se replie en `minmax(0, 1fr)` : `1fr` se dimensionne sur le
 *   contenu minimal, et un libellé `nowrap` élargissait la colonne hors de sa
 *   carte.
 * - `.table-row` se replie en pile : l'en-tête disparaît, et chaque valeur
 *   porte son intitulé (`data-label`) — sans quoi une ligne n'était plus qu'une
 *   suite de valeurs anonymes.
 */

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media (${query}) {`);
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) return css.slice(start, i + 1);
  }
  throw new Error("bloc @media non refermé");
}

function tsxFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return tsxFiles(rel);
    return rel.endsWith(".tsx") ? [rel] : [];
  });
}

const globals = read("app/globals.css");
const mobile = mediaBlock(globals, "max-width: 920px");

describe("repli mobile des formulaires", () => {
  it("borne la colonne unique de .form-grid à sa carte", () => {
    expect(mobile).toMatch(/\.form-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  });

  it("ne garde plus le flottant « Accueil » du formulaire de tournoi", () => {
    expect(globals).not.toContain("cta-float-home");
    expect(read("app/(secured)/tournois/creer/page.tsx")).not.toContain("cta-float-home");
  });

  it("donne une marge interne à la carte de création d'équipe", () => {
    expect(read("app/(secured)/equipes/creer/page.tsx")).toMatch(
      /<CyberCard ticks style=\{\{ padding: /,
    );
  });
});

describe("repli mobile des tableaux", () => {
  it("masque l'en-tête et affiche l'intitulé de chaque valeur", () => {
    expect(mobile).toMatch(/\.table-row\.table-header\s*\{\s*display:\s*none;/);
    expect(mobile).toMatch(/\.table-row > \[data-label\]::before\s*\{[^}]*content:\s*attr\(data-label\)/);
  });

  it("libelle les valeurs de tout tableau dont l'en-tête disparaît", () => {
    const withHeader = [...tsxFiles("app"), ...tsxFiles("components")].filter((file) =>
      /table-header/.test(read(file)),
    );
    expect(withHeader.length).toBeGreaterThan(0);
    for (const file of withHeader) {
      expect({ file, labelled: read(file).includes("data-label=") }).toEqual({
        file,
        labelled: true,
      });
    }
  });

  it("fait de même pour la liste des inscrites, sous son propre seuil", () => {
    const css = read("app/(secured)/tournois/[id]/_components/RegistrationsPanel.module.css");
    const block = mediaBlock(css, "max-width: 720px");
    expect(block).toMatch(/\.header\s*\{\s*display:\s*none;/);
    expect(block).toMatch(/\.row > \[data-label\]::before\s*\{[^}]*content:\s*attr\(data-label\)/);
    const tsx = read("app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx");
    expect(tsx).toContain('data-label={t("registrations.registeredAt")}');
    expect(tsx).toContain('data-label={t("registrations.finalRank")}');
  });
});
