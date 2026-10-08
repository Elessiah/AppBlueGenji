import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveCard } from "@/components/cyber/landing/LiveCard";
import { resolveCarouselIndex } from "@/components/cyber/landing/useMatchCarousel";
import type { LandingLive, LandingLiveMatch } from "@/lib/shared/landing";
import { tournamentCard } from "../helpers/tournament-card";

/**
 * Carrousel de la carte « en cours » : elle faisait voir un seul match, elle
 * fait défiler ceux du tournoi dans l'ordre chronologique, sans changer de
 * hauteur ni perdre la plaque de lien vers le match affiché.
 */

const ISO = "2026-09-01T18:00:00.000Z";

function match(id: number, overrides: Partial<LandingLiveMatch> = {}): LandingLiveMatch {
  return {
    id,
    team1Name: `Alpha ${id}`,
    team2Name: `Beta ${id}`,
    team1Href: null,
    team2Href: null,
    team1LogoUrl: null,
    team2LogoUrl: null,
    team1Score: null,
    team2Score: null,
    team1Seed: null,
    team2Seed: null,
    bracket: "UPPER",
    roundLabel: "Manche 1",
    round: { kind: "round", number: 1 },
    matchFormat: null,
    liveState: "OFF",
    liveUrl: null,
    launchPhase: "LAUNCHED",
    startAt: null,
    ...overrides,
  };
}

function live(matches: LandingLiveMatch[] | undefined, currentMatch: LandingLiveMatch | null): LandingLive {
  return {
    tournament: tournamentCard({
      id: 7,
      name: "Coupe Genji",
      description: null,
      format: "SINGLE",
      game: "OW",
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
      matchFormat: null,
      liveUrl: null,
    }),
    currentMatch,
    matches,
    viewers: 0,
    game: "Overwatch",
    phase: "MANCHE 1",
    stream: null,
  };
}

const render = (value: LandingLive) => renderToStaticMarkup(<LiveCard live={value} nextUpcomingISO={null} />);

/** Classes des diapositives, dans l'ordre du DOM. */
function slideStates(html: string): boolean[] {
  return [...html.matchAll(/class="(slide(?: slideActive)?)"/g)].map((found) => found[1].includes("slideActive"));
}

describe("LiveCard — carrousel des matchs", () => {
  const three = [match(1), match(2), match(3)];

  it("rend tous les matchs, empilés, et n'en montre qu'un", () => {
    const html = render(live(three, three[0]));
    expect(slideStates(html)).toEqual([true, false, false]);
    expect(html).toContain("Alpha 3");
    // Les matchs masqués sortent de l'arbre d'accessibilité.
    expect(html.match(/aria-hidden="true"><div class="match"/g)).toHaveLength(2);
  });

  it("s'ouvre sur le match mis en avant, pas sur le premier de la liste", () => {
    const html = render(live(three, three[1]));
    expect(slideStates(html)).toEqual([false, true, false]);
    expect(html).toContain('href="/tournois/7#match-2"');
    expect(html).toContain('aria-label="Ouvrir Coupe Genji sur le match Alpha 2 contre Beta 2"');
  });

  it("porte les commandes, la position et le bouton de pause", () => {
    const html = render(live(three, three[0]));
    expect(html).toContain('aria-label="Match précédent"');
    expect(html).toContain('aria-label="Match suivant"');
    expect(html).toContain("Match 1 sur 3");
    expect(html).toContain('aria-label="Mettre en pause le défilement des matchs"');
    expect(html).toContain('aria-roledescription="carrousel"');
  });

  it("garde la carte d'origine pour un seul match : ni commandes ni pile", () => {
    const html = render(live([three[0]], three[0]));
    expect(slideStates(html)).toEqual([]);
    expect(html).not.toContain("Match suivant");
    expect(html).toContain('href="/tournois/7#match-1"');
  });

  it("retombe sur le match mis en avant quand le serveur n'envoie pas de liste", () => {
    const html = render(live(undefined, three[2]));
    expect(html).toContain("Alpha 3");
    expect(html).not.toContain("Match suivant");
  });

  it("garde l'état vide sans aucun match", () => {
    const html = render(live([], null));
    expect(html).toContain("Le prochain match en direct sera affiché ici dès son lancement.");
    expect(html).toContain('href="/tournois/7"');
  });
});

describe("resolveCarouselIndex", () => {
  it("garde le match regardé tant qu'il est dans la liste", () => {
    expect(resolveCarouselIndex([4, 5, 6], 6, 4)).toBe(2);
  });

  it("revient au match mis en avant quand le match regardé a disparu", () => {
    expect(resolveCarouselIndex([4, 5, 6], 9, 5)).toBe(1);
    expect(resolveCarouselIndex([4, 5, 6], null, 5)).toBe(1);
  });

  it("retombe sur le premier sans repère utilisable", () => {
    expect(resolveCarouselIndex([4, 5, 6], null, null)).toBe(0);
    expect(resolveCarouselIndex([4, 5, 6], 9, 9)).toBe(0);
    expect(resolveCarouselIndex([], null, null)).toBe(0);
  });
});

describe("useMatchCarousel — régime de charge", () => {
  const source = readFileSync(join(process.cwd(), "components/cyber/landing/useMatchCarousel.ts"), "utf8");

  it("ne fait défiler qu'avec les animations permises, et jamais sous le lecteur", () => {
    expect(source).toContain("const { decorativeMotion } = useClientPower();");
    expect(source).toContain("const rotating = canRotate && !paused && !hovered && !focused;");
  });

  it("ne se laisse retenir ni par le toucher ni par le focus d'un clic", () => {
    // Rien ne relâcherait la prise : le carrousel resterait figé sous « Pause ».
    expect(source).toContain('if (event.pointerType === "mouse") setHovered(true);');
    expect(source).toContain('setFocused(event.target.matches(":focus-visible"))');
    expect(source).not.toContain("onMouseEnter");
  });
});
