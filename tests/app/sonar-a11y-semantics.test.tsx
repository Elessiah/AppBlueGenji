/**
 * Lot SonarQube d'accessibilité : balises natives plutôt que rôles ARIA (S6819) et
 * intitulés de champ sans contrôle (S6853).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { describe, expect, it } from "@jest/globals";
import { BoardPanel } from "@/app/(secured)/tournois/[id]/_components/BoardPanel";

const root = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("BoardPanel — corps du volet", () => {
  const render = (open: boolean, ariaLabel?: string) =>
    renderToStaticMarkup(
      <BoardPanel accent="#5ac8ff" title="Manche 3" open={open} onToggle={() => {}} panelId="p3" ariaLabel={ariaLabel}>
        <p>contenu</p>
      </BoardPanel>,
    );

  it("est une `<section>` nommée — donc une région — sans rôle redit", () => {
    const html = render(true, "Manche 3, 4 matchs");
    expect(html).toMatch(/<section id="p3" aria-label="Manche 3, 4 matchs" class="[^"]*">/);
    expect(html).not.toContain('role="region"');
  });

  it("prend le titre pour nom à défaut d'intitulé", () => {
    expect(render(true)).toContain('<section id="p3" aria-label="Manche 3"');
  });

  it("n'est pas rendu replié", () => {
    expect(render(false)).not.toContain("<section");
  });
});

describe("Régions nommées des panneaux flottants", () => {
  it.each<[string]>([["components/client-power-badge.tsx"], ["components/accessibility/AccessibilityMenu.tsx"]])(
    "%s nomme son panneau par un `<section>`, sans `role=\"region\"`",
    (path) => {
      const source = read(path);
      expect(source).toMatch(/<section id=\{[a-zA-Z]+\} className=\{styles\.panel\}/);
      expect(source).not.toContain('role="region"');
    },
  );
});

describe("Intitulé d'un `.field` sans contrôle", () => {
  it("`.field-label` reprend le style d'un `<label>` de champ", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/\.field label,\s*\.field \.field-label\s*\{\s*font-size: 13px;\s*color: var\(--text-1\);/);
  });

  it.each<[string, string]>([
    ["app/(secured)/equipes/creer/page.tsx", "Logo (optionnel)"],
    ["app/(secured)/joueurs/[id]/page.tsx", "Discord"],
  ])("%s n'emploie plus de `<label>` orphelin pour « %s »", (path, text) => {
    const source = read(path);
    expect(source).toContain(`<span className="field-label">${text}</span>`);
    expect(source).not.toContain(`<label>${text}</label>`);
  });

  it("la fiche joueur relie chaque intitulé à son champ en lecture seule", () => {
    const source = read("app/(secured)/joueurs/[id]/page.tsx");
    for (const id of ["player-battletag", "player-marvel-rivals-tag", "player-adult"]) {
      expect(source).toContain(`htmlFor="${id}"`);
      expect(source).toContain(`id="${id}"`);
    }
    expect(source).not.toMatch(/<label>[^<]*<\/label>/);
  });
});

/** Toutes les sources `.tsx` de l'interface, chemins relatifs à la racine. */
function interfaceSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith(".tsx")) out.push(path);
    }
  };
  walk("app");
  walk("components");
  return out;
}

type RoleUse = { path: string; tag: string; role: string; openingLine: string };

/** Chaque balise HTML (minuscule) qui porte un `role="…"` littéral. */
function intrinsicRoleUses(path: string): RoleUse[] {
  const text = read(path);
  const lines = text.split("\n");
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const uses: RoleUse[] = [];
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (opening) {
      const tag = opening.tagName.getText(sf);
      for (const attr of opening.attributes.properties) {
        if (
          /^[a-z]/.test(tag) &&
          ts.isJsxAttribute(attr) &&
          attr.name.getText(sf) === "role" &&
          attr.initializer &&
          ts.isStringLiteral(attr.initializer)
        ) {
          const line = sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line;
          uses.push({ path, tag, role: attr.initializer.text, openingLine: lines[line] });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return uses;
}

describe("Balises natives plutôt que rôles ARIA (S6819)", () => {
  const uses = interfaceSources().flatMap(intrinsicRoleUses);

  it("le balayage trouve bien des rôles (garde-fou du parseur)", () => {
    expect(uses.length).toBeGreaterThan(20);
  });

  it("aucun `role=\"group\"` : un groupe est un `<fieldset>`", () => {
    expect(uses.filter((use) => use.role === "group").map((use) => use.path)).toEqual([]);
  });

  it("aucun `role=\"listitem\"` : une pastille de liste est un `<li>`", () => {
    expect(uses.filter((use) => use.role === "listitem").map((use) => use.path)).toEqual([]);
  });

  it("aucun `role=\"region\"` sur une balise : une région nommée est une `<section>`", () => {
    expect(uses.filter((use) => use.role === "region").map((use) => use.path)).toEqual([]);
  });

  // Ces rôles n'ont pas d'équivalent natif sans changer le comportement
  // (modale portée, voile, région live, barre stylée) : chacun porte sa raison
  // sur la ligne de sa balise, là où SonarQube relève le défaut.
  it.each<[string]>([["dialog"], ["alertdialog"], ["presentation"], ["status"], ["progressbar"]])(
    "chaque `role=\"%s\"` restant est justifié par un NOSONAR S6819",
    (role) => {
      const unjustified = uses
        .filter((use) => use.role === role && !/NOSONAR S6819 — \S/.test(use.openingLine))
        .map((use) => `${use.path}: ${use.openingLine.trim()}`);
      expect(unjustified).toEqual([]);
    },
  );

  it("`native-group` n'habille qu'un `<fieldset>`, `native-list` qu'une liste", () => {
    for (const path of interfaceSources()) {
      const source = read(path);
      for (const match of source.matchAll(/<(\w+)[^<>]*?\bnative-group\b/g)) expect(match[1]).toBe("fieldset");
      for (const match of source.matchAll(/<(\w+)[^<>]*?\bnative-list\b/g)) expect(["ul", "ol"]).toContain(match[1]);
    }
  });

  it("les résultats des dialogues de score sont des `<output>` en bloc", () => {
    for (const path of [
      "app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx",
      "app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("<output className={`${styles.stored} ${styles.notice}`}>");
      expect(source).toContain("<output className={`${styles.blocker} ${styles.notice}`}>");
    }
    expect(read("app/(secured)/tournois/[id]/_components/ScoreDialog.module.css")).toMatch(
      /\.notice\s*\{\s*display: block;/,
    );
  });
});

describe("Remise à zéro des balises natives (globals.css)", () => {
  const css = read("app/globals.css");

  it("efface l'habillage d'un fieldset sans spécificité, pour que tout style d'auteur l'emporte", () => {
    expect(css).toMatch(
      /:where\(fieldset\.native-group\)\s*\{\s*margin: 0;\s*padding: 0;\s*border: 0;\s*min-inline-size: auto;\s*\}/,
    );
  });

  it("efface puces et retraits d'une liste sans spécificité", () => {
    expect(css).toMatch(
      /:where\(ul\.native-list, ol\.native-list\)\s*\{\s*margin: 0;\s*padding: 0;\s*list-style: none;\s*\}/,
    );
  });

  it("ne touche pas aux fieldsets qui ne demandent rien", () => {
    expect(css).not.toMatch(/(^|[\s,}])fieldset\s*[,{]/m);
  });
});
