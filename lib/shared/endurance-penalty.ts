/**
 * Pénalités d'endurance du mode « BlueGenji Survie » — la forme d'une sanction.
 *
 * Le règlement laisse l'arbitrage retirer des points d'endurance à un engagé
 * (retard au coup d'envoi, joueur non éligible aligné, conduite antisportive) :
 * une sanction qui pèse sur le classement sans passer par un score de match,
 * puisqu'aucune manche ne s'est mal jouée. C'est bien le capital qui est
 * amputé, pas une rencontre qui est réécrite.
 *
 * Trois partis pris, tenus ici plutôt que chez chaque appelant :
 *
 * 1. **Une pénalité retire, elle n'ajoute jamais.** Un « bonus » d'endurance
 *    n'existe pas au règlement, et une pénalité saisie de travers se **retire**
 *    (la ligne est effacée, le rejeu défait la sanction et ses conséquences) —
 *    la corriger par une seconde ligne de sens inverse laisserait au classement
 *    deux sanctions dont l'une est un pansement.
 * 2. **Un motif est obligatoire.** La sanction est publique, elle change un
 *    classement et elle sera contestée : « −3 » sans un mot n'est ni défendable
 *    par l'arbitre ni compréhensible par l'équipe. Le champ est court, il tient
 *    sur la ligne du tableau.
 * 3. **Un plafond, pour arrêter la faute de frappe.** Retirer 300 points revient
 *    à éliminer — ce que la sanction fait déjà quand elle vide le capital — mais
 *    ressemble surtout à un zéro de trop. Le plafond ne dit pas ce qui est juste,
 *    il dit ce qui est plausible.
 *
 * Module pur (`lib/shared`) : la même règle borne le formulaire et la route,
 * sans qu'aucune des deux ne la réécrive. Le rejeu, lui, vit dans
 * `lib/shared/bg-survie.ts` ; l'orchestration dans
 * `lib/server/tournaments/bg-survie.ts`.
 */

/** Retrait maximal d'une pénalité, en points d'endurance. */
export const MAX_ENDURANCE_PENALTY_POINTS = 99;

/** Longueur maximale du motif, en caractères. */
export const MAX_ENDURANCE_PENALTY_REASON = 200;

/**
 * Ce qui cloche dans une pénalité saisie.
 *
 * Quatre refus distincts et non un « pénalité invalide » unique : le formulaire
 * a deux champs, et un message qui ne dit pas lequel corriger oblige à les
 * relire tous les deux.
 */
export type EndurancePenaltyViolation =
  | "POINTS_NOT_POSITIVE"
  | "POINTS_TOO_HIGH"
  | "REASON_REQUIRED"
  | "REASON_TOO_LONG";

/**
 * Motif tel qu'il sera stocké : bords rognés, suites d'espaces réduites.
 *
 * La normalisation précède le contrôle de longueur, sinon un motif de deux mots
 * noyé dans des espaces se ferait refuser pour sa taille.
 */
export function normalizePenaltyReason(reason: string): string {
  return reason.trim().replace(/\s+/g, " ");
}

/**
 * Contrôle une pénalité avant écriture.
 *
 * @param points Retrait demandé, en points d'endurance.
 * @param reason Motif, tel que saisi (il sera normalisé).
 * @returns Le refus, ou `null` si la pénalité est recevable.
 */
export function checkEndurancePenalty(
  points: number,
  reason: string,
): EndurancePenaltyViolation | null {
  // `Number.isInteger` couvre d'un coup `NaN`, l'infini et les décimales : un
  // capital d'endurance se compte en points entiers, une demi-pénalité n'a pas
  // de sens au classement.
  if (!Number.isInteger(points) || points < 1) return "POINTS_NOT_POSITIVE";
  if (points > MAX_ENDURANCE_PENALTY_POINTS) return "POINTS_TOO_HIGH";

  const normalized = normalizePenaltyReason(reason ?? "");
  if (normalized.length === 0) return "REASON_REQUIRED";
  if (normalized.length > MAX_ENDURANCE_PENALTY_REASON) return "REASON_TOO_LONG";

  return null;
}

/** Message français d'un refus, pour le toast comme pour la page. */
export function endurancePenaltyMessage(violation: EndurancePenaltyViolation): string {
  switch (violation) {
    case "POINTS_NOT_POSITIVE":
      return "Une pénalité retire au moins 1 point d'endurance.";
    case "POINTS_TOO_HIGH":
      return `Une pénalité ne peut pas dépasser ${MAX_ENDURANCE_PENALTY_POINTS} points d'endurance.`;
    case "REASON_REQUIRED":
      return "Indiquez le motif de la pénalité.";
    case "REASON_TOO_LONG":
      return `Le motif ne peut pas dépasser ${MAX_ENDURANCE_PENALTY_REASON} caractères.`;
  }
}
