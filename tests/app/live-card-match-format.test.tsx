import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveCard } from "@/components/cyber/landing/LiveCard";
import type { LandingLive, LandingLiveMatch } from "@/lib/shared/landing";
import { MATCH_FORMAT_BOUNDS, matchFormatLabel } from "@/lib/shared/match-format";
import type { MatchFormat, TournamentCard } from "@/lib/shared/types";

/**
 * La carte « en cours » de l'accueil annonce le format des matchs du tournoi.
 *
 * Elle l'a longtemps **deviné** : un `toBestOfLabel` local rendait « BO5 » dès
 * que le nom de la manche contenait « final », « BO3 » sinon — sans jamais lire
 * `TournamentCard.matchFormat`. Un tournoi réglé en FT3 s'affichait donc
 * « BO3 », et un tournoi en score libre aussi. Ces tests tiennent la règle par
 * les deux bouts : la notation vient du réglage, et il n'y a qu'une fonction au
 * monde qui l'écrive.
 */

const ISO = "2026-09-01T18:00:00.000Z";

function tournament(matchFormat: MatchFormat | null): TournamentCard {
  return {
    id: 7,
    name: "Coupe Genji",
    description: null,
    format: "SINGLE",
    game: "OW2",
    participantType: "TEAM",
    maxTeams: 8,
    registeredTeams: 8,
    state: "RUNNING",
    startVisibilityAt: ISO,
    registrationOpenAt: ISO,
    registrationCloseAt: ISO,
    startAt: ISO,
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat,
    liveUrl: null,
  };
}

function match(roundLabel: string): LandingLiveMatch {
  return {
    id: 42,
    team1Name: "Alpha",
    team2Name: "Beta",
    team1Href: "/equipes/1",
    team2Href: "/equipes/2",
    team1Score: 1,
    team2Score: 0,
    bracket: "UPPER",
    roundLabel,
    liveState: "OFF",
    liveUrl: null,
  };
}

function live(matchFormat: MatchFormat | null, roundLabel = "Quart de finale"): LandingLive {
  return {
    tournament: tournament(matchFormat),
    currentMatch: match(roundLabel),
    viewers: 12,
    game: "Overwatch",
    phase: "PHASE ÉLIMINATOIRE",
    stream: null,
  };
}

const render = (value: LandingLive | null) =>
  renderToStaticMarkup(<LiveCard live={value} nextUpcomingISO={null} />);

describe("LiveCard — notation du format de match", () => {
  it("écrit « FT3 » pour un tournoi réglé en First to 3", () => {
    const html = render(live({ type: "FT", value: 3 }));
    expect(html).toContain("FT3");
    expect(html).not.toContain("BO");
  });

  it("écrit « BO5 » pour un tournoi réglé en Best of 5", () => {
    const html = render(live({ type: "BO", value: 5 }));
    expect(html).toContain("BO5");
    expect(html).not.toContain("FT");
  });

  it("n'annonce aucune notation sur un tournoi en score libre", () => {
    const html = render(live(null));
    expect(html).toContain("MATCH 42");
    expect(html).not.toContain("BO");
    expect(html).not.toContain("FT");
    // Le libellé de repli de `matchFormatLabel` n'a rien à faire dans une ligne
    // qui attend une notation : la carte se réduit au numéro du match.
    expect(html).not.toContain("Score libre");
  });

  it("ne déduit plus la notation du nom de la manche", () => {
    // Le bug d'origine : « final » dans le libellé de la manche faisait basculer
    // l'affichage sur BO5. Le réglage du tournoi doit primer dans les deux sens.
    expect(render(live({ type: "FT", value: 3 }, "Finale"))).toContain("FT3");
    expect(render(live({ type: "BO", value: 3 }, "Finale"))).toContain("BO3");
    expect(render(live({ type: "BO", value: 5 }, "Huitième de finale"))).toContain("BO5");
  });

  it("suit n'importe quelle valeur des deux notations, pas seulement 3 et 5", () => {
    for (const value of [1, 7, 9, 15]) {
      expect(render(live({ type: "BO", value }))).toContain(`BO${value}`);
    }
    for (const value of [1, 2, 4, 10]) {
      expect(render(live({ type: "FT", value }))).toContain(`FT${value}`);
    }
  });

  it("couvre tout le domaine accepté à la création d'un tournoi", () => {
    for (const type of ["BO", "FT"] as const) {
      const { min, max } = MATCH_FORMAT_BOUNDS[type];
      for (let value = min; value <= max; value += 1) {
        if (type === "BO" && value % 2 === 0) continue; // un « BO4 » n'existe pas
        expect(render(live({ type, value }))).toContain(matchFormatLabel({ type, value }));
      }
    }
  });

  it("ne rend aucune notation quand il n'y a pas de tournoi en cours", () => {
    const html = render(null);
    expect(html).toContain("INFO TOURNOI");
    expect(html).not.toContain("BO");
    expect(html).not.toContain("FT");
  });

  it("ne rend aucune notation quand le tournoi n'a pas de match à montrer", () => {
    const html = render({ ...live({ type: "FT", value: 3 }), currentMatch: null });
    expect(html).not.toContain("FT3");
  });
});

/**
 * Garde-fou de source, dans l'esprit d'`entity-links.test.ts` : la notation
 * `BO`/`FT` ne s'assemble qu'à un seul endroit.
 *
 * Le balayage porte sur **tout** `app/`, `components/` et `lib/`, et non sur
 * les trois fichiers du correctif : la régression qu'il existe pour attraper
 * est précisément l'apparition d'un second assembleur *ailleurs* — c'est ce
 * qu'était `toBestOfLabel`, dans un module de la vitrine que personne ne
 * relisait en pensant « format de match ».
 *
 * Deux signaux, et pas un de plus, pour rester tolérant aux refactorings :
 *
 * 1. une chaîne qui **est** une notation (`"BO3"`, `'FT5'`) — le libellé qu'on
 *    recopie au lieu de l'appeler. Une notation **citée en prose** reste
 *    permise : « (BO1, BO3, BO5…) » explique la règle dans une aide de saisie,
 *    il ne l'affiche pas ;
 * 2. l'assemblage d'un type et d'un nombre, par interpolation ou par
 *    concaténation.
 */
const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * Retire les commentaires : ils citent « BO5 » en prose, et un commentaire de
 * **fin de ligne** compte autant qu'un commentaire de pleine ligne — le
 * balayage est repo-wide, une seule note « // renvoie "BO5" » suffirait sinon à
 * rendre la suite rouge sans qu'aucun libellé n'ait été recopié.
 *
 * Le `[^:]` devant `//` épargne les protocoles (`https://…`), la seule paire de
 * barres qui traverse ce dépôt hors commentaire.
 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, (_match, before: string) => before);
}

/** Le seul module autorisé à écrire la notation. */
const SOURCE_OF_TRUTH = join("lib", "shared", "match-format.ts");

/** Tous les fichiers TypeScript du produit (hors tests, hors dépendances). */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(rel);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(rel);
      }
    }
  };
  for (const root of ["app", "components", "lib"]) walk(root);
  return out.filter((file) => file !== SOURCE_OF_TRUTH);
}

/** Une chaîne dont le contenu **entier** est une notation : « "BO3" », « 'FT5' ». */
const NOTATION_LITERAL = /"(?:BO|FT)\d+"|'(?:BO|FT)\d+'|`(?:BO|FT)\d+`/g;

/**
 * Un type et un nombre accolés : `` `${f.type}${f.value}` `` ou `type + value`.
 * C'est la forme qu'aurait une seconde implémentation de `matchFormatLabel`.
 */
const NOTATION_ASSEMBLY =
  /\$\{[^}]*\btype\b[^}]*\}\s*\$\{[^}]*\bvalue\b[^}]*\}|\btype\s*\+\s*[\w.]*\bvalue\b/g;

describe("source unique de la notation", () => {
  it("le balayage voit ce qu'il interdit", () => {
    // Garde-fou du garde-fou : sans ça, un motif cassé rendrait la suite verte.
    expect('const label = "BO3";'.match(NOTATION_LITERAL)).toHaveLength(1);
    expect("return `${format.type}${format.value}`;".match(NOTATION_ASSEMBLY)).toHaveLength(1);
    expect("return type + format.value;".match(NOTATION_ASSEMBLY)).toHaveLength(1);
    // …et laisse passer la prose, qui cite la notation sans l'afficher.
    expect('"Un Best of se joue en nombre impair (BO1, BO3, BO5…)."'.match(NOTATION_LITERAL))
      .toBeNull();
    // …y compris en commentaire de fin de ligne, et sans manger une URL.
    expect(stripComments('const x = 1; // renvoie "BO5"')).toBe("const x = 1; ");
    expect(stripComments('const u = "https://x.dev/a"; // note')).toBe(
      'const u = "https://x.dev/a"; ',
    );
  });

  it("balaye un ensemble de fichiers non vide", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(join("components", "cyber", "landing", "LiveCard.tsx"));
    expect(files).not.toContain(SOURCE_OF_TRUTH);
  });

  it("aucun fichier ne recopie ni n'assemble la notation hors du module partagé", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const code = stripComments(read(file));
      for (const pattern of [NOTATION_LITERAL, NOTATION_ASSEMBLY]) {
        pattern.lastIndex = 0;
        for (const hit of code.match(pattern) ?? []) offenders.push(`${file} → ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("`lib/shared/landing.ts` n'écrit plus de notation de format", () => {
    const code = stripComments(read(join("lib", "shared", "landing.ts")));
    expect(code).not.toMatch(/BO\d|FT\d/);
    expect(code).not.toContain("toBestOfLabel");
  });

  it("la carte de l'accueil lit le réglage du tournoi et passe par le module partagé", () => {
    const code = stripComments(read(join("components", "cyber", "landing", "LiveCard.tsx")));
    expect(code).toContain("matchFormatLabel");
    expect(code).toContain("tournament.matchFormat");
  });

  it("`matchFormatLabel` reste la seule sortie possible pour une notation", () => {
    // Contrat, pas texte source : le libellé est bien type + nombre, quelle que
    // soit la façon dont le module l'écrit.
    for (const type of ["BO", "FT"] as const) {
      const { min, max } = MATCH_FORMAT_BOUNDS[type];
      for (let value = min; value <= max; value += 1) {
        expect(matchFormatLabel({ type, value })).toBe(`${type}${value}`);
      }
    }
  });
});
