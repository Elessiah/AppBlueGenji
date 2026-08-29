/**
 * Date de début d'un match.
 *
 * Un tournoi porte déjà son heure de coup d'envoi, mais un plateau se joue sur
 * plusieurs heures — parfois plusieurs jours — et chaque manche a son horaire
 * propre. C'est cet horaire que le staff `tournaments` (arbitre, admin) fixe
 * ici, match par match : l'engagé sait quand jouer, le spectateur quand
 * regarder, et la diffusion sait quand passer à l'antenne toute seule
 * (`lib/shared/live-streams.ts`, mode `START_TIME`).
 *
 * La date est **descriptive** : elle ne déclenche ni le match, ni le
 * verrouillage du score, ni la clôture du tournoi. Le moteur reste seul juge de
 * l'état d'un match — le calendrier ne fait qu'annoncer.
 *
 * Module pur : le serveur y valide ce qu'il écrit, l'interface ce qu'elle borne,
 * et les deux ne peuvent pas diverger.
 */

/**
 * Bornes acceptées, en années pleines UTC.
 *
 * Volontairement absolues plutôt que relatives à « maintenant » : une borne
 * glissante rendrait la validation dépendante de l'horloge, donc intestable et
 * capable de refuser à la relecture une date qu'elle avait acceptée à
 * l'écriture. Elles n'existent que pour écarter l'absurde — un `1970` issu d'un
 * horodatage en secondes, un `+275760` issu d'un débordement — pas pour juger
 * du calendrier de l'organisation, qui peut légitimement programmer un match
 * dans dix ans comme corriger l'horaire d'un tournoi passé.
 */
export const MATCH_START_AT_MIN_YEAR = 2000;
export const MATCH_START_AT_MAX_YEAR = 2100;

/**
 * Valide une date de début et la normalise en ISO 8601 (UTC).
 *
 * Accepte une `Date`, un ISO, ou la valeur d'un `<input type="datetime-local">`
 * (`2026-08-29T20:30`, interprétée dans le fuseau du navigateur — c'est
 * précisément ce que l'utilisateur a saisi). Renvoie `null` sur toute entrée
 * inexploitable : ce n'est jamais une exception, l'appelant décide s'il refuse
 * (route API) ou s'il efface (champ vidé).
 */
export function normalizeMatchStartAt(input: unknown): string | null {
  if (input === null || input === undefined) return null;

  let date: Date;
  if (input instanceof Date) {
    date = input;
  } else if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    date = new Date(trimmed);
  } else if (typeof input === "number") {
    date = new Date(input);
  } else {
    return null;
  }

  const time = date.getTime();
  if (!Number.isFinite(time)) return null;

  const year = date.getUTCFullYear();
  if (year < MATCH_START_AT_MIN_YEAR || year > MATCH_START_AT_MAX_YEAR) return null;

  return date.toISOString();
}

/** Vrai si `input` est une date de début exploitable. */
export function isValidMatchStartAt(input: unknown): boolean {
  return normalizeMatchStartAt(input) !== null;
}

/**
 * Vue minimale d'un match pour le calendrier, commune aux lignes SQL et à
 * `BracketMatch`.
 */
export type MatchScheduleInput = {
  /** Date de début programmée ; `null` = pas d'horaire annoncé. */
  startAt: string | Date | null | undefined;
};

/** Instant (ms) de la date de début, ou `null` si elle n'est pas exploitable. */
export function matchStartAtTime(match: MatchScheduleInput): number | null {
  if (match.startAt === null || match.startAt === undefined) return null;
  const time =
    match.startAt instanceof Date ? match.startAt.getTime() : new Date(match.startAt).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * Valeur d'un `<input type="datetime-local">` pour une date ISO donnée.
 *
 * Le champ HTML travaille en heure **locale** et sans fuseau : on décale donc
 * l'instant du décalage du navigateur avant de le tronquer à la minute. Une
 * date absente ou illisible donne une chaîne vide, ce qui vide le champ plutôt
 * que d'y afficher `Invalid Date`.
 */
export function matchStartAtInputValue(startAt: string | Date | null | undefined): string {
  const time = matchStartAtTime({ startAt });
  if (time === null) return "";
  const local = new Date(time - new Date(time).getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * Libellé court et lisible d'une date de début (« 29/08 20:30 »).
 *
 * Sans l'année ni les secondes : la carte de match fait 210 px, et l'année d'un
 * match qu'on est en train de jouer n'apprend rien. La date complète reste
 * accessible en `title`/`aria-label` via {@link formatMatchStartAtFull}.
 */
export function formatMatchStartAt(startAt: string | Date | null | undefined): string | null {
  const time = matchStartAtTime({ startAt });
  if (time === null) return null;
  return new Date(time).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Date de début complète, pour les infobulles et les lecteurs d'écran. */
export function formatMatchStartAtFull(startAt: string | Date | null | undefined): string | null {
  const time = matchStartAtTime({ startAt });
  if (time === null) return null;
  return new Date(time).toLocaleString("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
  });
}
