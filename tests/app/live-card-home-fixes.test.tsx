import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveCard, slideClock, slideNearActive } from "@/components/cyber/landing/LiveCard";
import { LANDING_CAROUSEL_TOUCH_HOLD_MS, pointerDownHoldsCarousel } from "@/components/cyber/landing/useMatchCarousel";
import { LandingTextProvider } from "@/components/i18n/landing-text";
import { landingClientMessages } from "@/lib/shared/landing-text";
import type { LandingLive, LandingLiveMatch } from "@/lib/shared/landing";
import enLanding from "@/messages/en/landing.json";
import { readSource } from "../helpers/read-source";
import { tournamentCard } from "../helpers/tournament-card";

/**
 * Carte « en cours » de l'accueil (lot ERREUR-FIX EF-01) : audience lisible
 * au lecteur d'écran, noms sans lien vers l'espace connecté pour un visiteur
 * sans compte, logos des seules diapositives proches, horloge réservée aux
 * matchs datés, survol et prise au toucher.
 */

const ISO = "2026-09-01T18:00:00.000Z";

function match(id: number, overrides: Partial<LandingLiveMatch> = {}): LandingLiveMatch {
  return {
    id,
    team1Name: `Alpha ${id}`,
    team2Name: `Beta ${id}`,
    team1Href: `/equipes/${id}1`,
    team2Href: `/joueurs/${id}2`,
    team1LogoUrl: `/api/uploads/teams/a${id}.webp`,
    team2LogoUrl: `/api/uploads/teams/b${id}.webp`,
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

function live(matches: LandingLiveMatch[], viewers = 0): LandingLive {
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
    currentMatch: matches[0] ?? null,
    matches,
    viewers,
    game: "Overwatch",
    phase: "MANCHE 1",
    stream: null,
  };
}

const render = (value: LandingLive, spectator = false) =>
  renderToStaticMarkup(<LiveCard live={value} nextUpcomingISO={null} spectator={spectator} />);

const renderEn = (value: LandingLive, spectator = false) =>
  renderToStaticMarkup(
    <LandingTextProvider locale="en" messages={landingClientMessages(enLanding)}>
      <LiveCard live={value} nextUpcomingISO={null} spectator={spectator} />
    </LandingTextProvider>,
  );

/** Logos chargés (`/_next/image` ou source locale), dans l'ordre du DOM. */
function logoSources(html: string): string[] {
  return [...html.matchAll(/teams%2F([ab]\d+)\.webp|teams\/([ab]\d+)\.webp/g)].map((found) => found[1] ?? found[2]);
}

describe("LiveCard — audience", () => {
  it("dit au lecteur d'écran ce que compte le nombre, FR et EN", () => {
    const fr = render(live([match(1)], 128));
    expect(fr).toContain('<span class="sr-only">128 personnes suivent le tournoi</span>');
    expect(fr).toMatch(/<span class="mono" aria-hidden="true">128<\/span>/);
    expect(fr).toMatch(/<svg[^>]*aria-hidden="true"[^>]*lucide-eye|<svg[^>]*lucide-eye[^>]*aria-hidden="true"/);
    const en = renderEn(live([match(1)], 128));
    expect(en).toContain('<span class="sr-only">128 people following the tournament</span>');
  });

  it("sous le seuil, ni nombre ni libellé", () => {
    const html = render(live([match(1)], 1));
    expect(html).not.toContain("suivent le tournoi");
    expect(html).not.toContain("suit le tournoi");
  });
});

describe("LiveCard — noms des engagés", () => {
  it("connecté : les noms mènent aux fiches, au titre neutre (équipe comme joueur)", () => {
    const html = render(live([match(1)]));
    expect(html).toContain('href="/equipes/11"');
    expect(html).toContain('href="/joueurs/12"');
    expect(html).toContain('title="Voir la fiche de Beta 1"');
    expect(html).not.toMatch(/title="[^"]*équipe[^"]*Beta 1/i);
    const en = renderEn(live([match(1)]));
    expect(en).toContain("title=\"View Beta 1&#x27;s page\"");
    expect(en).not.toMatch(/title="[^"]*team[^"]*Beta 1/i);
  });

  it("sans compte : noms en texte simple, la plaque mène à la vue sans compte", () => {
    for (const html of [render(live([match(1)]), true), renderEn(live([match(1)]), true)]) {
      expect(html).not.toContain('href="/equipes/11"');
      expect(html).not.toContain('href="/joueurs/12"');
      expect(html).not.toContain("Voir la fiche de");
      expect(html).not.toContain("&#x27;s page");
      expect(html).toContain("Alpha 1");
      expect(html).toContain('href="/suivre/tournois/7#match-1"');
    }
  });

  it("sans compte, carrousel : aucun nom cliquable dans aucune diapositive", () => {
    const html = render(live([match(1), match(2), match(3)]), true);
    expect(html).not.toMatch(/href="\/(equipes|joueurs)\//);
  });
});

describe("LiveCard — logos des diapositives", () => {
  it("un seul match : ses deux logos", () => {
    expect(new Set(logoSources(render(live([match(1)]))))).toEqual(new Set(["a1", "b1"]));
  });

  it("douze matchs : l'affiché et ses deux voisines seulement", () => {
    const twelve = Array.from({ length: 12 }, (_, index) => match(index + 1));
    const sources = logoSources(render(live(twelve)));
    // Ouvert sur le premier : ses voisines sont le deuxième et le dernier.
    expect(new Set(sources)).toEqual(new Set(["a1", "b1", "a2", "b2", "a12", "b12"]));
  });

  it("les diapositives sans logo gardent l'initiale", () => {
    const twelve = Array.from({ length: 12 }, (_, index) => match(index + 1));
    const html = render(live(twelve));
    expect(html).toContain("Alpha 6");
  });
});

describe("slideNearActive", () => {
  it("jusqu'à trois matchs, tous proches", () => {
    for (const count of [1, 2, 3]) {
      for (let index = 0; index < count; index += 1) expect(slideNearActive(index, 0, count)).toBe(true);
    }
  });

  it("circulaire : le dernier est voisin du premier", () => {
    expect(slideNearActive(11, 0, 12)).toBe(true);
    expect(slideNearActive(0, 11, 12)).toBe(true);
    expect(slideNearActive(1, 0, 12)).toBe(true);
    expect(slideNearActive(2, 0, 12)).toBe(false);
    expect(slideNearActive(6, 0, 12)).toBe(false);
  });
});

describe("slideClock", () => {
  it("seul un match daté hors antenne reçoit l'horloge", () => {
    expect(slideClock({ launchPhase: "SCHEDULED", liveState: "OFF" }, 42)).toBe(42);
    expect(slideClock({ launchPhase: "SCHEDULED", liveState: "SCHEDULED" }, 42)).toBe(42);
    expect(slideClock({ launchPhase: "SCHEDULED", liveState: "LIVE" }, 42)).toBeNull();
    expect(slideClock({ launchPhase: "LAUNCHED", liveState: "OFF" }, 42)).toBeNull();
    expect(slideClock({ launchPhase: "LOBBY", liveState: "OFF" }, 42)).toBeNull();
    expect(slideClock({ launchPhase: "SCHEDULED", liveState: "OFF" }, null)).toBeNull();
  });

  it("la diapositive est mémoïsée", () => {
    expect(readSource("components/cyber/landing/LiveCard.tsx")).toContain("const MatchSlide = memo(function MatchSlide(");
  });
});

describe("useMatchCarousel — prise au toucher", () => {
  it("le toucher et le stylet retiennent, pas la souris ni un bouton de la carte", () => {
    expect(pointerDownHoldsCarousel("touch", false)).toBe(true);
    expect(pointerDownHoldsCarousel("pen", false)).toBe(true);
    expect(pointerDownHoldsCarousel("mouse", false)).toBe(false);
    expect(pointerDownHoldsCarousel("touch", true)).toBe(false);
  });

  it("la prise a une échéance, repoussée à chaque toucher et levée au démontage", () => {
    expect(LANDING_CAROUSEL_TOUCH_HOLD_MS).toBeGreaterThan(0);
    const source = readSource("components/cyber/landing/useMatchCarousel.ts");
    expect(source).toContain("const held = hovered || focused || touched;");
    expect(source).toContain("if (touchTimer.current !== null) clearTimeout(touchTimer.current);");
    expect(source).toContain("}, LANDING_CAROUSEL_TOUCH_HOLD_MS);");
  });
});

describe("LiveCard.module.css", () => {
  const css = readSource("components/cyber/landing/LiveCard.module.css");

  it("le survol des commandes est réservé à un vrai pointeur", () => {
    expect(css).toContain("@media (hover: hover) and (pointer: fine) {\n  .carouselButton:hover {");
    expect(css).not.toMatch(/\.carouselButton:hover,/);
  });

  it("les diapositives cachées figent leurs animations par le jeton hérité", () => {
    expect(css).toContain(".slide:not(.slideActive) {\n  --deco-anim-state: paused;\n}");
    // Figées, pas retirées : `animation: none` éteignait la lueur au milieu du fondu.
    expect(css).not.toContain(".pill-waiting)::after {\n  animation: none;");
  });

  it("les animations infinies des pastilles d'une diapositive lisent ce jeton", () => {
    // Point de « En direct » et lueur de « En attente de lancement » : sans la
    // lecture du jeton, la pause des diapositives cachées ne les atteindrait pas.
    const globals = readSource("app/globals.css");
    expect(globals).toMatch(/\.pill-live \.dot \{[^}]*animation-play-state: var\(--deco-anim-state\);/);
    expect(globals).toMatch(/\.pill-waiting::after \{[^}]*animation-play-state: var\(--deco-anim-state\);/);
  });
});
