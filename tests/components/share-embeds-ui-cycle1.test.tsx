/**
 * Corrections de la revue UI/UX, cycle 1 (`docs/features/SHARE_EMBEDS.md`) :
 * carte de match bornée, « Partager » après l'action principale, horloge de
 * publication, échec de copie qui montre l'adresse.
 */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchShareCard, type MatchShareCardProps } from "@/components/og/match-share-card";
import { SHARE_CARD_COLORS } from "@/components/og/share-card";
import { isPublicMatch, offersMatchPage } from "@/app/(secured)/tournois/[id]/_lib/match-card-actions";
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
    expect(source).toContain("useClock(PUBLISHED_CLOCK_MS)");
    expect(source).toMatch(/if \(card === null\) return false;/);
    expect(source).toContain("new Date(now)");
  });

  it("TournamentHeader_shareButton_comesAfterTheRegisterButton", () => {
    const source = readSource("app/(secured)/tournois/[id]/_components/TournamentHeader.tsx");
    expect(source.indexOf("registerCta")).toBeGreaterThan(-1);
    expect(source.indexOf("<ShareLinkButton")).toBeGreaterThan(source.indexOf("registerCta"));
    expect(source).toContain("useTournamentPublished(card)");
  });

  it("useShareLink_failed_toastCarriesTheUrl", () => {
    const source = readSource("components/share/ShareLinkButton.tsx");
    expect(source).toContain('showError(t("shareLink.copyFailed", { url }))');
    expect(readSource("messages/fr/tournament.json")).toContain("{url}");
    expect(readSource("messages/en/tournament.json")).toContain("copyFailed\": \"Couldn't copy the link: {url}");
  });
});
