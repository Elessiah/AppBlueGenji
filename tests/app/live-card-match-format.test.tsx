import { describe, expect, it } from "@jest/globals";
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
 * « BO3 », et un tournoi en score libre aussi.
 *
 * Le garde-fou qui interdit une seconde implémentation de la notation vit avec
 * le module qu'il protège (`tests/lib/shared/match-format.test.ts`) : il porte
 * sur tout le dépôt, il n'a rien à faire dans un fichier nommé d'après un seul
 * écran.
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
    team1Seed: null,
    team2Seed: null,
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

/**
 * Notation lue **dans la ligne du match**, et non dans la page entière.
 *
 * Chercher « BO » dans tout le rendu paraissait plus sévère ; ça l'était trop :
 * un tournoi nommé « Bootcamp Genji », dont le titre est mis en capitales,
 * aurait fait échouer un test de FT3 sur le `BO` de `BOOTCAMP` — un faux
 * positif qui accuse le correctif au lieu du nom.
 */
function notationOf(html: string): string | null {
  const text = html.replace(/<[^>]*>/g, "");
  const found = /MATCH\s+\d+(?:\s*·\s*((?:BO|FT)\d+))?/.exec(text);
  expect(found).not.toBeNull(); // la ligne du match doit exister
  return found?.[1] ?? null;
}

describe("LiveCard — notation du format de match", () => {
  it("écrit « FT3 » pour un tournoi réglé en First to 3", () => {
    expect(notationOf(render(live({ type: "FT", value: 3 })))).toBe("FT3");
  });

  it("écrit « BO5 » pour un tournoi réglé en Best of 5", () => {
    expect(notationOf(render(live({ type: "BO", value: 5 })))).toBe("BO5");
  });

  it("n'annonce aucune notation sur un tournoi en score libre", () => {
    const html = render(live(null));
    expect(notationOf(html)).toBeNull();
    // Le libellé de repli de `matchFormatLabel` n'a rien à faire dans une ligne
    // qui attend une notation : la carte se réduit au numéro du match.
    expect(html).not.toContain("Score libre");
    expect(html.replace(/<[^>]*>/g, "")).toContain("MATCH 42");
  });

  it("ne déduit plus la notation du nom de la manche", () => {
    // Le bug d'origine : « final » dans le libellé de la manche faisait basculer
    // l'affichage sur BO5. Le réglage du tournoi doit primer dans les deux sens.
    expect(notationOf(render(live({ type: "FT", value: 3 }, "Finale")))).toBe("FT3");
    expect(notationOf(render(live({ type: "BO", value: 3 }, "Finale")))).toBe("BO3");
    expect(notationOf(render(live({ type: "BO", value: 5 }, "Huitième de finale")))).toBe("BO5");
    expect(notationOf(render(live(null, "Grande finale")))).toBeNull();
  });

  it("couvre tout le domaine accepté à la création d'un tournoi", () => {
    for (const type of ["BO", "FT"] as const) {
      const { min, max } = MATCH_FORMAT_BOUNDS[type];
      for (let value = min; value <= max; value += 1) {
        if (type === "BO" && value % 2 === 0) continue; // un « BO4 » n'existe pas
        expect(notationOf(render(live({ type, value })))).toBe(matchFormatLabel({ type, value }));
      }
    }
  });

  it("n'invente pas de notation à partir du nom du tournoi", () => {
    // « BOOTCAMP » contient « BO » ; la ligne du match n'en tire rien.
    const value = live(null);
    const html = render({ ...value, tournament: { ...value.tournament, name: "Bootcamp Genji" } });
    expect(notationOf(html)).toBeNull();
  });

  it("ne rend aucune notation quand il n'y a pas de tournoi en cours", () => {
    const html = render(null);
    expect(html).toContain("INFO TOURNOI");
    expect(html).not.toMatch(/\b(?:BO|FT)\d+\b/);
  });

  it("ne rend aucune notation quand le tournoi n'a pas de match à montrer", () => {
    const html = render({ ...live({ type: "FT", value: 3 }), currentMatch: null });
    expect(html).not.toMatch(/\b(?:BO|FT)\d+\b/);
  });

  it("lit le réglage du tournoi, pas celui d'un autre écran", () => {
    // Deux rendus successifs ne se contaminent pas : la carte n'a pas d'état.
    expect(notationOf(render(live({ type: "FT", value: 3 })))).toBe("FT3");
    expect(notationOf(render(live(null)))).toBeNull();
    expect(notationOf(render(live({ type: "BO", value: 1 })))).toBe("BO1");
  });
});
