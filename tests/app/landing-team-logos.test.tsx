import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamSigil } from "@/components/cyber/TeamSigil";
import { Leaderboard } from "@/components/cyber/landing/Leaderboard";
import { LiveCard } from "@/components/cyber/landing/LiveCard";
import type { LandingLeaderboardRow, LandingLive, LandingLiveMatch } from "@/lib/shared/landing";
import type { TournamentCard } from "@/lib/shared/types";

/**
 * Logos d'équipe sur l'accueil.
 *
 * Le classement recevait déjà `logoUrl` de `/api/landing/leaderboard` et ne
 * dessinait que l'initiale ; la carte du match en direct n'avait pas le logo du
 * tout. `TeamSigil` prend désormais un logo facultatif, rendu dans le même cadre,
 * l'initiale restant le repli.
 */

function imgTags(markup: string): string[] {
  return markup.match(/<img\b[^>]*>/g) ?? [];
}

describe("TeamSigil — logo facultatif", () => {
  it("rend le logo à la place du sigle, décoratif", () => {
    const html = renderToStaticMarkup(
      <TeamSigil label="D" size={24} logoUrl="/api/uploads/teams/d.webp" />,
    );
    const [img] = imgTags(html);

    expect(img).toContain('alt=""');
    expect(img).toContain(encodeURIComponent("/api/uploads/teams/d.webp"));
    expect(html).not.toContain(">D<");
  });

  it("garde le sigle sans logo, comme avant", () => {
    for (const logoUrl of [undefined, null]) {
      const html = renderToStaticMarkup(<TeamSigil label="bgx" size={40} logoUrl={logoUrl} />);

      expect(imgTags(html)).toHaveLength(0);
      expect(html).toContain(">BGX<");
    }
  });

  it("garde la taille du cadre, logo ou pas", () => {
    const withLogo = renderToStaticMarkup(
      <TeamSigil label="D" size={40} logoUrl="/api/uploads/teams/d.webp" />,
    );
    expect(withLogo).toContain("--size:40px");
  });
});

function row(overrides: Partial<LandingLeaderboardRow> = {}): LandingLeaderboardRow {
  return {
    rank: 1,
    teamId: 5,
    teamName: "Dragon Squad",
    logoUrl: null,
    wins: 3,
    losses: 1,
    points: 540,
    trend: "flat",
    trendValue: 0,
    ...overrides,
  };
}

describe("Leaderboard — logos des équipes classées", () => {
  it("rend le logo de l'équipe qui en a un, l'initiale sinon", () => {
    const html = renderToStaticMarkup(
      <Leaderboard
        initialRows={[
          row({ logoUrl: "/api/uploads/teams/dragon.webp" }),
          row({ rank: 2, teamId: 6, teamName: "Ember Core" }),
        ]}
      />,
    );

    expect(imgTags(html)).toHaveLength(1);
    expect(imgTags(html)[0]).toContain(encodeURIComponent("/api/uploads/teams/dragon.webp"));
    expect(html).toContain(">E<");
  });
});

const ISO = "2026-09-01T18:00:00.000Z";

function tournament(): TournamentCard {
  return {
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
  } as TournamentCard;
}

function match(overrides: Partial<LandingLiveMatch> = {}): LandingLiveMatch {
  return {
    id: 42,
    team1Name: "Alpha",
    team2Name: "Beta",
    team1Href: "/equipes/1",
    team2Href: "/equipes/2",
    team1LogoUrl: null,
    team2LogoUrl: null,
    team1Score: 1,
    team2Score: 0,
    team1Seed: null,
    team2Seed: null,
    bracket: "UPPER",
    roundLabel: "Quart de finale",
    matchFormat: null,
    liveState: "OFF",
    liveUrl: null,
    ...overrides,
  };
}

function live(currentMatch: LandingLiveMatch): LandingLive {
  return {
    tournament: tournament(),
    currentMatch,
    viewers: 12,
    game: "Overwatch",
    phase: "PHASE ÉLIMINATOIRE",
    stream: null,
  } as LandingLive;
}

describe("LiveCard — logos des deux engagés du match en avant", () => {
  it("rend le logo de chaque côté qui en a un", () => {
    const html = renderToStaticMarkup(
      <LiveCard
        live={live(match({ team2LogoUrl: "/api/uploads/teams/beta.webp" }))}
        nextUpcomingISO={null}
      />,
    );

    expect(imgTags(html)).toHaveLength(1);
    expect(imgTags(html)[0]).toContain(encodeURIComponent("/api/uploads/teams/beta.webp"));
    // L'autre côté garde son initiale.
    expect(html).toContain(">A<");
  });

  it("ne rend aucune image quand aucun engagé n'a de logo", () => {
    const html = renderToStaticMarkup(<LiveCard live={live(match())} nextUpcomingISO={null} />);

    expect(imgTags(html)).toHaveLength(0);
  });
});
