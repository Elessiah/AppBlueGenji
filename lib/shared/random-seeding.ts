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
 */
export function randomDrawStatus(input: RandomDrawInput): RandomDrawStatus {
  if (!input.enabled) return "OFF";
  if (input.drawnAt === null) return "PENDING";
  const drawn = timeOf(input.drawnAt);
  const close = timeOf(input.registrationCloseAt);
  if (!Number.isFinite(drawn) || !Number.isFinite(close)) return "PENDING";
  return drawn > close ? "DRAWN" : "PENDING";
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
