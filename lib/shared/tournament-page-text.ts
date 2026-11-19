/**
 * Textes de la fiche d'un tournoi : les aides
 * vivent dans `tournament-page-text-core.ts`, ce fichier y ajoute **le français du paquet**
 * (`tournament.json` en valeur). Un écran qui n'a besoin que des aides (nom d'un tour du planning,
 * `planning-round.ts`) importe le noyau : le JSON français ne part pas dans son paquet.
 */
import frTournament from "@/messages/fr/tournament.json";
import { DEFAULT_LOCALE } from "@/lib/shared/locales";
import { scopedText } from "@/lib/shared/scoped-text";
import type { TournamentPageMessages, TournamentPageText, TournamentSheetMessages, TournamentViewMessages } from "./tournament-page-text-core";

export * from "./tournament-page-text-core";


/**
 * Le français du paquet, sans les espaces des vues (`TOURNAMENT_VIEW_PARTS`,
 * dans leurs propres fichiers). `tournament.json` ne porte que du texte client :
 * les parties serveur sont à part (`tournamentServer.json`).
 */
export const FR_TOURNAMENT_PAGE_MESSAGES: TournamentSheetMessages = frTournament;

/**
 * Le français du paquet, typé sur **toutes** les clés : une clé d'une vue
 * (`swiss.*`, `survival.*`, `endurance.*`) n'y est pas et se rend telle quelle —
 * une vue lit son texte par `useTournamentViewText(FR_VIEWS_TEXT)`.
 */
function frPageText(view: TournamentViewMessages): TournamentPageText {
  return scopedText(DEFAULT_LOCALE, { ...FR_TOURNAMENT_PAGE_MESSAGES, ...view } as TournamentPageMessages);
}

/** Le français, hors de tout fournisseur (tests, composant rendu ailleurs). */
export const FR_TOURNAMENT_PAGE_TEXT: TournamentPageText = /*#__PURE__*/ frPageText({});

/** Le français complété de l'espace d'une vue — à construire dans `_lib/views-text.ts`. */
export function frTournamentViewText(view: TournamentViewMessages): TournamentPageText {
  return frPageText(view);
}
