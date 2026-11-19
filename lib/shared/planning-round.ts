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
import {
  fallbackRoundLabel,
  tournamentPageText,
  type TournamentPageText,
  type TournamentSheetMessages,
} from "./tournament-page-text";

type BracketMessages = TournamentSheetMessages["bracket"];

/**
 * Les clés de `tournament.bracket` que lit `shareRoundText` (et ses aides
 * `stageRoundLabel`, `stageMatchLabel`, `fallbackRoundLabel`) : seules elles
 * voyagent avec la page. Une clé lue hors de cette liste s'afficherait brute —
 * `planning-round.test.ts` rédige chaque forme de tour pour l'interdire.
 */
export type PlanningRoundBracketKey = "stage" | "matchLabel" | "roundN" | "swissRoundN" | "matchN" | "finalPhase";

/** Ce que {@link planningRoundText} relit de `tournament` : les mots des tours et des tableaux. */
export type PlanningRoundMessages = {
  bracket: Pick<BracketMessages, PlanningRoundBracketKey>;
  page: { bracketLabels: TournamentSheetMessages["page"]["bracketLabels"] };
};

/** Le sous-ensemble de `tournament` qui voyage avec la page du planning. */
export function planningRoundMessages(messages: Pick<Messages, "tournament">): PlanningRoundMessages {
  const { bracket } = messages.tournament;
  return {
    bracket: {
      stage: bracket.stage,
      matchLabel: bracket.matchLabel,
      roundN: bracket.roundN,
      swissRoundN: bracket.swissRoundN,
      matchN: bracket.matchN,
      finalPhase: bracket.finalPhase,
    },
    page: { bracketLabels: messages.tournament.page.bracketLabels },
  };
}

/**
 * Le texte des tours dans `locale` (à construire une fois par écran). Le texte
 * est typé sur toute la fiche (`shareRoundText` le demande) mais n'en porte
 * que le sous-ensemble ci-dessus : la conversion est assumée ici seulement, et
 * le test de chaque forme de tour garde qu'aucune clé hors liste n'est lue.
 */
export function planningRoundTextOf(locale: Locale, messages: PlanningRoundMessages): TournamentPageText {
  return tournamentPageText(locale, messages as unknown as TournamentSheetMessages);
}

/**
 * Le nom du tour d'une entrée : `null` pour le tournoi entier ; un match
 * inconnu du calcul retombe sur « Manche n » seul — sans numéro de match,
 * plutôt qu'un numéro inventé.
 */
export function planningRoundText(
  text: TournamentPageText,
  entry: Pick<PlanningEntryView, "kind" | "round" | "roundNumber" | "matchNumber">,
): string | null {
  if (entry.kind !== "MATCH" || entry.roundNumber === null) return null;
  if (entry.matchNumber === null) return fallbackRoundLabel(text, entry.roundNumber);
  return shareRoundText(text, entry.round, { roundNumber: entry.roundNumber, matchNumber: entry.matchNumber });
}
