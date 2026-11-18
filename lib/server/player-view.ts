import type { ResultSetHeader } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { playerViewSessionKey, type AuthUser } from "@/lib/server/auth";
import { reconnectSessionStreams } from "@/lib/server/session-streams";
import { auditStaffAction } from "@/lib/server/staff-audit";
import { PLAYER_VIEW_MAX_HOURS } from "@/lib/shared/player-view";

/** Lignes pm2 de la bascule (`auditStaffAction` : jamais sur Discord, où elles ne diraient rien d'utile). */
export const PLAYER_VIEW_ON_AUDIT = "👁️ Vue joueur activée sur une session";
export const PLAYER_VIEW_OFF_AUDIT = "👁️ Vue joueur quittée sur une session";

/** Refus de {@link setPlayerView} : aucune ligne de session à marquer. */
export const PLAYER_VIEW_NO_SESSION = "NO_SESSION";

/**
 * Pose ou retire la vue joueur **de la session en cours**
 * (`docs/features/ADMIN_PLAYER_VIEW.md`). L'appelant a vérifié
 * `user.playerViewAvailable` (les droits **réels** du compte, vue joueur ou
 * non). Les autres sessions du compte n'en sont pas touchées.
 *
 * L'échéance est posée en base, `PLAYER_VIEW_MAX_HOURS` après la bascule : la
 * lecture de la session la compare à `NOW()`, si bien que les droits
 * reviennent d'eux-mêmes, sans tâche planifiée.
 *
 * Sous le contournement de développement (sans session), une ligne dédiée
 * (`devBypassSessionKey`, jamais atteignable par un cookie) porte l'échéance ;
 * elle est supprimée au retour, et purgée comme toute session expirée.
 *
 * Les flux SSE de la session se reconnectent ensuite : ils gardaient le
 * contexte du lecteur lu à l'ouverture (palier, aperçu, droits staff).
 *
 * @throws `Error(PLAYER_VIEW_NO_SESSION)` sans session ni contournement.
 */
export async function setPlayerView(user: AuthUser, active: boolean): Promise<{ until: string | null }> {
  const key = await playerViewSessionKey(user);
  if (!key) throw new Error(PLAYER_VIEW_NO_SESSION);
  const db = await getDatabase();

  if (key.devBypass) {
    if (active) {
      await db.execute(
        `INSERT INTO bg_user_sessions (token_hash, user_id, expires_at, player_view_until)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), DATE_ADD(NOW(), INTERVAL ? HOUR))
         ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at), player_view_until = VALUES(player_view_until)`,
        [key.tokenHash, user.id, PLAYER_VIEW_MAX_HOURS, PLAYER_VIEW_MAX_HOURS],
      );
    } else {
      await db.execute(`DELETE FROM bg_user_sessions WHERE token_hash = ? AND user_id = ?`, [key.tokenHash, user.id]);
    }
  } else {
    const [result] = await db.execute<ResultSetHeader>(
      active
        ? `UPDATE bg_user_sessions SET player_view_until = DATE_ADD(NOW(), INTERVAL ? HOUR)
           WHERE token_hash = ? AND user_id = ? AND expires_at > NOW()`
        : `UPDATE bg_user_sessions SET player_view_until = NULL
           WHERE token_hash = ? AND user_id = ? AND expires_at > NOW()`,
      active ? [PLAYER_VIEW_MAX_HOURS, key.tokenHash, user.id] : [key.tokenHash, user.id],
    );
    if (Number(result.affectedRows ?? 0) === 0) throw new Error(PLAYER_VIEW_NO_SESSION);
  }

  reconnectSessionStreams(user.id, key.devBypass ? "" : key.tokenHash);
  auditStaffAction(active ? PLAYER_VIEW_ON_AUDIT : PLAYER_VIEW_OFF_AUDIT, { id: user.id, pseudo: user.pseudo });
  return { until: active ? new Date(Date.now() + PLAYER_VIEW_MAX_HOURS * 3_600_000).toISOString() : null };
}
