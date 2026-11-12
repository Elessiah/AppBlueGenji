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

/**
 * Rôles de **jeu** qu'un membre se donne lui-même (« Mes rôles »,
 * `PUT /api/teams/[id]/my-roles`, décision D71) : une place dans le roster,
 * aucun droit. Règle d'autorisation, et non d'affichage : c'est elle que le
 * serveur fait respecter (`updateOwnGameRoles`) — tout autre rôle (`OWNER`,
 * `MANAGER`, `CAPITAINE`) est un rôle de direction, posé par la gestion seule.
 */
export const SELF_ASSIGNABLE_ROLES: readonly TeamRole[] = ["COACH", "TANK", "DPS", "HEAL"];

/** Rôle de direction : tout rôle qu'un membre ne peut pas se donner lui-même. */
export function isLeadingRole(role: TeamRole): boolean {
  return !SELF_ASSIGNABLE_ROLES.includes(role);
}

/**
 * Rôles d'un membre après qu'il a choisi ses **rôles de jeu** : ses rôles de
 * direction restent ceux qu'il a (dans leur ordre), seuls les rôles de
 * {@link SELF_ASSIGNABLE_ROLES} sont remplacés par `chosen`, dans l'ordre de
 * cette liste. Un code hors de cette liste dans `chosen` est ignoré — le
 * serveur le refuse avant.
 */
export function withOwnGameRoles(current: readonly TeamRole[], chosen: readonly TeamRole[]): TeamRole[] {
  const kept = Array.from(new Set(current.filter(isLeadingRole)));
  const game = SELF_ASSIGNABLE_ROLES.filter((role) => chosen.includes(role));
  return [...kept, ...game];
}
