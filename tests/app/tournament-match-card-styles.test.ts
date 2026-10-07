import { describe, expect, it } from "@jest/globals";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "../helpers/read-source";
import { stripComments } from "./_lib/style-sweep";

/**
 * Carte de match et fiche de tournoi — styles sur les jetons.
 *
 * Voir `docs/features/TOURNAMENT_MATCH_CARD_STYLES.md`. Les couleurs écrites en
 * dur échappaient à « Contraste renforcé », et deux jetons de la carte
 * (`--surface-1`, `--green`) n'étaient définis nulle part — panne muette qu'aucun
 * rendu jsdom ne verrait, d'où un balayage des sources.
 */

const ROOT = join(__dirname, "..", "..");
const DIR = "app/(secured)/tournois/[id]";
const MATCH_ROW = readSource(`${DIR}/_components/MatchRow.tsx`);
const MATCH_ROW_CSS = readSource(`${DIR}/_components/MatchRow.module.css`);
const PAGE = readSource(`${DIR}/page.tsx`);
const PAGE_CSS = readSource(`${DIR}/page.module.css`);
const BLOCK = readSource(`${DIR}/_components/PhaseStandingsBlock.tsx`);
const BLOCK_CSS = readSource(`${DIR}/_components/PhaseStandingsBlock.module.css`);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// Jetons valables partout : blocs `:root` des feuilles globales, et polices
// posées sur `<body>` par `app/site-fonts.ts`.
const defined = new Set<string>();
for (const path of [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))]) {
  if (path.endsWith(".css") && !path.endsWith(".module.css")) {
    for (const block of readSource(path).matchAll(/:root[^{]*\{([^}]*)\}/g)) {
      for (const m of block[1].matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
    }
  }
}
for (const m of readSource("app/site-fonts.ts").matchAll(/["'](--[a-zA-Z0-9-]+)["']\s*:\s*fontStack\(/g)) {
  defined.add(m[1]);
}

const sheets: Record<string, string> = {
  "MatchRow.module.css": MATCH_ROW_CSS,
  "page.module.css": PAGE_CSS,
  "PhaseStandingsBlock.module.css": BLOCK_CSS,
};

describe("carte de match et fiche de tournoi — aucun style en ligne", () => {
  it.each<[string, string]>([
    ["MatchRow.tsx", MATCH_ROW],
    ["page.tsx", PAGE],
    ["PhaseStandingsBlock.tsx", BLOCK],
  ])("%s ne porte ni `style={{…}}` ni couleur littérale", (_name, source) => {
    const code = source.replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(code).not.toMatch(/style=\{\{/);
    expect(code).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}\b/i);
  });

  it("n'emploie plus les jetons hérités ni le titre en dégradé", () => {
    for (const source of [MATCH_ROW, PAGE]) {
      expect(source).not.toContain("--text-");
      expect(source).not.toContain("--border");
      expect(source).not.toContain("--surface-1");
      expect(source).not.toContain("ds-title");
      expect(source).not.toMatch(/className="btn/);
    }
  });
});

describe("feuilles de la carte et de la fiche — jetons définis", () => {
  it("trouve bien des définitions à confronter", () => {
    for (const token of ["--ink", "--ink-mute", "--cyber-bg-2", "--amber", "--font-title"]) {
      expect(defined).toContain(token);
    }
  });

  it.each(Object.entries(sheets))("%s ne cite aucun jeton absent", (_name, css) => {
    const missing = [...stripComments(css).matchAll(/var\((--[a-zA-Z0-9-]+)\)/g)]
      .map((m) => m[1])
      .filter((token) => !defined.has(token));
    expect(missing).toEqual([]);
  });

  it.each(Object.entries(sheets))("%s ne pose aucune couleur de texte littérale", (_name, css) => {
    expect(stripComments(css)).not.toMatch(/(?<![\w-])color\s*:\s*(#|rgba?\()/i);
  });

  it("la carte colore le forfait et le vainqueur par jeton", () => {
    const css = stripComments(MATCH_ROW_CSS);
    expect(css).toMatch(/\.forfeitScore\s*\{[^}]*color:\s*var\(--amber\)/);
    expect(css).toMatch(/\.winner \.score\s*\{[^}]*color:\s*var\(--teal-400\)/);
    expect(css).toMatch(/\.card\s*\{[^}]*background:\s*var\(--cyber-bg-2\)/);
  });
});

describe("classement d'une phase terminée — un seul bloc, un vrai titre", () => {
  it("la page le rend par PhaseStandingsBlock, jamais par trois copies", () => {
    expect(PAGE).toContain('import("./_components/PhaseStandingsBlock").then((m) => m.PhaseStandingsBlock)');
    expect(PAGE.match(/<PhaseStandingsBlock /g)).toHaveLength(1);
    expect(PAGE).not.toContain("<PhaseStandingsTable");
    // Rendu sous les vues qui n'en portent pas : manches seules d'une phase
    // survie close, rondes seules d'une phase suisse close, élimination (les
    // vues survie et suisse complètes portent le leur).
    expect(PAGE.match(/\{finishedPhaseStandings\}/g)).toHaveLength(3);
  });

  it("n'attend que les phases terminées d'un multi-phases", () => {
    expect(PAGE).toMatch(/isMulti && selectedPhase\?\.state === "FINISHED"/);
  });

  it("porte un titre de section unique", () => {
    expect(BLOCK).toMatch(/<h3[^>]*>\s*\{t\("phases\.standingsTitle"\)\}\s*<\/h3>/);
    expect(BLOCK).toContain('aria-labelledby="phase-standings-title"');
    expect(PAGE).not.toMatch(/>\s*Qualifiées\s*</);
  });
});
