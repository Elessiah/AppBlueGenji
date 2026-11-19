import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { playerViewSessionKey, type AuthUser } from "@/lib/server/auth";
import { reconnectSessionStreams } from "@/lib/server/session-streams";
import { auditStaffAction } from "@/lib/server/staff-audit";
import { toIso } from "@/lib/server/serialization";
import { parseImpersonatedRoles, PLAYER_VIEW_MAX_HOURS } from "@/lib/shared/player-view";
import type { PlatformRole } from "@/lib/shared/permissions";

/** Lignes pm2 de la bascule (`auditStaffAction` : jamais sur Discord, où elles ne diraient rien d'utile). */
export const PLAYER_VIEW_ON_AUDIT = "🎭 Rôle incarné sur une session";
export const PLAYER_VIEW_OFF_AUDIT = "🎭 Incarnation quittée sur une session";

/** La ligne pm2 de l'entrée : les rôles incarnés, ou la vue joueur (aucun). */
export function impersonationAuditLine(roles: readonly PlatformRole[]): string {
  return `${PLAYER_VIEW_ON_AUDIT} : ${roles.length > 0 ? roles.join(", ") : "joueur (aucun rôle)"}`;
}

/** Refus de {@link setPlayerView} : aucune ligne de session à marquer. */
export const PLAYER_VIEW_NO_SESSION = "NO_SESSION";

/** Ligne de session relue après la bascule : son échéance telle que la base la compare. */
type SessionViewRow = RowDataPacket & {
  player_view_until: Date | string | null;
  impersonated_roles_json: string | null;
  active: number | string | null;
};

/**
 * Pose ou retire l'incarnation d'un rôle **de la session en cours**
 * (`docs/features/ADMIN_ROLE_IMPERSONATION.md`) — `roles` : les rôles
 * incarnés, vides pour la vue joueur. L'appelant a vérifié
 * `user.playerViewAvailable` (administrateur **réel**, incarnation ou non).
 * Les autres sessions du compte n'en sont pas touchées.
 *
 * L'échéance est posée en base, `PLAYER_VIEW_MAX_HOURS` après la bascule : la
 * lecture de la session la compare à `NOW()`, si bien que les droits
 * reviennent d'eux-mêmes, sans tâche planifiée.
 *
 * **Une bascule qui ne change rien n'écrit rien** : redemander la vue joueur
 * ne repousse pas l'échéance (le plafond de 12 h tient) ni ne change les
 * rôles incarnés (il faut revenir puis choisir à nouveau), et quitter une
 * incarnation qui n'est pas posée ne laisse aucune ligne pm2 — l'écriture est
 * conditionnée à l'état courant, en une instruction.
 *
 * Sous le contournement de développement (sans session), une ligne dédiée
 * (`devBypassSessionKey`, jamais atteignable par un cookie) porte l'échéance ;
 * elle est supprimée au retour, et purgée comme toute session expirée.
 *
 * Un changement fait reconnecter les flux SSE de la session : ils gardaient le
 * contexte du lecteur lu à l'ouverture (palier, aperçu, droits staff).
 *
 * @returns l'échéance et les rôles **relus en base** (`toIso`), `null` et
 *   `[]` hors incarnation ; `changed` : cette demande a écrit (une bascule
 *   croisée a pu changer l'état relu depuis).
 * @throws `Error(PLAYER_VIEW_NO_SESSION)` sans session ni contournement.
 */
export async function setPlayerView(
  user: AuthUser,
  active: boolean,
  roles: readonly PlatformRole[] = [],
): Promise<{ until: string | null; roles: PlatformRole[]; changed: boolean }> {
  const key = await playerViewSessionKey(user);
  if (!key) throw new Error(PLAYER_VIEW_NO_SESSION);
  const db = await getDatabase();
  // Rôles normalisés (`ADMIN` écarté) avant l'écriture : la base ne garde que
  // ce que la lecture de la session rendra.
  const kept = parseImpersonatedRoles(roles);
  const rolesJson = active ? JSON.stringify(kept) : null;
  const changed = key.devBypass
    ? await writeDevBypassView(db, key.tokenHash, user.id, rolesJson)
    : await writeSessionView(db, key.tokenHash, user.id, rolesJson);

  if (changed) {
    // Sitôt l'écriture faite, avant toute relecture qui pourrait échouer : un
    // changement commité doit fermer les flux et laisser sa ligne pm2, même si
    // la réponse finit en 500 (une nouvelle demande, sans effet, ne les
    // rattraperait pas). `null` : tous les flux du compte — sous le
    // contournement, toute requête du compte le passe (cookie compris), si
    // bien que ses flux sont tous ceux de cette « session ».
    reconnectSessionStreams(user.id, key.devBypass ? null : key.tokenHash);
    auditStaffAction(active ? impersonationAuditLine(kept) : PLAYER_VIEW_OFF_AUDIT, { id: user.id, pseudo: user.pseudo });
  }

  const [rows] = await db.execute<SessionViewRow[]>(
    `SELECT player_view_until, impersonated_roles_json, player_view_until > NOW() AS active FROM bg_user_sessions
     WHERE token_hash = ? AND user_id = ? AND expires_at > NOW() LIMIT 1`,
    [key.tokenHash, user.id],
  );
  const row = rows[0];
  // Une session à cookie disparue entre-temps (déconnexion croisée) : refus.
  // La ligne du contournement, elle, n'existe qu'en vue joueur.
  if (!row && !key.devBypass) throw new Error(PLAYER_VIEW_NO_SESSION);
  if (!row || Number(row.active ?? 0) !== 1) return { until: null, roles: [], changed };
  return { until: toIso(row.player_view_until), roles: parseImpersonatedRoles(row.impersonated_roles_json), changed };
}

/**
 * Session à cookie : pose (rôles en JSON) ou retire (`null`) l'incarnation si
 * l'état change. `true` si une ligne a changé.
 */
async function writeSessionView(db: Pool, tokenHash: string, userId: number, rolesJson: string | null): Promise<boolean> {
  const [result] = await db.execute<ResultSetHeader>(
    rolesJson !== null
      ? `UPDATE bg_user_sessions
           SET player_view_until = DATE_ADD(NOW(), INTERVAL ? HOUR), impersonated_roles_json = ?
         WHERE token_hash = ? AND user_id = ? AND expires_at > NOW()
           AND (player_view_until IS NULL OR player_view_until <= NOW())`
      : `UPDATE bg_user_sessions SET player_view_until = NULL, impersonated_roles_json = NULL
         WHERE token_hash = ? AND user_id = ? AND expires_at > NOW() AND player_view_until > NOW()`,
    rolesJson !== null ? [PLAYER_VIEW_MAX_HOURS, rolesJson, tokenHash, userId] : [tokenHash, userId],
  );
  return Number(result.affectedRows ?? 0) > 0;
}

/**
 * Contournement de développement : la ligne dédiée n'existe que pendant l'incarnation.
 * Une ligne échue est retirée avant d'en poser une neuve ; une ligne encore
 * valide n'est pas repoussée (doublon de clé écarté — et lui seul : toute
 * autre erreur d'insertion remonte). `true` si l'état a changé.
 */
async function writeDevBypassView(db: Pool, tokenHash: string, userId: number, rolesJson: string | null): Promise<boolean> {
  if (rolesJson === null) {
    const [removed] = await db.execute<ResultSetHeader>(
      `DELETE FROM bg_user_sessions WHERE token_hash = ? AND user_id = ? AND player_view_until > NOW()`,
      [tokenHash, userId],
    );
    return Number(removed.affectedRows ?? 0) > 0;
  }
  await db.execute(
    `DELETE FROM bg_user_sessions WHERE token_hash = ? AND user_id = ? AND (player_view_until IS NULL OR player_view_until <= NOW())`,
    [tokenHash, userId],
  );
  try {
    const [inserted] = await db.execute<ResultSetHeader>(
      `INSERT INTO bg_user_sessions (token_hash, user_id, expires_at, player_view_until, impersonated_roles_json)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), DATE_ADD(NOW(), INTERVAL ? HOUR), ?)`,
      [tokenHash, userId, PLAYER_VIEW_MAX_HOURS, PLAYER_VIEW_MAX_HOURS, rolesJson],
    );
    return Number(inserted.affectedRows ?? 0) > 0;
  } catch (error) {
    // Ligne encore valide (bascule concurrente) : rien ne change.
    if ((error as { code?: unknown } | null)?.code === "ER_DUP_ENTRY") return false;
    throw error;
  }
}
