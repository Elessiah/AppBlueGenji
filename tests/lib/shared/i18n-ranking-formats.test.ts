import { describe, expect, it } from "@jest/globals";
import { createTranslator } from "next-intl";
import { STATE_META } from "@/app/(secured)/tournois/[id]/_lib/header-meta";
import { messagesFor } from "@/lib/server/i18n-messages";
import { formatLocalDate, formatLocalDateTime, formatLocalNumber, shortMonthLabel } from "@/lib/shared/dates";
import { INTL_LOCALE, LOCALES, SITE_TIME_ZONE } from "@/lib/shared/locales";
import { formatMessageParts } from "@/lib/shared/message-format";
import { plural } from "@/lib/shared/plural";
import {
  RANKING_PLACEMENT_HINT,
  RANKING_PLACEMENT_LABEL,
  RANKING_POINTS_LABEL,
  rankingPointsHint,
  rankingPointsHintKind,
  RANKING_BASE_POINTS,
} from "@/lib/shared/ranking";
import { FORMAT_STAT_LABELS, GAME_STAT_LABELS, formatRate, formatRecord, formatStreak, type StatsStreak } from "@/lib/shared/stats";
import { statsPointsHint, statsRate, statsRecord, statsSplitLabel, statsStreak, statsText } from "@/lib/shared/stats-text";
import { FORMAT_LABELS, GAME_LABELS, localizedTournamentLabel } from "@/lib/shared/tournament-labels";
import type { TournamentFormat } from "@/lib/shared/types";

/**
 * Lot 4 : libellés de domaine partagés, dates, nombres et pluriels par langue
 * (`docs/features/I18N.md` § Dates, nombres, pluriels). Le français des
 * messages reproduit **mot pour mot** les tables et phrases que gardent les
 * écrans pas encore traduits.
 */

const FORMATS = Object.keys(FORMAT_LABELS) as TournamentFormat[];

describe("libellés de format, de jeu et d'état — espace `labels`", () => {
  const fr = messagesFor("fr").labels;
  const en = messagesFor("en").labels;

  it("le français égale les tables des écrans non traduits", () => {
    expect(fr.format).toEqual(FORMAT_LABELS);
    expect(fr.formatShort).toEqual(FORMAT_STAT_LABELS);
    expect(fr.game).toEqual(GAME_LABELS);
    expect(fr.game).toEqual(GAME_STAT_LABELS);
    expect(fr.state).toEqual(Object.fromEntries(Object.entries(STATE_META).map(([state, meta]) => [state, meta.label])));
  });

  it("l'anglais applique le glossaire figé", () => {
    expect(en.format).toEqual({
      SINGLE: "Single elimination",
      DOUBLE: "Double elimination",
      SWISS: "Swiss",
      SURVIVAL: "Survival (cuts)",
      MULTI: "Multi-stage",
      BG_SURVIE: "BlueGenji's Survival",
    });
    expect(en.state).toEqual({
      UPCOMING: "Upcoming",
      REGISTRATION: "Registration open",
      RUNNING: "In progress",
      FINISHED: "Finished",
    });
    expect(en.game).toEqual(GAME_LABELS);
  });

  it("lit par code, et rend un code inconnu tel quel", () => {
    for (const format of FORMATS) expect(localizedTournamentLabel(fr, "format", format)).toBe(FORMAT_LABELS[format]);
    expect(localizedTournamentLabel(en, "state", "RUNNING")).toBe("In progress");
    expect(localizedTournamentLabel(en, "format", "LEGACY")).toBe("LEGACY");
    expect(statsSplitLabel(en, "formatShort", { key: "LEGACY", label: "Ancien" })).toBe("Ancien");
  });
});

describe("dates et nombres par langue", () => {
  const date = new Date("2026-03-09T18:30:00Z");

  it("le français reste celui d'avant, la langue étant facultative", () => {
    expect(formatLocalDate(date)).toBe(date.toLocaleDateString("fr-FR"));
    expect(formatLocalDateTime(date)).toBe(date.toLocaleString("fr-FR"));
    expect(formatLocalDate(date, "fr")).toBe(formatLocalDate(date));
  });

  it("l'anglais suit en-US", () => {
    expect(INTL_LOCALE.en).toBe("en-US");
    expect(formatLocalDate(date, "en")).toBe(date.toLocaleDateString("en-US"));
    expect(formatLocalDate(date, "en")).toMatch(/^3\/\d{1,2}\/2026$/);
  });

  it("mois abrégés : la liste française d'avant, l'anglais d'Intl", () => {
    const before = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    for (let month = 1; month <= 12; month += 1) {
      const key = `2026-${String(month).padStart(2, "0")}`;
      expect(shortMonthLabel(key)).toBe(before[month - 1]);
    }
    expect(shortMonthLabel("2026-01", "en")).toBe("Jan");
    expect(shortMonthLabel("2026-09", "en")).toBe("Sep");
    expect(shortMonthLabel("n/a")).toBe("n/a");
    expect(shortMonthLabel("2026-13")).toBe("2026-13");
  });

  it("nombres : virgule décimale en français, point en anglais", () => {
    expect(formatLocalNumber(1.5)).toBe("1,5");
    expect(formatLocalNumber(1.5, "en")).toBe("1.5");
    expect(formatLocalNumber(1500, "en")).toBe("1,500");
  });
});

describe("phrases du bloc de statistiques — français identique, anglais au pluriel ICU", () => {
  const fr = statsText("fr");
  const en = statsText("en", messagesFor("en").stats);

  it("bilans, taux, séries : mot pour mot les phrases de `stats.ts`", () => {
    for (const record of [
      { played: 5, won: 4, lost: 1 },
      { played: 3, won: 1, lost: 1 },
      { played: 0, won: 0, lost: 0 },
    ]) {
      expect(statsRecord(fr, record)).toBe(formatRecord(record));
    }
    for (const rate of [null, 0, 0.625, 1]) expect(statsRate(fr, rate)).toBe(formatRate(rate));
    const streaks: StatsStreak[] = [
      { kind: "NONE", length: 0 },
      { kind: "DRAW", length: 1 },
      { kind: "WIN", length: 1 },
      { kind: "WIN", length: 4 },
      { kind: "LOSS", length: 2 },
    ];
    for (const streak of streaks) expect(statsStreak(fr, streak)).toBe(formatStreak(streak));
  });

  it("légendes de la cote : mot pour mot celles de `ranking.ts`", () => {
    const messages = messagesFor("fr").stats.ranking;
    expect(messages.pointsLabel).toBe(RANKING_POINTS_LABEL);
    expect(messages.placementLabel).toBe(RANKING_PLACEMENT_LABEL);
    expect(messages.placementHint).toBe(RANKING_PLACEMENT_HINT);
    for (const [ranked, points] of [[true, 640], [false, RANKING_BASE_POINTS], [false, 486]] as const) {
      expect(statsPointsHint(fr, ranked, points)).toBe(rankingPointsHint(ranked, points));
    }
    expect(rankingPointsHintKind(false, 486)).toBe("placementOnly");
  });

  it("le pluriel suit la langue : 0 et 1 au singulier en français, 1 seul en anglais", () => {
    expect(fr.t("tile.upcomingEntries", { count: 1 })).toBe(`+ ${plural(1, "inscription")} à venir`);
    expect(fr.t("tile.upcomingEntries", { count: 3 })).toBe(`+ ${plural(3, "inscription")} à venir`);
    expect(en.t("tile.upcomingEntries", { count: 1 })).toBe("+ 1 upcoming entry");
    expect(en.t("activity.barTitle", { month: "Jan", year: "2026", played: 0, won: 0 })).toBe("Jan 2026: 0 matches, 0 wins");
    expect(fr.t("activity.barTitle", { month: "janv.", year: "2026", played: 0, won: 0 })).toBe("janv. 2026 : 0 match, 0 victoire");
    expect(statsRecord(en, { played: 3, won: 1, lost: 1 })).toBe("1W / 1D / 1L");
    expect(statsRate(en, 0.625)).toBe("63%");
  });
});

/**
 * Le classement et le bloc de statistiques passent par le formateur réduit,
 * côté serveur comme côté client : chaque message doit y donner le même texte
 * que `next-intl`, pluriels et gras compris.
 */
describe("ranking, stats, labels — équivalence avec next-intl, message par message", () => {
  type Leaf = { key: string; source: string };
  const leaves = (tree: unknown, prefix = ""): Leaf[] =>
    typeof tree === "string"
      ? [{ key: prefix, source: tree }]
      : Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));

  function sampleValues(message: string, count: number): Record<string, string | number> {
    const values: Record<string, string | number> = {};
    for (const [, name, type] of message.matchAll(/\{\s*([A-Za-z_]\w*)\s*(?:,\s*(\w+))?/g)) {
      values[name] = type === "plural" ? count : `«${name}»`;
    }
    return values;
  }

  it.each(LOCALES.map((locale) => [locale]))("%s", (locale) => {
    const { ranking, stats, labels } = messagesFor(locale);
    const messages = [...leaves(ranking, "ranking"), ...leaves(stats, "stats"), ...leaves(labels, "labels")];
    expect(messages.length).toBeGreaterThan(130);
    for (const { key, source } of messages) {
      const reference = createTranslator({ locale, messages: { m: source }, timeZone: SITE_TIME_ZONE });
      for (const count of [0, 1, 2, 5]) {
        const values = sampleValues(source, count);
        const expected = reference.markup("m", { ...values, b: (chunks: string) => `<b>${chunks}</b>` });
        const actual = formatMessageParts<string>(locale, source, values, { b: (children) => `<b>${children.join("")}</b>` }).join("");
        expect(`${key}: ${actual}`).toBe(`${key}: ${expected}`);
      }
    }
  });
});
