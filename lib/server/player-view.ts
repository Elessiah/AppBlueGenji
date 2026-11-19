import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { playerViewSessionKey, type AuthUser } from "@/lib/server/auth";
import { reconnectSessionStreams } from "@/lib/server/session-streams";
import { auditStaffAction } from "@/lib/server/staff-audit";
import { toIso } from "@/lib/server/serialization";
import { impersonationAuditLine, PLAYER_VIEW_OFF_AUDIT } from "@/lib/server/player-view-audit";
import { liftImpersonations, withRolesColumn } from "@/lib/server/impersonation-sql";
import { parseImpersonatedRoles, PLAYER_VIEW_MAX_HOURS } from "@/lib/shared/player-view";
import type { PlatformRole } from "@/lib/shared/permissions";

/** Refus de {@link setPlayerView} : aucune ligne de session à marquer. */
export const PLAYER_VIEW_NO_SESSION = "NO_SESSION";

/**
 * Refus de {@link setPlayerView} : le compte a perdu l'administration entre
 * la lecture de la session et l'écriture de l'entrée — l'entrée est défaite.
 */
export const PLAYER_VIEW_NOT_ADMIN = "NOT_ADMIN";

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
 * Une entrée relit ensuite, sans verrou, l'administration du compte : une
 * rétrogradation validée entre la lecture de la session et l'écriture
 * (`setUserRoles`, dont le nettoyage des sessions n'avait alors rien trouvé)
 * ne laisse pas une incarnation dormante qui reviendrait si l'administration
 * était rendue — l'entrée est défaite. Relecture **après** l'écriture plutôt
 * que condition sur `bg_users` dans l'`UPDATE` : la rétrogradation verrouille
 * `bg_users` puis les sessions, une entrée qui verrouillerait la session puis
 * `bg_users` prendrait l'ordre inverse (interblocage). Si la rétrogradation
 * valide après la relecture, c'est son propre nettoyage qui lève l'entrée.
 *
 * @returns l'échéance et les rôles **relus en base** (`toIso`), `null` et
 *   `[]` hors incarnation ; `changed` : cette demande a écrit (une bascule
 *   croisée a pu changer l'état relu depuis).
 * @throws `Error(PLAYER_VIEW_NO_SESSION)` sans session ni contournement ;
 *   `Error(PLAYER_VIEW_NOT_ADMIN)` si l'entrée a été défaite.
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
  const write = (json: string | null) =>
    key.devBypass ? writeDevBypassView(db, key.tokenHash, user.id, json) : writeSessionView(db, key.tokenHash, user.id, json);
  // Sitôt l'écriture faite, avant toute relecture qui pourrait échouer : un
  // changement commité doit fermer les flux et laisser sa ligne pm2, même si
  // la réponse finit en 500 (une nouvelle demande, sans effet, ne les
  // rattraperait pas). `null` : tous les flux du compte — sous le
  // contournement, toute requête du compte le passe (cookie compris), si
  // bien que ses flux sont tous ceux de cette « session ».
  const announce = (line: string) => {
    reconnectSessionStreams(user.id, key.devBypass ? null : key.tokenHash);
    auditStaffAction(line, { id: user.id, pseudo: user.pseudo });
  };

  const changed = await write(rolesJson);
  if (changed) announce(active ? impersonationAuditLine(kept) : PLAYER_VIEW_OFF_AUDIT);

  // Après la ligne pm2 de l'entrée (une écriture commitée se trace toujours) :
  // l'entrée défaite laisse aussi celle de son retour. Un défaire en échec
  // n'efface jamais le refus qui l'a provoqué ; il est rattrapé par le
  // balayage du démarrage (`liftStrayImpersonations`).
  if (changed && active) {
    // `reconnect` : seulement si les droits de la session changent au retour.
    const undo = async (reconnect: boolean) => {
      try {
        if (!(await write(null))) return;
        if (reconnect) announce(PLAYER_VIEW_OFF_AUDIT);
        else auditStaffAction(PLAYER_VIEW_OFF_AUDIT, { id: user.id, pseudo: user.pseudo });
      } catch {
        // Défaire au mieux : le refus d'origine reste la réponse.
      }
    };
    let stillAdmin: boolean;
    try {
      stillAdmin = await isStillAdmin(db, user.id);
    } catch (error) {
      // Administration inconnue (panne passagère) : l'entrée est défaite au
      // mieux plutôt que laissée dormante. Le compte peut être encore
      // administrateur : le retour lui rend ses droits, les flux rouverts
      // sous l'incarnation sont reconnectés.
      await undo(true);
      throw error;
    }
    if (!stillAdmin) {
      // Sans reconnexion des flux : un compte qui n'est plus administrateur
      // ignore l'incarnation, ses droits ne changent pas (borne de
      // `RECONNECT_MEMORY_PER_USER` : une reconnexion par demande).
      await undo(false);
      throw new Error(PLAYER_VIEW_NOT_ADMIN);
    }
  }

  const row = await readSessionView(db, key.tokenHash, user.id);
  // Une session à cookie disparue entre-temps (déconnexion croisée) : refus.
  // La ligne du contournement, elle, n'existe qu'en vue joueur.
  if (!row && !key.devBypass) throw new Error(PLAYER_VIEW_NO_SESSION);
  if (!row || Number(row.active ?? 0) !== 1) return { until: null, roles: [], changed };
  return { until: toIso(row.player_view_until), roles: parseImpersonatedRoles(row.impersonated_roles_json), changed };
}

/** Administration du compte relue en base, hors de toute transaction (état validé). */
async function isStillAdmin(db: Pool, userId: number): Promise<boolean> {
  const [rows] = await db.execute<(RowDataPacket & { is_admin: number })[]>(
    `SELECT is_admin FROM bg_users WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [userId],
  );
  return Number(rows[0]?.is_admin ?? 0) === 1;
}

/**
 * Lève l'incarnation **en cours** de **toutes** les sessions d'un compte dont
 * l'administration change (`setUserRoles`) — retirée : sans quoi l'échéance et
 * les rôles restaient sur la session, ignorés tant que le compte n'est plus
 * administrateur, puis relus tels quels s'il le redevenait dans les 12 h ;
 * rendue : une incarnation restée là malgré tout reprendrait effet — une
 * incarnation revenue sans geste. Sur la connexion de la
 * transaction de l'appelant (qui a verrouillé `bg_users` d'abord : seul ordre
 * de verrouillage des deux tables). Une échéance déjà passée reste, sans effet
 * (registre, T05) : elle ne peut plus revenir. Sans la colonne des rôles
 * (`ALTER` non joué), seule l'échéance est levée.
 *
 * @returns le nombre de sessions dont l'incarnation a été levée (ligne pm2 de
 *   l'appelant, après le commit : retour imposé nommant l'auteur pour une
 *   rétrogradation, ligne sans nom pour une promotion).
 */
export async function clearAccountImpersonation(connection: Pick<PoolConnection, "execute">, userId: number): Promise<number> {
  return liftImpersonations(connection, "user_id = ?", [userId]);
}

/**
 * Relit la ligne de session après la bascule. Sans la colonne
 * `impersonated_roles_json` (`ALTER` non joué), la lecture de la session
 * retombe sur la vue joueur (`getCurrentUser`) : la relecture fait de même,
 * rôles vides, plutôt que d'échouer.
 */
async function readSessionView(db: Pool, tokenHash: string, userId: number): Promise<SessionViewRow | undefined> {
  const [rows] = await withRolesColumn((roles) =>
    db.execute<SessionViewRow[]>(
      `SELECT player_view_until${roles ? ", impersonated_roles_json" : ", NULL AS impersonated_roles_json"}, player_view_until > NOW() AS active
       FROM bg_user_sessions WHERE token_hash = ? AND user_id = ? AND expires_at > NOW() LIMIT 1`,
      [tokenHash, userId],
    ),
  );
  return rows[0];
}

/**
 * Session à cookie : pose (rôles en JSON) ou retire (`null`) l'incarnation si
 * l'état change. `true` si une ligne a changé.
 *
 * Le retour reste possible sans la colonne `impersonated_roles_json` (`ALTER`
 * non joué : la session se lit alors en vue joueur) — il ne lève que
 * l'échéance. Une entrée, elle, échoue : elle ne poserait pas les rôles choisis.
 */
async function writeSessionView(db: Pool, tokenHash: string, userId: number, rolesJson: string | null): Promise<boolean> {
  if (rolesJson !== null) {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE bg_user_sessions
         SET player_view_until = DATE_ADD(NOW(), INTERVAL ? HOUR), impersonated_roles_json = ?
       WHERE token_hash = ? AND user_id = ? AND expires_at > NOW()
         AND (player_view_until IS NULL OR player_view_until <= NOW())`,
      [PLAYER_VIEW_MAX_HOURS, rolesJson, tokenHash, userId],
    );
    return Number(result.affectedRows ?? 0) > 0;
  }
  return (await liftImpersonations(db, "token_hash = ? AND user_id = ? AND expires_at > NOW()", [tokenHash, userId])) > 0;
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
