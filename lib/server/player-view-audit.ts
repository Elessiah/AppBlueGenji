import type { PlatformRole } from "@/lib/shared/permissions";

/**
 * Lignes pm2 de l'incarnation d'un rôle (`auditStaffAction` : jamais sur
 * Discord, où elles ne diraient rien d'utile). Module sans dépendance : le
 * balayage du démarrage (`catch-ups.ts`) les écrit aussi, sans passer par
 * `player-view.ts` (qui dépend de la base).
 */
export const PLAYER_VIEW_ON_AUDIT = "🎭 Rôle incarné sur une session";
export const PLAYER_VIEW_OFF_AUDIT = "🎭 Incarnation quittée sur une session";

/** La ligne pm2 de l'entrée : les rôles incarnés, ou la vue joueur (aucun). */
export function impersonationAuditLine(roles: readonly PlatformRole[]): string {
  return `${PLAYER_VIEW_ON_AUDIT} : ${roles.length > 0 ? roles.join(", ") : "joueur (aucun rôle)"}`;
}
