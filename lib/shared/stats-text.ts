/**
 * Textes du bloc de statistiques (`components/stats/StatsPanel.tsx`,
 * `messages/<langue>/stats.json`) — lot 4 de la traduction,
 * `docs/features/I18N.md` § Classement.
 *
 * Le bloc est un composant client des fiches équipe et joueur, pages pas encore
 * traduites (lot 9) : son français est inclus dans le paquet (il remplace les
 * chaînes qui y étaient écrites en dur), l'anglais lui arrive en prop
 * ({@link StatsPanelI18n}) le jour où sa page s'ouvre sous `/en`. Formateur
 * réduit (`scoped-text.ts`), **sans** `next-intl` dans le navigateur.
 *
 * Les phrases de `lib/shared/stats.ts` (`formatRecord`, `formatStreak`,
 * `formatRate`) et de `lib/shared/ranking.ts` (légendes de la cote) restent
 * celles des autres écrans français ; un test vérifie que les messages
 * français les reproduisent mot pour mot.
 */
import frLabels from "@/messages/fr/labels.json";
import frStats from "@/messages/fr/stats.json";
import type { Locale } from "@/lib/shared/locales";
import { RANKING_BASE_POINTS, RANKING_FLOOR_POINTS, rankingPointsHintKind } from "@/lib/shared/ranking";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";
import type { StatsStreak } from "@/lib/shared/stats";
import { localizedTournamentLabel, type TournamentLabelMessages } from "@/lib/shared/tournament-labels";

export type StatsMessages = typeof frStats;
export type StatsKey = Leaves<StatsMessages>;
export type StatsText = ScopedText<StatsKey>;

/** Ce que lit le bloc : ses phrases, et les libellés courts de format et de jeu. */
export type StatsPanelMessages = {
  stats: StatsMessages;
  labels: Pick<TournamentLabelMessages, "formatShort" | "game">;
};

/** Langue et messages d'une page traduite ; absent = français (paquet). */
export type StatsPanelI18n = { locale: Locale; messages: StatsPanelMessages };

export const FR_STATS_PANEL_MESSAGES: StatsPanelMessages = {
  stats: frStats,
  labels: { formatShort: frLabels.formatShort, game: frLabels.game },
};

/** La part des messages d'une langue que lit le bloc (pour une page serveur). */
export function statsPanelMessages(messages: { stats: StatsMessages; labels: TournamentLabelMessages }): StatsPanelMessages {
  return { stats: messages.stats, labels: { formatShort: messages.labels.formatShort, game: messages.labels.game } };
}

export function statsText(locale: Locale, messages: StatsMessages = frStats): StatsText {
  return scopedText(locale, messages);
}

/** « 62 % » / « 62% », « — » sans taux. */
export function statsRate(text: StatsText, rate: number | null): string {
  if (rate === null) return "—";
  return text.t("rate", { value: String(Math.round(rate * 100)) });
}

/** Bilan d'une répartition : « 4V / 1D » (« 4W / 1L »), nuls déduits et montrés s'il y en a. */
export function statsRecord(text: StatsText, record: { played: number; won: number; lost: number }): string {
  const drawn = Math.max(0, record.played - record.won - record.lost);
  const values = { won: String(record.won), lost: String(record.lost), drawn: String(drawn) };
  return drawn > 0 ? text.t("recordWithDraws", values) : text.t("record", values);
}

/** Série en cours, pluriel ICU de la langue. */
export function statsStreak(text: StatsText, streak: StatsStreak): string {
  if (streak.kind === "NONE" || streak.length === 0) return text.t("streak.none");
  if (streak.kind === "DRAW") return text.t("streak.draw");
  return text.t(streak.kind === "WIN" ? "streak.wins" : "streak.losses", { count: streak.length });
}

/** Légende du total de points (`rankingPointsHint`), dans la langue du bloc. */
export function statsPointsHint(text: StatsText, ranked: boolean, points: number): string {
  const kind = rankingPointsHintKind(ranked, points);
  if (kind === "ranked") {
    return text.t("ranking.pointsHint", { base: String(RANKING_BASE_POINTS), floor: String(RANKING_FLOOR_POINTS) });
  }
  return text.t(kind === "unranked" ? "ranking.unrankedHint" : "ranking.placementOnlyHint");
}

/** Libellé d'une répartition par jeu ou par format, lu par son code. */
export function statsSplitLabel(
  labels: StatsPanelMessages["labels"],
  table: "formatShort" | "game",
  split: { key: string; label: string },
): string {
  const label = localizedTournamentLabel(labels, table, split.key);
  // Code inconnu des messages : le libellé calculé par `computeDeepStats` (la valeur brute).
  return label === split.key ? split.label : label;
}
