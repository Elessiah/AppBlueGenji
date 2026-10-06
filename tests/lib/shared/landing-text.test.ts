import { describe, expect, it } from "@jest/globals";
import { createTranslator } from "next-intl";
import { messagesFor } from "@/lib/server/i18n-messages";
import { landingServerText } from "@/lib/server/i18n-landing";
import { FR_LANDING_MESSAGES, landingText, type LandingKey } from "@/lib/shared/landing-text";
import { boardActionKey, boardStateKey, boardStateLabel, boardActionLabel, formatBoardStartAt } from "@/lib/shared/landing-board";
import { frenchRoundLabel, landingRound } from "@/lib/shared/landing";
import { FORMAT_LABELS } from "@/lib/shared/tournament-labels";
import { SPONSOR_TIER_LABELS } from "@/lib/shared/sponsors";
import { SITE_DESCRIPTION } from "@/lib/shared/share-metadata";
import { LOCALES, SITE_TIME_ZONE } from "@/lib/shared/locales";
import { messageAt } from "@/lib/shared/scoped-text";
import { tournamentCard } from "../../helpers/tournament-card";

type Tree = { [key: string]: string | Tree };

function leafKeys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : leafKeys(value, path);
  });
}

function sampleValues(message: string, count: number): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [, name, type] of message.matchAll(/\{\s*([A-Za-z_]\w*)\s*(?:,\s*(\w+))?/g)) {
    values[name] = type === "plural" ? count : `«${name}»`;
  }
  return values;
}

describe("accueil — équivalence avec next-intl, message par message", () => {
  const keys = leafKeys(FR_LANDING_MESSAGES as unknown as Tree);

  it.each(LOCALES.map((locale) => [locale]))("%s : même texte que next-intl, pluriels compris", (locale) => {
    const messages = messagesFor(locale);
    const reference = createTranslator({ locale, messages, timeZone: SITE_TIME_ZONE, namespace: "landing" });
    const ours = landingText(locale, messages.landing);
    for (const key of keys) {
      const source = messageAt(messages.landing, key);
      expect(source).toBeDefined();
      for (const count of [0, 1, 2, 5]) {
        const values = sampleValues(source ?? "", count);
        const expected = reference(key as Parameters<typeof reference>[0], values);
        expect(`${key}: ${ours.t(key as LandingKey, values)}`).toBe(`${key}: ${expected}`);
      }
    }
  });

  it("une clé absente s'affiche telle quelle plutôt que de faire tomber la page", () => {
    expect(landingText("en").t("nope.missing" as LandingKey)).toBe("nope.missing");
  });
});

describe("accueil — le français reprend les textes de référence", () => {
  const { t } = landingServerText("fr");

  it("description du site, formats, paliers", () => {
    expect(t("meta.description")).toBe(SITE_DESCRIPTION);
    for (const [format, label] of Object.entries(FORMAT_LABELS)) {
      expect(t(`board.format.${format as keyof typeof FORMAT_LABELS}`)).toBe(label);
    }
    for (const [tier, label] of Object.entries(SPONSOR_TIER_LABELS)) {
      expect(t(`sponsors.tier.${tier as keyof typeof SPONSOR_TIER_LABELS}`)).toBe(label);
    }
  });

  it("états et actions des cartes : la clé et le libellé français disent la même chose", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    const cards = [
      tournamentCard({ state: "REGISTRATION", registrationOpenAt: "2026-10-01T10:00:00Z", registrationCloseAt: "2026-10-10T10:00:00Z", startAt: "2026-10-12T10:00:00Z" }),
      tournamentCard({ state: "REGISTRATION", maxTeams: 8, registeredTeams: 8, registrationOpenAt: "2026-10-01T10:00:00Z", registrationCloseAt: "2026-10-10T10:00:00Z", startAt: "2026-10-12T10:00:00Z" }),
      tournamentCard({ state: "RUNNING", format: "DOUBLE", startAt: "2026-10-05T10:00:00Z" }),
      tournamentCard({ state: "RUNNING", format: "SWISS", startAt: "2026-10-05T10:00:00Z" }),
      tournamentCard({ state: "FINISHED" }),
    ];
    for (const card of cards) {
      expect(t(`board.state.${boardStateKey(card, now)}`)).toBe(boardStateLabel(card, now));
      const action = boardActionKey(card, now);
      expect(action === "view" ? t("common.viewTournament") : t(`board.action.${action}`)).toBe(boardActionLabel(card, now));
    }
  });

  it("noms de manche", () => {
    for (const [bracket, count] of [["UPPER", 1], ["LOWER", 2], ["UPPER", 4], ["LOWER", 3]] as const) {
      const round = landingRound(bracket, 3, count);
      const key = round.kind === "round" ? "live.round.round" : (`live.round.${round.kind}` as const);
      expect(t(key, { n: String(round.number) })).toBe(frenchRoundLabel(round));
    }
  });
});

describe("accueil — l'anglais applique le glossaire figé", () => {
  const { t } = landingServerText("en");

  it("modes, rôles de pastille, inscriptions", () => {
    expect(t("board.format.BG_SURVIE")).toBe("BlueGenji's Survival");
    expect(t("board.format.SURVIVAL")).toBe("Survival (cuts)");
    expect(t("board.format.MULTI")).toBe("Multi-stage");
    expect(t("board.state.registration")).toBe("Registration open");
    expect(t("board.state.running")).toBe("In progress");
    expect(t("live.pill.live")).toBe("Live");
  });

  it("pluriels anglais", () => {
    expect(t("board.openCount", { count: 0 })).toBe("0 OPEN TOURNAMENTS");
    expect(t("board.openCount", { count: 1 })).toBe("1 OPEN TOURNAMENT");
    expect(t("leaderCal.rankedCount", { count: 2 })).toBe("2 RANKED TEAMS");
    expect(t("sponsors.count", { count: 1 })).toBe("1 PARTNER");
  });

  it("dates du tableau à l'américaine, même fuseau", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    expect(formatBoardStartAt("2026-10-21T18:30:00Z", now, "en")).toBe("Oct 21 · 08:30 PM");
    expect(formatBoardStartAt("2026-10-21T18:30:00Z", now, "fr")).toBe("21 oct. · 20:30");
  });
});
