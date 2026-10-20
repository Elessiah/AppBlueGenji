/**
 * Litige de score (`docs/features/SCORE_DISPUTE_LOCK.md`) : les deux engagées
 * ont proposé des scores qui se contredisent.
 *
 * Deux propositions **ensemble** sur un match ouvert se contredisent toujours :
 * deux propositions concordantes le tranchent dans la transaction même
 * (`reportMatchScore`). Le litige se lit donc sur les seules propositions, sans
 * état de plus à tenir — et toute remise à zéro (arbitrage, retour en arrière,
 * réappariement) le referme.
 *
 * Tant qu'il est ouvert, **aucune** des deux engagées ne peut proposer,
 * corriger, confirmer ni déclarer forfait (`SCORE_LOCKED_DISPUTE`) : seul
 * l'arbitrage (`can(user, "tournaments")`) le tranche. Module pur : le serveur
 * l'applique, la carte et la modale le reflètent.
 */
import { INTL_LOCALE, SITE_TIME_ZONE, type Locale } from "./locales";
import { isMatchPlayed } from "./match-outcome";
import type { MatchStatus } from "./types";

/** Code de refus d'un geste d'engagée sur un match en litige. */
export const SCORE_LOCKED_DISPUTE = "SCORE_LOCKED_DISPUTE";

export function isScoreDisputed(match: {
  status: MatchStatus | string;
  team1Reported: boolean;
  team2Reported: boolean;
}): boolean {
  return !isMatchPlayed({ status: match.status as MatchStatus }) && match.team1Reported && match.team2Reported;
}

/**
 * Heure de la validation d'office (`scoreDeadlineAt`), « HH:MM » à l'heure de
 * Paris — l'heure du site, la même pour les deux équipes. `null` sans échéance
 * lisible.
 */
export function autoValidateTimeText(iso: string | null | undefined, locale: Locale): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return autoValidateFormatter(locale).format(date);
}

/** Un formateur par langue : chaque carte en attente le relit à chaque instantané. */
const AUTO_VALIDATE_FORMATTERS = new Map<Locale, Intl.DateTimeFormat>();

function autoValidateFormatter(locale: Locale): Intl.DateTimeFormat {
  let formatter = AUTO_VALIDATE_FORMATTERS.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: SITE_TIME_ZONE,
    });
    AUTO_VALIDATE_FORMATTERS.set(locale, formatter);
  }
  return formatter;
}

/** Une colonne de report est-elle renseignée ? (`null` / `undefined` : non). */
export function reportPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}
