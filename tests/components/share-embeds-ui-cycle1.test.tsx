/**
 * Corrections de la revue UI/UX, cycle 1 (`docs/features/SHARE_EMBEDS.md`) :
 * carte de match bornée, « Partager » après l'action principale, horloge de
 * publication, échec de copie qui montre l'adresse.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchShareCard, type MatchShareCardProps } from "@/components/og/match-share-card";
import { SHARE_CARD_COLORS } from "@/components/og/share-card";
import { isPublicMatch, offersMatchPage } from "@/app/(secured)/tournois/[id]/_lib/match-card-actions";
import {
  SHARE_PUBLISHED_MARGIN_MS,
  useTournamentPublished,
} from "@/app/(secured)/tournois/[id]/_lib/use-tournament-published";
import { readSource } from "../helpers/read-source";

const MARK = { initial: "A", logoUrl: null, logoSrc: null };

function props(overrides: Partial<MatchShareCardProps> = {}): MatchShareCardProps {
  return {
    eyebrow: "Tournoi",
    state: { label: "À venir", tone: "info" },
    title: "Titre",
    subtitle: "Manche 1",
    team1: { ...MARK, name: "Alpha", winner: false },
    team2: { ...MARK, name: "Beta", winner: false },
    center: { kind: "versus", text: "VS" },
    maps: [],
    moreMaps: null,
    noCode: "Sans code",
    footer: "pied",
    ...overrides,
  } as MatchShareCardProps;
}

function html(overrides: Partial<MatchShareCardProps> = {}): string {
  return renderToStaticMarkup(MatchShareCard(props(overrides)));
}

function nameColor(markup: string, name: string): string {
  const match = new RegExp(`color:([^;"]+)[^"]*">${name}<`).exec(markup);
  return match?.[1] ?? "";
}

describe("MatchShareCard — noms des camps", () => {
  it("MatchShareCard_noWinner_keepsBothNamesInFullInk", () => {
    const markup = html();
    expect(nameColor(markup, "Alpha")).toBe(SHARE_CARD_COLORS.ink);
    expect(nameColor(markup, "Beta")).toBe(SHARE_CARD_COLORS.ink);
  });

  it("MatchShareCard_winner_dimsOnlyTheLoser", () => {
    const markup = html({ team1: { ...MARK, name: "Alpha", winner: true } });
    expect(nameColor(markup, "Alpha")).toBe(SHARE_CARD_COLORS.ink);
    expect(nameColor(markup, "Beta")).toBe(SHARE_CARD_COLORS.inkMute);
  });
});

describe("MatchShareCard — textes bornés", () => {
  it("MatchShareCard_longForfeitLabel_isClampedInAFixedWidth", () => {
    const markup = html({ center: { kind: "label", text: "Forfait : " + "N".repeat(40) } });
    expect(markup).toMatch(/-webkit-line-clamp:2[^"]*width:240px|width:240px[^"]*-webkit-line-clamp:2/);
  });

  it("MatchShareCard_mapLabelAndSubtitle_areClampedToOneLine", () => {
    const markup = html({ maps: [{ label: "Map 1 · Une carte au nom très long", score: "2-1", code: "ABC123", winnerSide: 1 }] });
    expect(markup.match(/-webkit-line-clamp:1/g)?.length).toBeGreaterThanOrEqual(3);
    expect(markup).not.toContain("white-space:nowrap");
  });

  it("MatchShareCard_longReplayCode_wrapsAndShrinks", () => {
    const code = "X".repeat(32);
    const markup = html({ maps: [{ label: "Map 1", score: "1-0", code, winnerSide: 1 }] });
    expect(markup).toMatch(new RegExp(`word-break:break-all[^"]*font-size:20px[^"]*">${code}<|font-size:20px[^"]*word-break:break-all[^"]*">${code}<`));
  });

  it("MatchShareCard_shortReplayCode_keepsFullSize", () => {
    const markup = html({ maps: [{ label: "Map 1", score: "1-0", code: "ABC123", winnerSide: 1 }] });
    expect(markup).toMatch(/font-size:24px[^"]*">ABC123</);
  });
});

describe("isPublicMatch", () => {
  it("isPublicMatch_byeMatch_isFalse", () => {
    expect(isPublicMatch({ team1Id: 1, team2Id: null, status: "COMPLETED" })).toBe(false);
  });

  it("isPublicMatch_realMatch_isTrueEvenOnTheMatchPage", () => {
    const match = { team1Id: 1, team2Id: 2, status: "PENDING" } as const;
    expect(isPublicMatch(match)).toBe(true);
    expect(offersMatchPage(match, true)).toBe(false);
  });
});

describe("wiring", () => {
  it("useTournamentPublished_reads_theClockAndAcceptsNoCard", () => {
    const source = readSource("app/(secured)/tournois/[id]/_lib/use-tournament-published.ts");
    // L'horloge ne tourne que tant que le tournoi n'est pas publié (et jamais sans carte).
    expect(source).toContain("useClock(PUBLISHED_CLOCK_MS, card !== null && !published)");
    expect(source).toContain("card !== null && isTournamentPublished(card, new Date(Date.now() - SHARE_PUBLISHED_MARGIN_MS))");
  });

  it("TournamentHeader_shareButton_comesAfterTheRegisterButton", () => {
    const source = readSource("app/(secured)/tournois/[id]/_components/TournamentHeader.tsx");
    expect(source.indexOf("registerCta")).toBeGreaterThan(-1);
    expect(source.indexOf("<ShareLinkButton")).toBeGreaterThan(source.indexOf("registerCta"));
    // Une seule horloge : la fiche passe `published`, l'en-tête ne calcule que sans lui.
    expect(source).toContain("useTournamentPublished(publishedByPage === undefined ? card : null)");
    expect(readSource("app/(secured)/tournois/[id]/_components/TournamentSheet.tsx")).toContain("published={published}");
  });

  it("useShareLink_failed_toastCarriesTheUrl", () => {
    const source = readSource("components/share/ShareLinkButton.tsx");
    expect(source).toContain('showError(t("shareLink.copyFailed", { url }))');
    expect(readSource("messages/fr/tournament.json")).toContain("{url}");
    expect(readSource("messages/en/tournament.json")).toContain("copyFailed\": \"Couldn't copy the link: {url}");
  });
});

describe("useTournamentPublished — marge d'horloge", () => {
  const VISIBLE_AT = Date.parse("2026-05-13T20:00:00.000Z");

  function Probe({ startVisibilityAt }: Readonly<{ startVisibilityAt: string }>) {
    return <span>{String(useTournamentPublished({ startVisibilityAt }))}</span>;
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it("useTournamentPublished_withinClockMargin_returnsFalse", () => {
    jest.useFakeTimers({ now: VISIBLE_AT + SHARE_PUBLISHED_MARGIN_MS - 1 });

    expect(renderToStaticMarkup(<Probe startVisibilityAt="2026-05-13T20:00:00.000Z" />)).toBe("<span>false</span>");
  });

  it("useTournamentPublished_pastClockMargin_returnsTrue", () => {
    jest.useFakeTimers({ now: VISIBLE_AT + SHARE_PUBLISHED_MARGIN_MS });

    expect(renderToStaticMarkup(<Probe startVisibilityAt="2026-05-13T20:00:00.000Z" />)).toBe("<span>true</span>");
  });
});
