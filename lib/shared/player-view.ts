/**
 * « Vue joueur » du staff (`docs/features/ADMIN_PLAYER_VIEW.md`) : un compte
 * qui porte des droits de plateforme les suspend, **pour sa session**, afin de
 * voir le site comme un joueur. Logique pure, importable partout.
 */
import { sanitizePlatformRoles, type PlatformRole } from "@/lib/shared/permissions";

/**
 * Durée maximale d'une vue joueur, en heures : passé ce délai, la session
 * retrouve ses droits d'elle-même — un oubli ne laisse pas un administrateur
 * sans droits pour le reste des trente jours de la session.
 */
export const PLAYER_VIEW_MAX_HOURS = 12;

/** Le compte peut-il passer en vue joueur ? Oui dès qu'il porte un rôle de plateforme (`DEV` compris). */
export function holdsPlatformRights(user: { isAdmin: boolean; roles: readonly PlatformRole[] }): boolean {
  return user.isAdmin || sanitizePlatformRoles(user.roles).length > 0;
}

/**
 * Les droits que la session voit : ceux du compte, ou aucun en vue joueur.
 * Les rôles d'équipe (`OWNER`, `MANAGER`…) ne passent pas par là : ils ne sont
 * pas des droits de plateforme et restent entiers.
 */
export function sessionPlatformRights(
  real: { isAdmin: boolean; roles: readonly PlatformRole[] },
  playerView: boolean,
): { isAdmin: boolean; roles: PlatformRole[] } {
  if (playerView) return { isAdmin: false, roles: [] };
  return { isAdmin: real.isAdmin, roles: [...real.roles] };
}

/** Corps attendu par `POST /api/auth/player-view` : `{ active: boolean }`, rien d'autre. */
export function parsePlayerViewBody(body: unknown): boolean | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { active } = body as { active?: unknown };
  return typeof active === "boolean" ? active : null;
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
