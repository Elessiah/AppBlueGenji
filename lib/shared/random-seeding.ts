/**
 * Tirage au sort de l'ordre de départ — logique pure, partagée client/serveur
 * (`docs/features/RANDOM_SEEDING.md`).
 *
 * Option du tournoi, éteinte par défaut, modifiable jusqu'au coup d'envoi.
 * Allumée, l'ordre de départ n'est ni l'ordre d'inscription ni le classement du
 * site : il est tiré au sort **à la clôture des inscriptions**, une fois toutes
 * les engagées connues. Avant ce tirage, aucun aperçu du premier tour n'est
 * montré — il ne dirait rien du plateau qui sera joué.
 */
import type { TournamentState } from "./types";

/** `OFF` : option éteinte ; `PENDING` : tirage à venir ; `DRAWN` : tirage fait. */
export type RandomDrawStatus = "OFF" | "PENDING" | "DRAWN";

export type RandomDrawInput = {
  enabled: boolean;
  /** Instant du dernier tirage (`random_seeding_drawn_at`). */
  drawnAt: string | Date | null;
  registrationCloseAt: string | Date;
};

function timeOf(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Où en est le tirage ? Un tirage ne vaut que s'il **suit** la clôture des
 * inscriptions : une clôture repoussée après lui (inscriptions rouvertes) le
 * rend caduc, et un nouveau tirage aura lieu à la nouvelle clôture.
 *
 * Comparaison **à la seconde** : les deux dates sont des `DATETIME` sans
 * fraction, et MariaDB tronque (MySQL arrondit) les millisecondes. Un tirage
 * fait dans la seconde même de la clôture (10:00:00,300 pour 10:00:00) est
 * relu 10:00:00 : il compte, sinon il serait refait à chaque entretien.
 */
export function randomDrawStatus(input: RandomDrawInput): RandomDrawStatus {
  if (!input.enabled) return "OFF";
  if (input.drawnAt === null) return "PENDING";
  const drawn = timeOf(input.drawnAt);
  const close = timeOf(input.registrationCloseAt);
  if (!Number.isFinite(drawn) || !Number.isFinite(close)) return "PENDING";
  return Math.floor(drawn / 1000) >= Math.floor(close / 1000) ? "DRAWN" : "PENDING";
}

/** Colonnes SQL du tirage, telles que les lit une ligne `bg_tournaments`. */
export type RandomDrawColumns = {
  state: TournamentState;
  random_seeding?: number | null;
  random_seeding_drawn_at?: string | Date | null;
  registration_close_at: string | Date;
};

/** Entrée de {@link isRandomDrawDue}, depuis une ligne `bg_tournaments`. */
export function randomDrawInputOf(row: RandomDrawColumns): RandomDrawInput & { state: TournamentState } {
  return {
    state: row.state,
    enabled: Number(row.random_seeding ?? 0) === 1,
    drawnAt: row.random_seeding_drawn_at ?? null,
    registrationCloseAt: row.registration_close_at,
  };
}

/**
 * Le tirage est-il dû maintenant ? Option allumée, tirage pas encore fait,
 * inscriptions closes (`now` après la clôture) et tournoi pas encore lancé
 * (état **stocké** `UPCOMING` ou `REGISTRATION` : le lancement lui-même tire
 * avant de poser le premier tour, jamais après).
 */
export function isRandomDrawDue(
  input: RandomDrawInput & { state: TournamentState },
  now: number = Date.now(),
): boolean {
  if (input.state !== "UPCOMING" && input.state !== "REGISTRATION") return false;
  if (randomDrawStatus(input) !== "PENDING") return false;
  const close = timeOf(input.registrationCloseAt);
  return Number.isFinite(close) && now > close;
}

/**
 * Mélange de Fisher–Yates. `randomInt(n)` rend un entier uniforme de `[0, n)` :
 * le serveur passe `crypto.randomInt` (vrai aléa, sans biais de modulo), les
 * tests une suite fixée. Rend une copie, l'entrée n'est pas touchée.
 */
export function shuffleOrder<T>(items: readonly T[], randomInt: (maxExclusive: number) => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const pick = randomInt(index + 1);
    if (!Number.isInteger(pick) || pick < 0 || pick > index) throw new Error("INVALID_RANDOM_INT");
    [result[index], result[pick]] = [result[pick]!, result[index]!];
  }
  return result;
}
