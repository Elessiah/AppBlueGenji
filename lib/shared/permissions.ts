/**
 * Système de rôles de permission cumulables de la plateforme.
 *
 * Un utilisateur porte zéro, un ou plusieurs `PlatformRole`. Les permissions
 * associées se cumulent : un utilisateur ARBITRE + RECRUTEUR obtient les droits
 * des deux. `ADMIN` est un super-rôle qui débloque toutes les permissions ainsi
 * que la gestion des rôles eux-mêmes.
 *
 * Ce module est pur (aucune dépendance serveur) et donc importable partout
 * (`lib/shared/*`).
 */

/** Rôles attribuables à un utilisateur. Cumulables. */
export type PlatformRole = "ADMIN" | "ARBITRE" | "CASTER" | "COMMUNITY_MANAGER" | "RECRUTEUR";

/**
 * Domaines d'action protégés :
 * - `tournaments` — création et gestion des tournois / matchs.
 * - `casting` — consultation de l'aperçu du plateau avant le lancement, pour
 *   préparer la diffusion (lecture seule : ne donne aucun droit d'écriture).
 * - `live` — diffusion proprement dite : marquer un match comme casté, sa
 *   chaîne, l'ouverture de son antenne. Volontairement distincte de `casting`
 *   (qui ne lit que l'aperçu) et de `tournaments` : un streamer doit pouvoir
 *   ouvrir l'antenne sans toucher aux scores ni aux tournois.
 * - `showcase` — site vitrine (sponsors) + association (bureau, stats, bénévoles, contact).
 * - `recruitment` — page recrutement.
 * - `roles` — attribution des rôles de permission aux utilisateurs (réservé ADMIN).
 */
export type Permission =
  | "tournaments"
  | "casting"
  | "live"
  | "showcase"
  | "recruitment"
  | "roles";

/** Tous les rôles, dans un ordre d'affichage stable (ADMIN en tête). */
export const PLATFORM_ROLES: readonly PlatformRole[] = [
  "ADMIN",
  "ARBITRE",
  "CASTER",
  "COMMUNITY_MANAGER",
  "RECRUTEUR",
];

/** Libellés FR pour l'UI. */
export const ROLE_LABELS: Record<PlatformRole, string> = {
  ADMIN: "Administrateur",
  ARBITRE: "Arbitre",
  CASTER: "Caster",
  COMMUNITY_MANAGER: "Community Manager",
  RECRUTEUR: "Recruteur",
};

/** Description courte du périmètre de chaque rôle (UI). */
export const ROLE_DESCRIPTIONS: Record<PlatformRole, string> = {
  ADMIN: "Tous les droits, dont l'attribution des rôles.",
  ARBITRE: "Créer et gérer les tournois.",
  CASTER: "Préparer et diffuser les matchs en direct (aperçu du plateau, antenne).",
  COMMUNITY_MANAGER: "Gérer le site vitrine et l'association.",
  RECRUTEUR: "Gérer la page recrutement.",
};

const ROLE_PERMISSIONS: Record<PlatformRole, readonly Permission[]> = {
  ADMIN: ["tournaments", "casting", "live", "showcase", "recruitment", "roles"],
  // L'arbitre gère le tournoi : l'aperçu lui est acquis, sans rôle en plus, et
  // il ouvre aussi l'antenne — sans quoi il faudrait deux personnes pour lancer
  // un match casté.
  ARBITRE: ["tournaments", "casting", "live"],
  // Les deux faces du métier de caster : préparer (lecture de l'aperçu) et
  // diffuser (écriture sur l'état de direct des matchs, et rien d'autre).
  CASTER: ["casting", "live"],
  COMMUNITY_MANAGER: ["showcase"],
  RECRUTEUR: ["recruitment"],
};

/** Vrai si `value` est un `PlatformRole` connu. */
export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value);
}

/**
 * Normalise une entrée arbitraire (JSON stocké, corps de requête) en une liste
 * de rôles valides, dédupliquée et triée dans l'ordre de `PLATFORM_ROLES`.
 * Accepte soit un tableau, soit une chaîne JSON représentant un tableau.
 */
export function sanitizePlatformRoles(input: unknown): PlatformRole[] {
  let candidates: unknown = input;
  if (typeof input === "string") {
    try {
      candidates = JSON.parse(input);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(candidates)) return [];
  const set = new Set<PlatformRole>();
  for (const candidate of candidates) {
    if (isPlatformRole(candidate)) set.add(candidate);
  }
  return PLATFORM_ROLES.filter((role) => set.has(role));
}

/** Ensemble des permissions débloquées par un ensemble de rôles (cumul). */
export function permissionsForRoles(roles: readonly PlatformRole[]): Set<Permission> {
  const permissions = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) {
      permissions.add(permission);
    }
  }
  return permissions;
}

/** Vrai si l'un des rôles fournis accorde `permission`. */
export function hasPermission(
  roles: readonly PlatformRole[] | null | undefined,
  permission: Permission,
): boolean {
  if (!roles) return false;
  return permissionsForRoles(roles).has(permission);
}

/**
 * Vrai si l'utilisateur dispose de `permission`.
 * Helper pratique côté routes API : `if (!can(user, "tournaments")) ...`.
 *
 * Un administrateur (`isAdmin`) obtient toutes les permissions, indépendamment
 * du contenu de `roles` (en pratique `roles` inclut déjà `ADMIN`, mais ce
 * raccourci garantit l'invariant « admin = tous les droits »).
 */
export function can(
  user: { roles?: readonly PlatformRole[]; isAdmin?: boolean } | null | undefined,
  permission: Permission,
): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  return hasPermission(user.roles, permission);
}

/** Vrai si l'utilisateur dispose d'**au moins une** des permissions listées. */
export function canAny(
  user: { roles?: readonly PlatformRole[]; isAdmin?: boolean } | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => can(user, permission));
}
