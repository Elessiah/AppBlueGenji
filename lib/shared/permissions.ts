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
export type PlatformRole = "ADMIN" | "ARBITRE" | "CASTER" | "PROD" | "COMMUNITY_MANAGER" | "RECRUTEUR" | "DEV";

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
 * - `moderation` — traitement des signalements et retrait d'un contenu publié
 *   par un membre (logo d'équipe, avatar de joueur). Réservé ADMIN : retirer
 *   le contenu d'un tiers engage la responsabilité de l'association, ce n'est
 *   pas un geste d'arbitrage ni de vitrine.
 * - `dev` — lecture de la documentation technique du site et du bot
 *   (`/devdoc`, `docs/features/DEVDOC.md`). Lecture seule : aucune écriture,
 *   aucune donnée de membre lue en base (seulement les `.md` de la liste
 *   blanche, tels que sur le serveur — jamais de note privée dans ces dossiers).
 * - `planning` — page « Planning » des casts, prods et arbitres
 *   (`docs/features/CAST_PLANNING.md`) : lire le planning et y donner ses
 *   propres disponibilités. Attribuer à la main reste à `tournaments` ;
 *   lancer le calcul, confirmer et régler les durées sont réservés aux
 *   administrateurs ({@link canComputePlanning}).
 * - `prod` — se placer soi-même comme prod d'un match, et s'en retirer
 *   (`docs/features/MATCH_PROD.md`) : rien d'autre (ni l'antenne, ni
 *   l'aperçu, ni les scores). Placer un autre compte reste à `tournaments`.
 */
export type Permission =
  | "tournaments"
  | "casting"
  | "live"
  | "showcase"
  | "recruitment"
  | "roles"
  | "moderation"
  | "dev"
  | "planning"
  | "prod";

/** Tous les rôles, dans un ordre d'affichage stable (ADMIN en tête). */
export const PLATFORM_ROLES: readonly PlatformRole[] = [
  "ADMIN",
  "ARBITRE",
  "CASTER",
  "PROD",
  "COMMUNITY_MANAGER",
  "RECRUTEUR",
  "DEV",
];

/** Libellés FR pour l'UI. */
export const ROLE_LABELS: Record<PlatformRole, string> = {
  ADMIN: "Administrateur",
  ARBITRE: "Arbitre",
  CASTER: "Caster",
  PROD: "Prod",
  COMMUNITY_MANAGER: "Community Manager",
  RECRUTEUR: "Recruteur",
  DEV: "Développeur",
};

/** Description courte du périmètre de chaque rôle (UI). */
export const ROLE_DESCRIPTIONS: Record<PlatformRole, string> = {
  ADMIN: "Tous les droits, dont l'attribution des rôles.",
  ARBITRE: "Créer et gérer les tournois.",
  CASTER: "Préparer et diffuser les matchs en direct (aperçu du plateau, antenne).",
  PROD: "Assurer la production des diffusions (planning des casts, prod d'un match).",
  COMMUNITY_MANAGER: "Gérer le site vitrine et l'association.",
  RECRUTEUR: "Gérer la page recrutement.",
  DEV: "Lire la documentation technique du site et du bot.",
};

const ROLE_PERMISSIONS: Record<PlatformRole, readonly Permission[]> = {
  ADMIN: ["tournaments", "casting", "live", "showcase", "recruitment", "roles", "moderation", "dev", "planning", "prod"],
  // L'arbitre gère le tournoi : l'aperçu lui est acquis, sans rôle en plus, et
  // il ouvre aussi l'antenne — sans quoi il faudrait deux personnes pour lancer
  // un match casté.
  ARBITRE: ["tournaments", "casting", "live", "planning"],
  // Les deux faces du métier de caster : préparer (lecture de l'aperçu) et
  // diffuser (écriture sur l'état de direct des matchs, et rien d'autre).
  // Le planning des casts (`CAST_PLANNING.md`) : ses disponibilités de caster.
  CASTER: ["casting", "live", "planning"],
  // La production d'une diffusion (régie, scènes, son) : le planning, pour y
  // donner ses disponibilités, et la place de prod d'un match (se placer, se
  // retirer — `MATCH_PROD.md`) — ni l'antenne ni l'aperçu du plateau.
  PROD: ["planning", "prod"],
  COMMUNITY_MANAGER: ["showcase"],
  RECRUTEUR: ["recruitment"],
  // Lecture de `/devdoc` seulement : la doc des dépôts, publiée sur GitHub,
  // relue sur le serveur et rassemblée pour qui travaille sur le code.
  DEV: ["dev"],
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

/** Les rôles d'un compte qui peut être marqué invité : la marque sort un caster ou un prod du planning (`CAST_PLANNING.md` § Invités). */
const GUEST_ELIGIBLE_ROLES: readonly PlatformRole[] = ["CASTER", "PROD"];

/** Le compte tient un rôle de caster ou de prod (rôles cumulables enregistrés, JSON ou liste). */
export function holdsGuestEligibleRole(rolesJson: unknown): boolean {
  return sanitizePlatformRoles(rolesJson).some((role) => GUEST_ELIGIBLE_ROLES.includes(role));
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

/** Les rôles qui accordent `permission`, dans l'ordre de `PLATFORM_ROLES`. */
export function rolesGranting(permission: Permission): PlatformRole[] {
  return PLATFORM_ROLES.filter((role) => ROLE_PERMISSIONS[role].includes(permission));
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
 * Ce que `can()` lit d'un compte : ses rôles, l'administration, et le drapeau
 * « invité » (`bg_users.is_guest_staff`) — un caster ou un prod invité garde
 * ses droits de diffusion mais n'est pas du planning (`CAST_PLANNING.md` § Invités).
 */
export type PermissionSubject = { roles?: readonly PlatformRole[]; isAdmin?: boolean; planningGuest?: boolean };

/**
 * Vrai si l'utilisateur dispose de `permission`.
 * Helper pratique côté routes API : `if (!can(user, "tournaments")) ...`.
 *
 * Un administrateur (`isAdmin`) obtient toutes les permissions, indépendamment
 * du contenu de `roles` (en pratique `roles` inclut déjà `ADMIN`, mais ce
 * raccourci garantit l'invariant « admin = tous les droits »). Un invité
 * (`planningGuest`) non administrateur perd `planning`, et elle seule.
 */
export function can(user: PermissionSubject | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (permission === "planning" && user.planningGuest === true) return false;
  return hasPermission(user.roles, permission);
}

/** Vrai si l'utilisateur dispose d'**au moins une** des permissions listées. */
export function canAny(
  user: PermissionSubject | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => can(user, permission));
}

/**
 * Calcul, confirmation et réglages du planning (`docs/features/CAST_PLANNING.md`) :
 * aux administrateurs seuls — décision explicite, exception à la règle des
 * permissions scopées (`PERMISSION_ROLES.md`) ; l'attribution à la main reste
 * à `tournaments`.
 */
export function canComputePlanning(user: { isAdmin?: boolean } | null | undefined): boolean {
  return user?.isAdmin === true;
}

/**
 * Rôles qui ne font pas du staff : `DEV` ne donne que la lecture de `/devdoc`,
 * jamais les commandes ni les sections réservées au staff de `/bot` et
 * `/bot/docs` (leurs fichiers, publics sur GitHub, restent lisibles dans
 * `/devdoc` avec le reste de `doc/`), ni un titre public sur la fiche du joueur.
 */
export const NON_STAFF_ROLES: readonly PlatformRole[] = ["DEV"];

/**
 * Vrai si l'utilisateur porte au moins un rôle de staff de plateforme
 * (`ADMIN` compris, {@link NON_STAFF_ROLES} exclus). Sert à distinguer le
 * staff — qui gère un domaine ou un autre, peu importe lequel — d'un simple
 * visiteur ou joueur : pas un domaine précis, juste « a un rôle sur le site ».
 */
export function isStaffMember(
  user: { roles?: readonly PlatformRole[]; isAdmin?: boolean } | null | undefined,
): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  return (user.roles ?? []).some((role) => !NON_STAFF_ROLES.includes(role));
}

/** Rôles accordés et retirés par un enregistrement, dans l'ordre d'affichage. */
export interface PlatformRoleChange {
  granted: PlatformRole[];
  removed: PlatformRole[];
}

/**
 * Écart entre les rôles enregistrés et la sélection à enregistrer — ce que la
 * modale de confirmation de `PlayerRolesPanel` annonce. Un enregistrement sans
 * écart (aucune case changée) part sans question : rien n'est accordé ni retiré.
 */
export function diffPlatformRoles(
  before: readonly PlatformRole[],
  after: readonly PlatformRole[],
): PlatformRoleChange {
  return {
    granted: PLATFORM_ROLES.filter((role) => after.includes(role) && !before.includes(role)),
    removed: PLATFORM_ROLES.filter((role) => before.includes(role) && !after.includes(role)),
  };
}

/** Vrai quand l'enregistrement accorde ou retire au moins un rôle. */
export function roleChangeNeedsConfirmation(change: PlatformRoleChange): boolean {
  return change.granted.length > 0 || change.removed.length > 0;
}

/**
 * Le ton de la confirmation d'un changement de rôles : « danger » dès qu'un rôle
 * se perd ou que l'administration est accordée — la même règle pour « Mes
 * rôles » et pour la fiche d'un joueur.
 */
export function roleChangeTone(change: PlatformRoleChange): "danger" | "primary" {
  return change.removed.length > 0 || change.granted.includes("ADMIN") ? "danger" : "primary";
}
