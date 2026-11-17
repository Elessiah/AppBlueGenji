import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET } from "@/app/og/[locale]/[card]/route";
import {
  EMBED_CARD_CACHE_CONTROL,
  EMBED_CARD_TTL_MS,
  NEUTRAL_CARD_CACHE_CONTROL,
  STALE_CARD_CACHE_CONTROL,
  buildEmbedShareImage,
  clearNeutralShareImages,
  renderEmbedShareImage,
  withoutRightToLeftText,
} from "@/lib/server/embed-share-image";
import { renderPageShareImage } from "@/lib/server/page-share-image";
import { shareCardLogo } from "@/lib/server/share-card-logo";
import {
  clearShareImageCache,
  MAX_QUEUED_EMBED_RENDERS,
  MAX_QUEUED_EMBED_RENDERS_PER_CLIENT,
  type ShareRenderAdmission,
} from "@/lib/server/share-image-cache";
import { teamLogoDataUrl } from "@/lib/server/share-podium";
import {
  publicTournamentImageViewForRequest,
  publicTournamentShareForRequest,
  shareEmbedRenderAdmission,
  shareRequestClient,
} from "@/lib/server/spectator-request";
import type { PublicTournamentShare } from "@/lib/server/spectator-snapshot";
import {
  matchShareVersion,
  tournamentShareVersion,
  tournamentShareVersionWithoutSummary,
  type MatchShareSummary,
} from "@/lib/shared/share-embeds";
import { tournamentCard } from "../../helpers/tournament-card";

/** « النسور » : le moteur d'images échoue sur sa police. */
const ARABIC = String.fromCharCode(0x627, 0x644, 0x646, 0x633, 0x648, 0x631);

/**
 * Images d'aperçu d'un tournoi et d'un match partagés
 * (`docs/features/SHARE_EMBEDS.md`). `ImageResponse` est remplacée par un
 * double qui garde l'arbre : Satori ne tourne pas sous Jest, le PNG est vérifié
 * au rendu sur `next dev`.
 */

type FakeImageResponse = Response & { element: ReactElement };

/** Vrai pour un dessin que le moteur d'images (double) échoue à rendre ; `null` : jamais. */
const mockRenderFails: { when: ((element: unknown) => boolean) | null } = { when: null };

jest.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(
      readonly element: unknown,
      readonly options: unknown,
    ) {
      super("png", { headers: { "content-type": "image/png" } });
    }

    // Satori échoue à la lecture du flux, pas à la construction.
    override async arrayBuffer(): Promise<ArrayBuffer> {
      if (mockRenderFails.when?.(this.element)) throw new Error("lookupType: 5 - substFormat: 3 is not yet supported");
      return super.arrayBuffer();
    }
  },
}));
jest.mock("@/lib/server/spectator-request", () => ({
  publicTournamentImageViewForRequest: jest.fn(),
  publicTournamentShareForRequest: jest.fn(),
  shareEmbedRenderAdmission: jest.fn(),
  shareRequestClient: jest.fn(),
}));
jest.mock("@/lib/server/page-share-image", () => ({ renderPageShareImage: jest.fn() }));
jest.mock("@/lib/server/share-podium", () => ({ teamLogoDataUrl: jest.fn() }));
jest.mock("@/lib/server/share-card-logo");
jest.mock("@/lib/server/share-team", () => ({ TEAM_SHARE_LOGO_SIZE: 208 }));

const MATCH: MatchShareSummary = {
  matchId: 7,
  bracket: "UPPER",
  roundNumber: 1,
  matchNumber: 1,
  round: null,
  startAt: null,
  status: "COMPLETED",
  team1: { teamId: 10, name: "Alpha", logoUrl: "/uploads/teams/10.png", solo: false },
  team2: { teamId: 20, name: "Bravo", logoUrl: null, solo: false },
  score: { team1: 2, team2: 1 },
  winnerSide: 1,
  forfeitSide: null,
  doubleForfeit: false,
  maps: [{ mapNumber: 1, mapName: null, team1Score: 2, team2Score: 0, replayCode: "ABC123" }],
};

function view(overrides: Partial<MatchShareSummary> = {}): PublicTournamentShare {
  return {
    card: tournamentCard({ id: 4, name: "Spring Cup", state: "RUNNING" }),
    share: { leader: null, matches: new Map([[7, { ...MATCH, ...overrides }]]) },
    stale: false,
  };
}

const CLIENT = "203.0.113.7";

function admission(admit: () => boolean): ShareRenderAdmission {
  return {
    client: CLIENT,
    admit,
    refund: () => undefined,
    maxQueued: MAX_QUEUED_EMBED_RENDERS,
    maxQueuedPerClient: MAX_QUEUED_EMBED_RENDERS_PER_CLIENT,
  };
}

function neutral(): Response {
  return new Response("neutral", { headers: { "content-type": "image/png" } });
}

async function get(locale: string, card: string, query = ""): Promise<Response> {
  return GET(new Request(`http://127.0.0.1/og/${locale}/${card}${query}`), { params: Promise.resolve({ locale, card }) });
}

beforeEach(() => {
  clearShareImageCache();
  clearNeutralShareImages();
  jest.mocked(shareRequestClient).mockReset().mockResolvedValue(CLIENT);
  jest.mocked(publicTournamentImageViewForRequest).mockReset().mockResolvedValue(view());
  jest.mocked(publicTournamentShareForRequest).mockReset().mockResolvedValue(view());
  jest.mocked(shareEmbedRenderAdmission).mockReset().mockReturnValue(admission(() => true));
  jest.mocked(renderPageShareImage).mockReset().mockImplementation(async () => neutral());
  jest.mocked(teamLogoDataUrl).mockReset().mockResolvedValue(null);
  jest.mocked(shareCardLogo).mockReset().mockResolvedValue(null);
  mockRenderFails.when = null;
});

describe("GET /og/<langue>/<clé>.png — tournois et matchs", () => {
  it("GET_tournamentKey_rendersPngWithShortCache", async () => {
    const response = await get("fr", "tournament-4.png");

    expect(await response.text()).toBe("png");
    expect(response.headers.get("cache-control")).toBe(EMBED_CARD_CACHE_CONTROL);
    expect(publicTournamentImageViewForRequest).toHaveBeenCalledWith(4, CLIENT);
  });

  it("GET_matchKey_readsThePublicShare", async () => {
    await get("en", "tournament-4-match-7.png");

    expect(publicTournamentImageViewForRequest).not.toHaveBeenCalled();
    expect(publicTournamentShareForRequest).toHaveBeenCalledWith(4, CLIENT);
  });

  it("GET_tournamentVersionMatches_servesPublicCache", async () => {
    const shown = view();
    const version = tournamentShareVersion(shown.card, shown.share.leader);

    const response = await get("fr", "tournament-4.png", `?v=${version}`);

    expect(response.headers.get("cache-control")).toBe(EMBED_CARD_CACHE_CONTROL);
  });

  it("GET_tournamentWindowVersion_servesPublicCache", async () => {
    const version = tournamentShareVersionWithoutSummary(view().card);

    const response = await get("fr", "tournament-4.png", `?v=${version}`);

    expect(response.headers.get("cache-control")).toBe(EMBED_CARD_CACHE_CONTROL);
  });

  it("GET_tournamentVersionMismatch_servesNoStore", async () => {
    const response = await get("fr", "tournament-4.png", "?v=predicted");

    expect(await response.text()).toBe("png");
    expect(response.headers.get("cache-control")).toBe(STALE_CARD_CACHE_CONTROL);
  });

  it("GET_matchVersionMatches_servesPublicCache", async () => {
    const shown = view();
    const version = matchShareVersion(shown.card, shown.share.matches.get(7)!);

    const response = await get("fr", "tournament-4-match-7.png", `?v=${version}`);

    expect(response.headers.get("cache-control")).toBe(EMBED_CARD_CACHE_CONTROL);
  });

  it("GET_matchVersionMismatch_servesNoStore", async () => {
    const response = await get("fr", "tournament-4-match-7.png", "?v=future");

    expect(response.headers.get("cache-control")).toBe(STALE_CARD_CACHE_CONTROL);
  });

  it("GET_renderRefused_servesNeutralCard", async () => {
    jest.mocked(shareEmbedRenderAdmission).mockReturnValue(admission(() => false));

    const response = await get("fr", "tournament-4-match-7.png");

    expect(await response.text()).toBe("neutral");
    expect(response.headers.get("cache-control")).toBe(NEUTRAL_CARD_CACHE_CONTROL);
  });

  it("GET_neutralRenderedOnce_isServedFromMemoryAfterwards", async () => {
    jest.mocked(shareEmbedRenderAdmission).mockReturnValue(admission(() => false));

    const first = await get("fr", "tournament-4-match-7.png");
    const second = await get("fr", "tournament-4.png");

    expect(await first.text()).toBe("neutral");
    expect(await second.text()).toBe("neutral");
    expect(second.headers.get("cache-control")).toBe(NEUTRAL_CARD_CACHE_CONTROL);
    expect(renderPageShareImage).toHaveBeenCalledTimes(1);
  });

  it("GET_embedKey_readsClientOnceForReadAndAdmission", async () => {
    await get("fr", "tournament-4.png");

    expect(shareRequestClient).toHaveBeenCalledTimes(1);
    expect(shareEmbedRenderAdmission).toHaveBeenCalledWith(CLIENT);
  });

  it("GET_copyExpired_servesNoStore", async () => {
    jest.mocked(publicTournamentShareForRequest).mockResolvedValue({ ...view(), stale: true });

    const response = await get("fr", "tournament-4-match-7.png");

    expect(await response.text()).toBe("png");
    expect(response.headers.get("cache-control")).toBe(STALE_CARD_CACHE_CONTROL);
  });

  it("GET_matchKey_rendersPng", async () => {
    const response = await get("en", "tournament-4-match-7.png");

    expect(await response.text()).toBe("png");
  });

  it("GET_unpublishedTournament_servesNeutralCard", async () => {
    jest.mocked(publicTournamentImageViewForRequest).mockResolvedValue(null);

    const response = await get("en", "tournament-4.png");

    expect(await response.text()).toBe("neutral");
    expect(renderPageShareImage).toHaveBeenCalledWith("home", "en");
    expect(response.headers.get("cache-control")).toBe(NEUTRAL_CARD_CACHE_CONTROL);
  });

  it("GET_matchOfAnotherTournament_servesNeutralCard", async () => {
    const response = await get("fr", "tournament-4-match-99.png");

    expect(await response.text()).toBe("neutral");
  });

  it("GET_loaderThrows_servesNeutralCard", async () => {
    jest.mocked(publicTournamentImageViewForRequest).mockRejectedValue(new Error("db down"));

    const response = await get("fr", "tournament-4.png");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("neutral");
    // Refus passager : jamais gardé par un robot sous l'adresse versionnée.
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("GET_unknownLocale_returns404WithoutReading", async () => {
    const response = await get("de", "tournament-4.png");

    expect(response.status).toBe(404);
    expect(publicTournamentShareForRequest).not.toHaveBeenCalled();
  });
});

describe("renderEmbedShareImage — cache", () => {
  it("renderEmbedShareImage_notAnEmbedKey_returnsNull", async () => {
    expect(await renderEmbedShareImage("ranking", "fr")).toBeNull();
  });

  it("renderEmbedShareImage_sameContent_rendersOnce", async () => {
    await renderEmbedShareImage("tournament-4-match-7", "fr");
    await renderEmbedShareImage("tournament-4-match-7", "fr");

    expect(teamLogoDataUrl).toHaveBeenCalledTimes(2);
  });

  it("renderEmbedShareImage_scoreChanges_rendersAgain", async () => {
    await renderEmbedShareImage("tournament-4-match-7", "fr");
    jest.mocked(publicTournamentShareForRequest).mockResolvedValue(view({ score: { team1: 3, team2: 1 } }));

    await renderEmbedShareImage("tournament-4-match-7", "fr");

    expect(teamLogoDataUrl).toHaveBeenCalledTimes(4);
  });

  it("renderEmbedShareImage_otherLocale_rendersSeparately", async () => {
    await renderEmbedShareImage("tournament-4", "fr");
    await renderEmbedShareImage("tournament-4", "en");

    expect(shareCardLogo).toHaveBeenCalledTimes(2);
  });

  it("renderEmbedShareImage_unchangedContentAfterTenMinutes_isStillServedFromMemory", async () => {
    const start = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(start);
    try {
      await renderEmbedShareImage("tournament-4-match-7", "fr");
      clock.mockReturnValue(start + 10 * 60_000);
      await renderEmbedShareImage("tournament-4-match-7", "fr");
    } finally {
      clock.mockRestore();
    }

    // Une carte dont l'empreinte (donc la clé) n'a pas bougé n'est pas redessinée.
    expect(teamLogoDataUrl).toHaveBeenCalledTimes(2);
    expect(EMBED_CARD_TTL_MS).toBeGreaterThanOrEqual(60 * 60_000);
  });
});

describe("buildEmbedShareImage — contenu", () => {
  async function html(target: Parameters<typeof buildEmbedShareImage>[0], shown: PublicTournamentShare, locale: "fr" | "en") {
    const image = (await buildEmbedShareImage(target, shown, locale)) as unknown as FakeImageResponse | null;
    return image ? renderToStaticMarkup(image.element) : null;
  }

  it("buildEmbedShareImage_match_drawsTeamsScoreAndCode", async () => {
    const markup = await html({ kind: "match", tournamentId: 4, matchId: 7 }, view(), "en");

    expect(markup).toContain("Alpha");
    expect(markup).toContain("Bravo");
    expect(markup).toContain("ABC123");
    expect(markup).toContain("Spring Cup");
  });

  it("buildEmbedShareImage_soloMatch_drawsGenericPlayers", async () => {
    const solo = { teamId: 10, name: null, logoUrl: null, solo: true };

    const markup = await html({ kind: "match", tournamentId: 4, matchId: 7 }, view({ team1: solo, team2: { ...solo, teamId: 20 } }), "fr");

    expect(markup).toContain("Joueur 1");
    expect(markup).toContain("Joueur 2");
  });

  it("buildEmbedShareImage_tournamentWithLeader_drawsLeaderLogo", async () => {
    const shown: PublicTournamentShare = {
      ...view(),
      share: { leader: { kind: "WINNER", side: MATCH.team1 }, matches: new Map() },
    };

    const markup = await html({ kind: "tournament", tournamentId: 4 }, shown, "en");

    expect(markup).toContain("Winner: Alpha");
    expect(teamLogoDataUrl).toHaveBeenCalledWith("/uploads/teams/10.png", 208);
  });

  it("buildEmbedShareImage_missingMatch_returnsNull", async () => {
    expect(await html({ kind: "match", tournamentId: 4, matchId: 99 }, view(), "fr")).toBeNull();
  });
});

describe("carte d'un match — écriture de droite à gauche", () => {
  const drawsArabic = (element: unknown) => renderToStaticMarkup(element as ReactElement).includes(ARABIC);

  it("GET_arabicTeamName_retriesWithoutArabicLetters", async () => {
    mockRenderFails.when = drawsArabic;
    const rendered: string[] = [];
    const failing = mockRenderFails.when;
    mockRenderFails.when = (element) => {
      rendered.push(renderToStaticMarkup(element as ReactElement));
      return failing(element);
    };
    jest
      .mocked(publicTournamentShareForRequest)
      .mockResolvedValue(view({ team1: { teamId: 10, name: `Les ${ARABIC}`, logoUrl: null, solo: false } }));

    const response = await get("fr", "tournament-4-match-7.png");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("png");
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toContain(ARABIC);
    expect(rendered[1]).not.toContain(ARABIC);
    expect(rendered[1]).toContain("Les");
  });

  it("GET_renderFailsWithoutArabic_throwsAfterASingleRender", async () => {
    let renders = 0;
    mockRenderFails.when = () => {
      renders += 1;
      return true;
    };

    await expect(get("fr", "tournament-4-match-7.png")).rejects.toThrow("lookupType");
    // Rien à retirer : un nouvel essai ferait deux fois le même rendu perdu.
    expect(renders).toBe(1);
  });

  it("GET_arabicTeamName_readsEachLogoOnceAcrossBothAttempts", async () => {
    mockRenderFails.when = drawsArabic;
    jest.mocked(teamLogoDataUrl).mockClear();
    jest
      .mocked(publicTournamentShareForRequest)
      .mockResolvedValue(view({ team1: { teamId: 10, name: `Les ${ARABIC}`, logoUrl: "/uploads/teams/10.png", solo: false } }));

    await get("fr", "tournament-4-match-7.png");

    expect(teamLogoDataUrl).toHaveBeenCalledTimes(2);
  });

  it("withoutRightToLeftText_withMatchId_keepsOnlyThatMatch", () => {
    const shown = view();
    shown.share.matches = new Map([
      [7, MATCH],
      [8, { ...MATCH, matchId: 8 }],
    ]);

    expect([...withoutRightToLeftText(shown, 7).share.matches.keys()]).toEqual([7]);
  });

  it("withoutRightToLeftText_tournamentCard_copiesNoMatch", () => {
    // La carte du tournoi ne dessine aucun match : la copie n'en porte pas.
    expect(withoutRightToLeftText(view()).share.matches.size).toBe(0);
  });

  it("withoutRightToLeftText_description_marked", () => {
    const shown = view();
    shown.card = { ...shown.card, description: `${ARABIC} Ladder` };

    expect(withoutRightToLeftText(shown).card.description).toBe("\u2026 Ladder");
  });

  it("GET_tournamentCardArabicDescription_retriesAndServesPng", async () => {
    mockRenderFails.when = drawsArabic;
    const shown = view();
    shown.card = { ...shown.card, description: `${ARABIC} Ladder` };
    jest.mocked(publicTournamentImageViewForRequest).mockResolvedValue(shown);

    const response = await get("fr", "tournament-4.png");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("png");
  });

  it("GET_tournamentCardFailsWithArabicOnlyInMatches_throwsAfterSingleRender", async () => {
    let renders = 0;
    mockRenderFails.when = () => {
      renders += 1;
      return true;
    };
    jest
      .mocked(publicTournamentImageViewForRequest)
      .mockResolvedValue(view({ team1: { teamId: 10, name: ARABIC, logoUrl: null, solo: false } }));

    await expect(get("fr", "tournament-4.png")).rejects.toThrow("lookupType");
    // Les matchs ne sont pas dessinés : rien à retirer, aucun second rendu.
    expect(renders).toBe(1);
  });

  it("withoutRightToLeftText_namesAndMaps_loseArabicLetters", () => {
    const shown = view({
      team1: { teamId: 10, name: `${ARABIC} Alpha`, logoUrl: null, solo: false },
      team2: { teamId: 20, name: ARABIC, logoUrl: null, solo: false },
      maps: [{ mapNumber: 1, mapName: `Ilios ${ARABIC}`, team1Score: 2, team2Score: 0, replayCode: "ABC123" }],
    });
    shown.card = { ...shown.card, name: `${ARABIC} Cup` };
    shown.share = {
      ...shown.share,
      leader: { kind: "LEADER", side: { teamId: 10, name: `${ARABIC} Alpha`, logoUrl: null, solo: false } },
    };

    const plain = withoutRightToLeftText(shown, 7);
    const match = plain.share.matches.get(7);

    expect(match?.team1.name).toBe("\u2026 Alpha");
    expect(match?.team2.name).toBe("");
    expect(match?.maps[0]?.mapName).toBe("Ilios \u2026");
    expect(plain.card.name).toBe("\u2026 Cup");
    expect(plain.share.leader?.side.name).toBe("\u2026 Alpha");
    // L'original n'est pas modifié.
    expect(shown.share.matches.get(7)?.team1.name).toBe(`${ARABIC} Alpha`);
  });

  it("withoutRightToLeftText_soloSideWithoutName_staysNull", () => {
    const shown = view({ team1: { teamId: null, name: null, logoUrl: null, solo: true } });

    expect(withoutRightToLeftText(shown, 7).share.matches.get(7)?.team1.name).toBeNull();
  });
});
