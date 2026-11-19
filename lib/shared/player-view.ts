/**
 * « Incarner un rôle » (`docs/features/ADMIN_ROLE_IMPERSONATION.md`) : un
 * administrateur réduit, **pour sa session**, ses droits de plateforme à un
 * jeu de rôles choisi — aucun rôle : la « vue joueur ». Logique pure,
 * importable partout.
 *
 * Les noms `playerView*` viennent de la première version (vue joueur seule) :
 * `playerView` dit « la session incarne un rôle (ou aucun) ».
 */
import { can, isPlatformRole, PLATFORM_ROLES, sanitizePlatformRoles, type Permission, type PlatformRole } from "@/lib/shared/permissions";

/**
 * Durée maximale d'une vue joueur, en heures : passé ce délai, la session
 * retrouve ses droits d'elle-même — un oubli ne laisse pas un administrateur
 * sans droits pour le reste des trente jours de la session.
 */
export const PLAYER_VIEW_MAX_HOURS = 12;

/**
 * Les rôles qu'un administrateur peut incarner, dans l'ordre d'affichage :
 * tous les rôles de plateforme sauf `ADMIN` (l'incarnation ne fait que
 * **réduire** les droits). Aucun rôle coché : la vue joueur.
 */
export const IMPERSONABLE_ROLES: readonly PlatformRole[] = PLATFORM_ROLES.filter((role) => role !== "ADMIN");

/**
 * Le compte peut-il incarner un rôle ? Seul un administrateur (colonne
 * `is_admin`, droits **réels**) : il tient déjà tous les droits, l'incarnation
 * ne fait que les réduire. Un autre rôle de plateforme n'y ouvre rien.
 */
export function canImpersonate(real: { isAdmin: boolean }): boolean {
  return real.isAdmin;
}

/**
 * Les rôles incarnés, tels que stockés (`bg_user_sessions.impersonated_roles_json`) :
 * rôles connus seulement, `ADMIN` écarté, dédupliqués et triés. Une valeur
 * illisible ou absente : aucun rôle (vue joueur) — jamais plus de droits.
 */
export function parseImpersonatedRoles(input: unknown): PlatformRole[] {
  return sanitizePlatformRoles(input).filter((role) => role !== "ADMIN");
}

/**
 * Les droits que la session voit : ceux du compte, ou, pendant une
 * incarnation, **exactement** les rôles incarnés (`isAdmin` éteint ; aucun
 * rôle : vue joueur). Les rôles d'équipe (`OWNER`, `MANAGER`…) ne passent pas
 * par là : ils ne sont pas des droits de plateforme et restent entiers.
 */
export function sessionPlatformRights(
  real: { isAdmin: boolean; roles: readonly PlatformRole[] },
  playerView: boolean,
  impersonatedRoles: unknown = [],
): { isAdmin: boolean; roles: PlatformRole[] } {
  if (playerView) return { isAdmin: false, roles: parseImpersonatedRoles(impersonatedRoles) };
  return { isAdmin: real.isAdmin, roles: [...real.roles] };
}

/**
 * Ce qu'une session sait d'elle-même pour ses gestes de cast et d'arbitrage :
 * l'incarnation (`playerView`) et ses rôles. Les rôles absents valent
 * « aucun » : un appelant qui ne les passe pas refuse, jamais n'ouvre.
 */
export type SessionRights = { playerView: boolean; roles?: readonly PlatformRole[] };

/**
 * La session tient-elle les casts (`live`) ou les arbitrages (`tournaments`)
 * désignés du compte ? Hors incarnation, toujours (l'éligibilité se lit en
 * base) ; pendant une incarnation, seulement si les rôles incarnés ouvrent la
 * permission — un administrateur qui incarne un caster caste, en vue joueur
 * il ne tient ni cast ni arbitrage.
 */
export function sessionHolds(session: SessionRights, permission: Extract<Permission, "live" | "tournaments">): boolean {
  if (!session.playerView) return true;
  return can({ isAdmin: false, roles: session.roles ?? [] }, permission);
}

/** Coche ou décoche `role` dans la sélection de la modale, rendue dans l'ordre de {@link IMPERSONABLE_ROLES}. */
export function toggleImpersonatedRole(selected: readonly PlatformRole[], role: PlatformRole): PlatformRole[] {
  const next = selected.includes(role) ? selected.filter((r) => r !== role) : [...selected, role];
  return IMPERSONABLE_ROLES.filter((r) => next.includes(r));
}

/** Nombre maximal d'entrées du tableau `roles` lu dans le corps (au-delà : refus). */
const MAX_BODY_ROLES = 16;

/**
 * Corps attendu par `POST /api/auth/player-view` : `{ active: boolean }`,
 * plus, à l'entrée seulement, `roles` — les rôles à incarner (tableau de
 * rôles de {@link IMPERSONABLE_ROLES}, vide ou absent : vue joueur). Un rôle
 * inconnu, `ADMIN`, ou `roles` au retour : refus (`null`), jamais ignoré.
 */
export function parsePlayerViewBody(body: unknown): { active: boolean; roles: PlatformRole[] } | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { active, roles } = body as { active?: unknown; roles?: unknown };
  if (typeof active !== "boolean") return null;
  if (roles === undefined) return { active, roles: [] };
  if (!active || !Array.isArray(roles) || roles.length > MAX_BODY_ROLES) return null;
  if (!roles.every((role) => isPlatformRole(role) && IMPERSONABLE_ROLES.includes(role))) return null;
  return { active, roles: parseImpersonatedRoles(roles) };
}

/** Ce que le menu du compte propose : passer en vue joueur, en revenir, ou rien. */
export type PlayerViewMenuMode = "enter" | "back";

/**
 * L'entrée du menu du compte : « Revenir en vue admin » pendant la vue joueur,
 * « Passer en vue joueur » quand le compte porte des droits à suspendre.
 */
export function playerViewMenuMode(user: { playerView: boolean; playerViewAvailable: boolean }): PlayerViewMenuMode | null {
  if (user.playerView) return "back";
  return user.playerViewAvailable ? "enter" : null;
}

/** Marge après l'échéance : la relecture tombe quand la base la voit passée. */
export const PLAYER_VIEW_EXPIRY_MARGIN_MS = 1_000;

/** Plus long délai qu'un minuteur tient (au-delà, `setTimeout` part sur-le-champ). */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Délai avant l'échéance de la vue joueur (`until`, ISO), plus une marge :
 * la bannière relit alors la page et le flux SSE se reconnecte, les droits
 * étant revenus. `null` : pas d'échéance lisible, rien à programmer. Une
 * échéance déjà passée (horloges décalées) donne la seule marge.
 */
export function playerViewExpiryDelayMs(until: string | null, now: number): number | null {
  if (!until) return null;
  const at = Date.parse(until);
  if (!Number.isFinite(at)) return null;
  return Math.min(MAX_TIMER_MS, Math.max(0, at - now) + PLAYER_VIEW_EXPIRY_MARGIN_MS);
}
