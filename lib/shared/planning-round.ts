/**
 * Nom du tour d'un match du planning (`docs/features/CAST_PLANNING.md`) : celui
 * de la fiche du tournoi et des aperçus partagés (`shareRoundText`) —
 * « Quart de finale 2 », « Finale », « Tableau perdants · Demi-finale »,
 * « Ronde 3 · Match 2 » — et non plus « Manche {numéro brut} ».
 *
 * Le planning ne charge que son espace de noms ; les mots des tours viennent du
 * sous-ensemble de `tournament` que cette lecture relit ({@link PlanningRoundMessages}).
 */
import type { Locale } from "./locales";
import type { Messages } from "./i18n-messages";
import type { PlanningEntryView } from "./planning-view";
import { shareRoundText } from "./share-round";
import { tournamentPageText, type TournamentPageText, type TournamentSheetMessages } from "./tournament-page-text";

/** Ce que {@link planningRoundText} relit de `tournament` : les mots des tours et des tableaux. */
export type PlanningRoundMessages = {
  bracket: TournamentSheetMessages["bracket"];
  page: { bracketLabels: TournamentSheetMessages["page"]["bracketLabels"] };
};

/** Le sous-ensemble de `tournament` qui voyage avec la page du planning. */
export function planningRoundMessages(messages: Pick<Messages, "tournament">): PlanningRoundMessages {
  return {
    bracket: messages.tournament.bracket,
    page: { bracketLabels: messages.tournament.page.bracketLabels },
  };
}

/** Le texte des tours dans `locale` (à construire une fois par écran). */
export function planningRoundTextOf(locale: Locale, messages: PlanningRoundMessages): TournamentPageText {
  // `shareRoundText` ne lit que `bracket.*` et `page.bracketLabels.*` : le reste de la fiche n'est pas chargé ici.
  return tournamentPageText(locale, messages as unknown as TournamentSheetMessages);
}

/**
 * Le nom du tour d'une entrée : `null` pour le tournoi entier ; un match
 * inconnu du calcul (`round` absent) retombe sur « Manche n · Match m ».
 */
export function planningRoundText(
  text: TournamentPageText,
  entry: Pick<PlanningEntryView, "kind" | "round" | "roundNumber" | "matchNumber">,
): string | null {
  if (entry.kind !== "MATCH" || entry.roundNumber === null) return null;
  return shareRoundText(text, entry.round, { roundNumber: entry.roundNumber, matchNumber: entry.matchNumber ?? 1 });
}
