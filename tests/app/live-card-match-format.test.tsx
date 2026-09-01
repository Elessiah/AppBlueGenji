import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
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
 * `BO`/`FT` ne s'écrit qu'à un seul endroit. Un `switch` recopié ailleurs est
 * exactement ce qui a produit le bug — il vivait dans `lib/shared/landing.ts`.
 */
const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Retire commentaires de bloc et de ligne : ils citent « BO5 » en prose. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("source unique de la notation", () => {
  it("`lib/shared/landing.ts` n'écrit plus de notation de format", () => {
    const code = stripComments(read("lib/shared/landing.ts"));
    expect(code).not.toMatch(/BO\d|FT\d/);
    expect(code).not.toContain("toBestOfLabel");
  });

  it("la carte de l'accueil lit le réglage du tournoi et passe par le module partagé", () => {
    const code = stripComments(read("components/cyber/landing/LiveCard.tsx"));
    expect(code).toContain("matchFormatLabel");
    expect(code).toContain("tournament.matchFormat");
    // Aucune notation en dur : la valeur vient de la donnée, pas d'un littéral.
    expect(code).not.toMatch(/["'`](?:BO|FT)\d+["'`]/);
  });

  it("`matchFormatLabel` reste la seule à assembler type et nombre", () => {
    const code = read("lib/shared/match-format.ts");
    // Une seule interpolation `${type}${value}` dans tout le module.
    const assembly = code.match(/\$\{format\.type\}\$\{format\.value\}/g) ?? [];
    expect(assembly).toHaveLength(1);
  });
});
