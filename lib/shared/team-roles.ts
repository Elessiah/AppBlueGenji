/**
 * Rôles de **gestion** d'une équipe, et rien d'autre.
 *
 * Les rôles d'équipe (`TeamRole`) sont cumulables et pour l'essentiel sportifs
 * (`TANK`, `DPS`, `HEAL`, `COACH`, `CAPITAINE`) : ils décrivent une place dans
 * le roster, pas un pouvoir. Deux font exception — `OWNER` et `MANAGER` —, et
 * c'est cette paire qui décide de tout ce qui **engage** l'équipe : conduire le
 * roster (inviter, exclure, distribuer les rôles, changer le logo) et
 * l'**inscrire à un tournoi**.
 *
 * La distinction utile n'est donc pas « propriétaire ou pas » mais *identité,
 * propriété et existence de l'équipe* (nom, sigle, transfert, dissolution —
 * `OWNER` seul) contre *conduite de l'équipe au quotidien* (cette paire). Voir
 * `docs/AUTHORIZATION_RULES.md` §3.
 *
 * Module **pur** : la même règle sert au serveur (qui la fait respecter) et à
 * l'interface (qui décide d'afficher un bouton). Deux implémentations auraient
 * divergé au premier réglage, et la divergence se serait vue en 403 sur un
 * bouton qui s'annonçait cliquable.
 */

import type { TeamRole } from "./types";

/**
 * Les rôles qui donnent la main sur l'équipe. Ordre d'affichage : du plus fort
 * au plus faible.
 */
export const TEAM_MANAGEMENT_ROLES: readonly TeamRole[] = ["OWNER", "MANAGER"];

/**
 * Ce membre a-t-il qualité pour agir **au nom** de l'équipe ?
 *
 * Une liste vide, absente ou faite de rôles purement sportifs rend `false` :
 * jouer pour une équipe ne donne pas le droit de l'engager.
 */
export function hasTeamManagementRole(roles: readonly TeamRole[] | null | undefined): boolean {
  if (!roles) return false;
  return roles.some((role) => TEAM_MANAGEMENT_ROLES.includes(role));
}
