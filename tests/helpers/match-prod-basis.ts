/**
 * Clause de base légale de la prod d'un match (MATCH_PROD) et du caster que le planning y place (PLANNING-AUTO-CAST), en fin du champ
 * « Base légale » de T16. Les tests de la part contractuelle la retirent
 * exactement : toute autre mention d'intérêt légitime y reste visible.
 */
export const FR_T16_PROD_BASIS =
  "intérêt légitime de l'association (RGPD, art. 6.1.f : organiser les bénévoles qui diffusent ses tournois), comme le planning (T20), pour la prod d'un match et le caster que le planning y place, qui peuvent quitter un match pas encore joué et s'y opposer (art. 21) par le formulaire de signalement (catégorie RGPD), un match joué gardant sa prod et ses casters, qui font partie de l'histoire du tournoi";

export const EN_T16_PROD_BASIS =
  "the association's legitimate interest (GDPR, art. 6.1.f: organising the volunteers who stream its tournaments), as for the planning (T20), for a match's prod and the caster the schedule places on it, who can leave a match not yet played and object (art. 21) through the report form (GDPR category), a played match keeping its prod and its casters, which are part of the tournament's history";

/** Base T16 française sans la clause de la prod (retrait exact). */
export function frT16WithoutProdBasis(legalBasis: string): string {
  return legalBasis.replace(` ; ${FR_T16_PROD_BASIS}`, "");
}

/** Base T16 anglaise sans la clause de la prod (retrait exact). */
export function enT16WithoutProdBasis(legalBasis: string): string {
  return legalBasis.replace(`; ${EN_T16_PROD_BASIS}`, "");
}
