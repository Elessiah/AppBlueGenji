import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Deux pages qui ne se montent pas hors de Next (`PublicHeader`, flux de la
 * fiche) : leur mise en page mobile se contrôle sur la source, comme
 * `rgpd-backups.test.ts`.
 */
const read = (path: string) => readFileSync(join(__dirname, "..", "..", path), "utf8");

const RGPD = read("app/rgpd/page.tsx");
const RGPD_CSS = read("app/rgpd/page.module.css");
const PLAYER = read("app/(secured)/joueurs/[id]/page.tsx");
const PLAYER_CSS = read("app/(secured)/joueurs/[id]/player.module.css");

/** Corps de la première requête média `max-width: <n>px` de la feuille. */
function mediaBlock(css: string, width: number): string {
  const start = css.indexOf(`@media (max-width: ${width}px)`);
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) return css.slice(start, i + 1);
  }
  throw new Error("requête média non refermée");
}

describe("/rgpd — tableau des données sur mobile", () => {
  const mobile = mediaBlock(RGPD_CSS, 680);

  it("empile les lignes en fiches au lieu de faire déborder la page", () => {
    expect(mobile).toMatch(/\.dataTable tr[\s\S]*display: block/);
  });

  it("ne masque plus aucune colonne, « Base légale » comprise", () => {
    expect(mobile).not.toMatch(/nth-child\(3\)[\s\S]*display: none/);
  });

  it("donne à chaque cellule son intitulé, masqué des lecteurs d'écran", () => {
    expect(RGPD).toMatch(/className=\{styles\.cellLabel\} aria-hidden="true"/);
    expect(mobile).toMatch(/\.cellLabel\s*\{\s*display: block/);
    expect(RGPD_CSS).toMatch(/^\.cellLabel\s*\{\s*display: none;/m);
  });

  it("garde la sémantique de tableau malgré `display: block`", () => {
    for (const role of ["table", "rowgroup", "row", "columnheader", "cell"]) {
      expect(RGPD).toContain(`role="${role}"`);
    }
  });

  it("n'écrit chaque cellule qu'à travers `DataCell`", () => {
    const table = RGPD.slice(RGPD.indexOf("<table"), RGPD.indexOf("</table>"));
    expect(table).not.toMatch(/<td[\s>]/);
    expect(table.match(/<DataCell column=\{0\}>/g)).toHaveLength(4);
  });
});

describe("/joueurs/[id] — en-tête", () => {
  it("fait passer « ← Joueurs » au-dessus du titre sous 640 px", () => {
    expect(PLAYER).toContain("className={`btn ghost ${styles.back}`}");
    expect(mediaBlock(PLAYER_CSS, 640)).toMatch(/\.top\s*\{\s*flex-direction: column-reverse/);
  });

  it("laisse le titre rétrécir et couper un pseudo long", () => {
    expect(PLAYER_CSS).toMatch(/\.identity\s*\{[^}]*min-width: 0/);
    expect(PLAYER_CSS).toMatch(/\.titles\s*\{[^}]*min-width: 0/);
    expect(PLAYER_CSS).toMatch(/\.name\s*\{[^}]*overflow-wrap: anywhere/);
  });

  it("ne recopie plus les chiffres du bloc « Statistiques »", () => {
    expect(PLAYER).not.toContain('className="ds-stats"');
    expect(PLAYER).not.toContain("data.stats.matchesWon");
    expect(PLAYER).toContain("<StatsPanel stats={data.stats}");
  });
});
