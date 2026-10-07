import { useCallback } from "react";
import frTournamentErrors from "@/messages/fr/tournamentErrors.json";
import { tournamentErrorsText, type TournamentErrorsText } from "@/lib/shared/tournament-actions-text";
import { formatMessage } from "@/lib/shared/message-format";
import { useTournamentErrorsText } from "@/components/i18n/tournament-actions-text";

/**
 * Refus des écrans de tournoi : un code d'API → une phrase, par langue
 * (`messages/<langue>/tournamentErrors.json`, lot 8b). Les réponses de l'API
 * restent des **codes** : seule l'interface les rédige.
 *
 * Le français est celui d'avant le lot, au caractère près — y compris les
 * phrases venues des modules partagés (lancement de match, planification par
 * l'arbitrage, plan de phases, retrait d'un engagé, pénalités d'endurance,
 * conflit d'écriture), dont la table était la recopie : un test les compare
 * une à une. Choix de rédaction repris de l'ancienne table :
 *
 * - `MATCH_ALREADY_COMPLETED`, `TEAM_ALREADY_OUT`, `FORBIDDEN` : volontairement
 *   neutres, le même code remontant de plusieurs gestes (joueur ou arbitrage,
 *   forfait ou diffusion) ;
 * - `NOT_TEAM_MANAGER` : refuse l'inscription **et** l'abandon (§4.2 et §4.7 de
 *   `docs/AUTHORIZATION_RULES.md`), d'où une phrase qui nomme les deux ;
 * - conditions d'inscription : chaque refus nomme le geste qui le lève ;
 * - `TOO_MANY_REQUESTS` : générique, le plafond est partagé par toutes les
 *   routes de la page ;
 * - inscription en lot : les phrases restent unitaires, le tout-ou-rien est
 *   ajouté par {@link mapBatchError}, seul à connaître la taille du lot.
 */
export const FR_ERRORS_TEXT: TournamentErrorsText = tournamentErrorsText("fr", frTournamentErrors);

/** Table française (code → phrase) : celle des écrans hors fournisseur. */
export const ERROR_MESSAGES: Readonly<Record<string, string>> = frTournamentErrors.codes;

/**
 * Repli d'un code que la table ne connaît pas. Une phrase générique plutôt que
 * le code : un jeton en capitales n'apprend rien au lecteur, et c'est aussi le
 * repli des autres registres du site.
 *
 * Elle ne promet pas qu'un nouvel essai aboutira : un code inconnu peut être un
 * refus déterministe (400, 409), que le même geste rencontrera de nouveau.
 */
export const UNKNOWN_ERROR_MESSAGE = frTournamentErrors.unknown;

/** Forme d'un code d'erreur du serveur : `TOURNAMENT_NOT_FOUND`, `FORBIDDEN`… */
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Phrase d'un refus, dans la langue de `text` (français par défaut).
 *
 * Seul un **code** inconnu retombe sur la phrase générique. Ce qui
 * n'a pas la forme d'un code passe tel quel : les appelants transmettent
 * `error.message`, qui porte parfois déjà une phrase (rédigée par l'interface,
 * ou venue d'un échec réseau du navigateur) — la remplacer par une formule
 * générique ferait perdre une explication sans rien gagner.
 */
export function mapError(errorCode: string, text: TournamentErrorsText = FR_ERRORS_TEXT): string {
  const codes: Readonly<Record<string, string>> = text.messages.codes;
  // `Object.hasOwn` et non un simple accès : `codes["constructor"]`
  // remonterait la chaîne de prototypes et rendrait une fonction.
  if (Object.hasOwn(codes, errorCode)) return codes[errorCode];
  return ERROR_CODE_PATTERN.test(errorCode) ? text.messages.unknown : errorCode;
}

/**
 * Message d'un refus qui **désigne un engagé**. Sur un lot de trente, « déjà
 * inscrite » sans nom n'apprend rien : le serveur joint l'identifiant en cause,
 * l'appelant retrouve le nom, et la phrase le porte en tête.
 *
 * Le nom est mis à part par un tiret plutôt qu'inséré dans la phrase : le genre
 * d'« équipe » et de « joueur » diverge, et les messages sont partagés entre les
 * deux types de tournoi.
 */
export function mapEntrantError(
  errorCode: string,
  entrantName: string | null,
  text: TournamentErrorsText = FR_ERRORS_TEXT,
): string {
  const message = mapError(errorCode, text);
  return entrantName ? formatMessage(text.locale, text.messages.entrant, { name: entrantName, message }) : message;
}

/**
 * Message d'un refus portant sur un **lot**.
 *
 * Le tout-ou-rien doit se lire dans la phrase, et il ne peut pas l'être dans la
 * table : « Ce tournoi est complet. » est juste pour l'inscription d'un seul,
 * mais devant une sélection de vingt-cinq il laisse ouvert ce que le lot était
 * censé éviter — le staff ne sait pas si les vingt-quatre premières sont
 * passées. Seul l'appelant connaît la taille de la requête, la précision est
 * donc ajoutée ici.
 */
export function mapBatchError(
  errorCode: string,
  entrantName: string | null,
  batchSize: number,
  text: TournamentErrorsText = FR_ERRORS_TEXT,
): string {
  const message = mapEntrantError(errorCode, entrantName, text);
  return batchSize > 1 ? formatMessage(text.locale, text.messages.batch, { message }) : message;
}

/** Table des refus dans la langue de la page (anglais sous `/en`). */
export function useErrorsText(): TournamentErrorsText {
  return useTournamentErrorsText(FR_ERRORS_TEXT);
}

/** `mapError` lié à la langue de la page. */
export function useMapError(): (errorCode: string) => string {
  const text = useErrorsText();
  return useCallback((errorCode: string) => mapError(errorCode, text), [text]);
}
