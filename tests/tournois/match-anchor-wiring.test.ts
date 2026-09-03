import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MATCH_ANCHOR_PREFIX } from "@/lib/shared/match-anchor";

/**
 * L'ancre `#match-[id]` ne s'observe pas dans un test unitaire : le harnais
 * Jest tourne en environnement `node`, sans DOM ni bibliothèque de rendu — un
 * hook qui appelle `document.getElementById` et `scrollIntoView` n'y est pas
 * montable. Ce qui décide se teste donc là où il vit, dans le module pur
 * (`tests/lib/shared/match-anchor.test.ts`).
 *
 * Restent les branchements, et ils portent tout le reste de la fonctionnalité :
 * une ancre publiée sans cible dans le DOM, ou une cible posée que personne ne
 * cherche, ne casse rien de visible — le lien mène simplement en haut de la
 * page. Ces cas tiennent donc les points de passage.
 */
const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const TOURNAMENT_DIR = join("app", "(secured)", "tournois", "[id]");
const MATCH_ROW = read(join(TOURNAMENT_DIR, "_components", "MatchRow.tsx"));
const PAGE = read(join(TOURNAMENT_DIR, "page.tsx"));
const HOOK = read(join(TOURNAMENT_DIR, "_hooks", "useMatchAnchor.ts"));
const GLOBALS = read("app/globals.css");
const SECTIONS = read(join(TOURNAMENT_DIR, "_components", "BracketSections.tsx"));
const LIVE_CARD = read("components/cyber/landing/LiveCard.tsx");

describe("ancre d'un match — points de passage", () => {
  it("pose l'identifiant DOM sur la carte de match", () => {
    expect(MATCH_ROW).toContain('from "@/lib/shared/match-anchor"');
    expect(MATCH_ROW).toContain("id={matchAnchorId(match.id)}");
  });

  it("le fait dans `MatchRow`, passage unique de toutes les vues", () => {
    // Arbre, survie, suisse, endurance : les quatre vues rendent leurs cartes
    // par `MatchRow`. Poser l'ancre ailleurs, c'est l'oublier dans trois vues.
    const components = join(ROOT, TOURNAMENT_DIR, "_components");
    const renderers = readdirSync(components).filter((file) => {
      if (!file.endsWith(".tsx") || file === "MatchRow.tsx") return false;
      return readFileSync(join(components, file), "utf8").includes("<MatchRow");
    });
    expect(renderers.sort()).toEqual(["BracketTree.tsx", "SurvivalView.tsx", "SwissView.tsx"]);
    // La quatrième (`EnduranceView`) reçoit sa carte déjà rendue par la page.
    expect(PAGE).toContain("<MatchRow");
  });

  it("branche le hook et le surlignage sur la page du tournoi", () => {
    expect(PAGE).toContain("useMatchAnchor(");
    expect(PAGE).toContain("<MatchAnchorProvider");
    // La bascule de phase passe par le sélecteur de la page : sans elle, une
    // ancre visant une phase non affichée ne trouverait jamais sa cible.
    expect(PAGE).toContain("onSelectPhase: setSelectedPhaseId");
  });

  it("déplie le volet où dort la cible", () => {
    // Un gros tableau ne rend qu'un volet à la fois : sans cette ouverture, le
    // hook chercherait dans le DOM un élément que rien ne rend, jusqu'à
    // renoncer. `BracketSections` est le seul endroit qui sache relier un match
    // à son volet.
    expect(SECTIONS).toContain("useMatchAnchorTarget()");
    expect(SECTIONS).toContain("setOpenKeys(");
    // On ajoute sans refermer : le lecteur reste libre de replier ensuite.
    expect(SECTIONS).toContain("prev.has(section.key) ? prev :");
  });

  it("attend la cible au lieu de la chercher une seule fois", () => {
    // Le plateau arrive par le flux SSE, après le premier rendu : chercher
    // l'élément une fois après le montage ne trouverait jamais rien.
    expect(HOOK).toContain("LOOKUP_TIMEOUT_MS");
    expect(HOOK).toContain("setTimeout(look");
  });

  it("renonce au bout d'un délai borné", () => {
    // Un identifiant qui ne désigne aucun match de ce tournoi ne doit pas
    // laisser une boucle derrière lui.
    expect(HOOK).toMatch(/Date\.now\(\) >= deadlineRef\.current/);
  });

  it("fait défiler les conteneurs ancestraux, pas seulement la page", () => {
    // `block`/`inline: "center"` : c'est ce qui rend l'ancre valable à
    // l'intérieur d'un `<ScrollArea>` horizontal (arbre, rondes, rounds).
    expect(HOOK).toContain('block: "center"');
    expect(HOOK).toContain('inline: "center"');
  });

  it("respecte le réglage « animations réduites » du système", () => {
    expect(HOOK).toContain("prefers-reduced-motion: reduce");
    expect(GLOBALS).toMatch(/\.match-anchor-target\s*\{/);
    // Le repère reste, seul le fondu disparaît : sans lui, on ne saurait plus
    // quelle carte on venait voir.
    const reduced = GLOBALS.slice(GLOBALS.indexOf(".match-anchor-target"));
    expect(reduced).toContain("animation: none");
  });
});

describe("ancre d'un match — une seule écriture du préfixe", () => {
  /**
   * Préfixe **suivi d'un identifiant** — une interpolation ou un chiffre.
   *
   * Ce que l'on traque est un `match-42` recopié à la main, pas les modules
   * voisins dont le nom commence par les mêmes lettres (`match-format-context`,
   * `match-schedule`, `match-lock`) : sans cette précision, le garde-fou
   * accuserait une demi-douzaine de fichiers innocents et serait désactivé.
   */
  const COPIED_PREFIX = new RegExp(`["'\`]#?${MATCH_ANCHOR_PREFIX}(\\$\\{|[0-9])`);

  /** Fichiers de code du dépôt (hors tests, hors dépendances). */
  function sourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) sourceFiles(path, found);
      else if (/\.tsx?$/.test(entry.name)) found.push(path);
    }
    return found;
  }

  it("n'écrit le préfixe qu'une fois, dans le module pur", () => {
    // Le préfixe est un contrat entre l'accueil (qui écrit le lien) et la fiche
    // du tournoi (qui le lit). Deux littéraux dériveraient sans qu'un test s'en
    // aperçoive : le lien mènerait simplement en haut de la page.
    const offenders = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]
      .filter((path) => !path.endsWith(join("lib", "shared", "match-anchor.ts")))
      .filter((path) => COPIED_PREFIX.test(read(path)));

    expect(offenders).toEqual([]);
  });

  it("saurait repérer un préfixe recopié ailleurs", () => {
    // Contre-épreuve du cas précédent : un filtre qui ne trouve jamais rien
    // passe aussi quand il ne cherche rien.
    expect(COPIED_PREFIX.test("const id = `match-${match.id}`;")).toBe(true);
    expect(COPIED_PREFIX.test('router.push("#match-42");')).toBe(true);
    expect(COPIED_PREFIX.test('import x from "./match-format-context";')).toBe(false);
    expect(COPIED_PREFIX.test('import { isScoreEditLocked } from "./match-lock";')).toBe(false);
  });

  it("fait descendre le chemin de l'accueil du même module", () => {
    expect(LIVE_CARD).toContain("tournamentMatchHref(");
    expect(LIVE_CARD).not.toContain("`/tournois/${");
  });
});
