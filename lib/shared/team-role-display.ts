/**
 * Rôles d'équipe, **tels qu'on les montre** : libellés français, ordre
 * d'affichage, familles.
 *
 * Les rôles voyageaient jusqu'à l'écran sous leur code de base — la fiche
 * d'équipe affichait « OWNER, DPS, TANK » en capitales anglaises, dans l'ordre
 * de saisie, et la modale d'édition proposait `MANAGER` coché comme `TANK`, sans
 * rien pour dire que l'un est un pouvoir et l'autre une place sur le terrain.
 *
 * Trois familles, et la ligne de partage est celle de `team-roles.ts` :
 * - **propriétaire** (`OWNER`) — jamais attribuable : il se transfère ;
 * - **gestion** (`MANAGER`) — donne la main sur l'équipe (roster, inscriptions) ;
 * - **jeu** (les cinq autres) — une place dans le roster, aucun pouvoir sur
 *   l'équipe (`CAPITAINE` mène toutefois les matchs, et se pose par la gestion
 *   comme `MANAGER` : {@link ASSIGNABLE_LEADING_ROLES}).
 *
 * Module **pur** : aucun rendu, aucune base — les listes et l'ordre se testent
 * seuls, et le serveur peut s'y référer sans rien importer du client.
 */

import enTeamRoles from "@/messages/en/teamRoles.json";
import frTeamRoles from "@/messages/fr/teamRoles.json";
import type { TeamRole } from "./types";
import { TEAM_MANAGEMENT_ROLES } from "./team-roles";
import { DEFAULT_LOCALE, type Locale } from "./locales";

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  OWNER: "Propriétaire",
  MANAGER: "Manager",
  CAPITAINE: "Capitaine",
  COACH: "Coach",
  TANK: "Tank",
  DPS: "DPS",
  HEAL: "Soutien",
};

/** Ordre d'affichage : du rôle le plus fort au plus sportif. */
export const TEAM_ROLE_ORDER: readonly TeamRole[] = [
  "OWNER",
  "MANAGER",
  "CAPITAINE",
  "COACH",
  "TANK",
  "DPS",
  "HEAL",
];

/**
 * Rôles de jeu : une place dans le roster, aucun droit. Chaque membre se les
 * donne **lui-même** (« Mes rôles », `PUT /api/teams/[id]/my-roles`, décision
 * D71) ; le propriétaire et les managers peuvent aussi les poser.
 */
export const SELF_ASSIGNABLE_ROLES: readonly TeamRole[] = ["COACH", "TANK", "DPS", "HEAL"];

/**
 * Rôles de direction attribuables, posés par la gestion seulement (propriétaire
 * ou manager) : `MANAGER` donne la main sur l'équipe, `CAPITAINE` mène les
 * matchs. `OWNER` n'y figure pas : il ne se coche pas, il se **transfère** (une
 * équipe a exactement un propriétaire).
 */
export const ASSIGNABLE_LEADING_ROLES: readonly TeamRole[] = ["MANAGER", "CAPITAINE"];

/** Tout ce que la gestion peut cocher (invitation, modale « Rôles »), dans l'ordre d'affichage. */
export const MANAGER_ASSIGNABLE_ROLES: readonly TeamRole[] = TEAM_ROLE_ORDER.filter((role) => role !== "OWNER");

/**
 * Rôles d'un membre après qu'il a choisi ses **rôles de jeu** : ses rôles de
 * direction (`OWNER`, `MANAGER`, `CAPITAINE`) restent ceux qu'il a, seuls les
 * rôles de {@link SELF_ASSIGNABLE_ROLES} sont remplacés par `chosen`. Un code
 * hors de cette liste dans `chosen` est ignoré — le serveur le refuse avant.
 */
export function withOwnGameRoles(current: readonly TeamRole[], chosen: readonly TeamRole[]): TeamRole[] {
  const kept = current.filter((role) => !SELF_ASSIGNABLE_ROLES.includes(role));
  const game = SELF_ASSIGNABLE_ROLES.filter((role) => chosen.includes(role));
  return sortTeamRoles([...kept, ...game]);
}

export type TeamRoleFamily = "owner" | "management" | "game";

export function teamRoleFamily(role: TeamRole): TeamRoleFamily {
  if (role === "OWNER") return "owner";
  return TEAM_MANAGEMENT_ROLES.includes(role) ? "management" : "game";
}

/**
 * Les mêmes libellés **par langue** (espace `teamRoles`, lot 9 de la
 * traduction) : sept mots, dont les deux langues voyagent avec qui les lit
 * plutôt que par un fournisseur. Le français égale {@link TEAM_ROLE_LABELS}
 * (testé) ; `HEAL` se dit *Support* en anglais (D8).
 */
const TEAM_ROLE_LABELS_BY_LOCALE: Readonly<Record<Locale, Readonly<Record<string, string>>>> = {
  fr: frTeamRoles,
  en: enTeamRoles,
};

/** Libellé d'un rôle — un code inconnu reste affiché tel quel plutôt que perdu. */
export function teamRoleLabel(role: TeamRole, locale: Locale = DEFAULT_LOCALE): string {
  const labels = TEAM_ROLE_LABELS_BY_LOCALE[locale];
  return Object.hasOwn(labels, role) ? labels[role] : role;
}

/** Les rôles d'un membre dans l'ordre d'affichage, doublons retirés. */
export function sortTeamRoles(roles: readonly TeamRole[]): TeamRole[] {
  const rank = (role: TeamRole) => {
    const index = TEAM_ROLE_ORDER.indexOf(role);
    return index === -1 ? TEAM_ROLE_ORDER.length : index;
  };
  return Array.from(new Set(roles)).sort((a, b) => rank(a) - rank(b));
}

/** Rôles d'un membre, en phrase lisible (« Propriétaire, Tank, DPS »). */
export function formatTeamRoles(roles: readonly TeamRole[], locale: Locale = DEFAULT_LOCALE): string {
  return sortTeamRoles(roles).map((role) => teamRoleLabel(role, locale)).join(", ");
}

/**
 * Ordre du roster : le propriétaire d'abord, puis la gestion, puis les autres —
 * chaque groupe par pseudo. L'ordre alphabétique seul noyait le propriétaire au
 * milieu de la liste, alors que c'est la personne qu'on cherche en premier.
 */
export function sortTeamMembers<T extends { pseudo: string; roles: readonly TeamRole[] }>(
  members: readonly T[],
): T[] {
  const weight = (member: T) => {
    if (member.roles.includes("OWNER")) return 0;
    if (member.roles.some((role) => TEAM_MANAGEMENT_ROLES.includes(role))) return 1;
    return 2;
  };
  return [...members].sort(
    (a, b) => weight(a) - weight(b) || a.pseudo.localeCompare(b.pseudo, "fr", { sensitivity: "base" }),
  );
}

/**
 * Teinte néon d'un rôle (DESIGN_SYSTEM.md § Palette « néon froid »), la même
 * partout où il s'affiche (fiche d'équipe, cartes de joueur). Les places de jeu
 * suivent l'usage des jeux — tank bleu, DPS rose, soutien vert d'eau ; le
 * pouvoir sur l'équipe se dit en violet. La couleur double toujours un libellé
 * (et, sur la fiche, un pictogramme) : elle ne porte jamais seule le sens. Un
 * code inconnu reste neutre.
 */
export type TeamRoleTone = "pink" | "violet" | "cyan" | "blue" | "teal" | "neutral";

const TEAM_ROLE_TONES: Record<TeamRole, TeamRoleTone> = {
  OWNER: "pink",
  MANAGER: "violet",
  CAPITAINE: "cyan",
  COACH: "violet",
  TANK: "blue",
  DPS: "pink",
  HEAL: "teal",
};

export function teamRoleTone(role: string): TeamRoleTone {
  return Object.hasOwn(TEAM_ROLE_TONES, role) ? TEAM_ROLE_TONES[role as TeamRole] : "neutral";
}
