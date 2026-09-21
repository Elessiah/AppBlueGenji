import type { TournamentDetail } from "@/lib/shared/types";
import { mapError } from "./error-map";

/**
 * Pourquoi le bouton d'inscription n'est-il pas là ?
 *
 * Le bouton se cache dès que `canRegister` est faux, et c'est la bonne règle :
 * pas de bouton grisé. Mais **deux** cas méritent une phrase plutôt qu'un vide,
 * et ce sont les deux seuls que la page ne dit pas d'elle-même :
 *
 * 1. le joueur qui **a** une équipe, sur un tournoi dont les inscriptions
 *    **sont** ouvertes, et qui n'a simplement pas la charge de l'engager ;
 * 2. l'engagé qui ne remplit pas les **conditions d'inscription** — il faut
 *    alors dire laquelle, puisque la réparation diffère : recruter, ou certifier
 *    un tag.
 *
 * Les autres refus se lisent seuls : les inscriptions fermées le disent en tête
 * de page, une équipe déjà inscrite figure dans la liste des engagées, et
 * l'absence d'équipe saute aux yeux de qui n'en a pas.
 *
 * Rend `null` quand il n'y a rien à expliquer. Le serveur reste le juge : ces
 * phrases doublent ses refus, elles ne les remplacent pas.
 */
export function registerBlockedNotice(detail: TournamentDetail): string | null {
  if (detail.card.state !== "REGISTRATION") return null;
  if (detail.canRegister) return null;

  // Les conditions passent en premier : elles ne se posent que si la qualité
  // d'engager est acquise (le serveur ne les évalue pas autrement), et elles
  // nomment un geste précis là où le refus de qualité renvoie à quelqu'un
  // d'autre.
  // Test de vérité, et non `!== null` : un instantané abîmé (champ absent) ne
  // doit pas fabriquer une phrase qui ne correspond à aucun refus.
  //
  // Le message dit le **geste**, pas la condition chiffrée : celle-ci est
  // affichée deux lignes plus haut, dans la case « Conditions d'inscription » du
  // même en-tête (`headerMetaItems`). La répéter ici ferait lire deux fois la
  // même chose à qui n'en cherche qu'une.
  if (detail.registrationBlock) return mapError(detail.registrationBlock);

  if (detail.canRegisterEntrant) return null;
  // Sans équipe active, le refus n'est pas celui-ci.
  if (detail.myTeamId === null) return null;
  // Déjà engagée : la question de qui l'inscrit ne se pose plus.
  if (detail.registrations.some((row) => row.teamId === detail.myTeamId)) return null;

  return "Seuls le propriétaire et les managers de ton équipe peuvent l'inscrire à un tournoi.";
}
