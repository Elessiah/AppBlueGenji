/**
 * Suspension d'un compte — écritures et lectures (`lib/shared/account-suspension.ts`).
 *
 * Trois lecteurs, une seule condition SQL (`ACTIVE_SUSPENSION_SQL`) :
 *
 * - `getCurrentUser` (`lib/server/auth.ts`) écarte la session d'un compte
 *   suspendu — c'est lui qui **tranche la course** d'une connexion ouverte
 *   pendant le prononcé, entre son contrôle et l'effacement des sessions ;
 * - `createSession` refuse d'en ouvrir une (`AccountSuspendedError`), avec
 *   l'exposé que la porte d'entrée rend lisible ;
 * - la fiche du joueur, pour la modération.
 *
 * Une suspension terminée (levée ou échue) est effacée
 * `SUSPENSION_RETENTION_MONTHS` mois après sa fin — le délai de contestation
 * d'une décision de modération. La purge est entraînée par les connexions
 * (`purgeEndedSuspensions`, appelée par `createSession`), comme celle des
 * sessions expirées qu'elle suit.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { toIso } from "@/lib/server/serialization";
import {
  SUSPENSION_GROUND_DEFINITIONS,
  SUSPENSION_RETENTION_MONTHS,
  formatSuspensionLiftedLog,
  formatSuspensionLiftedNotice,
  formatSuspensionLog,
  formatSuspensionNotice,
  toSuspensionNotice,
  type AccountSuspensionView,
  type SuspensionGround,
  type SuspensionInput,
  type SuspensionNotice,
} from "@/lib/shared/account-suspension";
import { suspensionPush } from "@/lib/shared/push-messages";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import type { StaffActor } from "@/lib/shared/log-privacy";

/**
 * Une suspension qui court, écrite une fois pour toutes les lectures —
 * pendant SQL de `isSuspensionActive`. `alias` est celui de
 * `bg_account_suspensions` dans la requête appelante.
 */
export function activeSuspensionSql(alias: string): string {
  return `${alias}.lifted_at IS NULL AND ${alias}.starts_at <= NOW() AND (${alias}.ends_at IS NULL OR ${alias}.ends_at > NOW())`;
}

/** Levée par `createSession` : le compte est suspendu, `notice` dit la décision. */
export class AccountSuspendedError extends Error {
  constructor(readonly notice: SuspensionNotice) {
    super("ACCOUNT_SUSPENDED");
    this.name = "AccountSuspendedError";
  }
}

type SuspensionRow = RowDataPacket & {
  id: number;
  reason: string;
  ground: SuspensionGround;
  starts_at: Date | string;
  ends_at: Date | string | null;
  lifted_at: Date | string | null;
};

function toView(row: SuspensionRow): AccountSuspensionView {
  return {
    id: Number(row.id),
    reason: row.reason,
    ground: row.ground,
    startsAt: toIso(row.starts_at) ?? new Date(0).toISOString(),
    endsAt: toIso(row.ends_at),
    liftedAt: toIso(row.lifted_at),
  };
}

type Queryable = Pick<PoolConnection, "execute">;

/** La suspension qui court pour ce compte, ou `null`. */
export async function getActiveSuspension(userId: number, db?: Queryable): Promise<AccountSuspensionView | null> {
  const executor = db ?? (await getDatabase());
  const [rows] = await executor.execute<SuspensionRow[]>(
    `SELECT s.id, s.reason, s.ground, s.starts_at, s.ends_at, s.lifted_at
     FROM bg_account_suspensions s
     WHERE s.user_id = ? AND ${activeSuspensionSql("s")}
     ORDER BY s.id DESC
     LIMIT 1`,
    [userId],
  );
  return rows[0] ? toView(rows[0]) : null;
}

/**
 * Refuse l'ouverture d'une session à un compte suspendu. Appelée par
 * `createSession`, donc par les quatre portes d'entrée.
 *
 * @throws AccountSuspendedError
 */
export async function assertNotSuspended(userId: number): Promise<void> {
  const active = await getActiveSuspension(userId);
  if (active) throw new AccountSuspendedError(toSuspensionNotice(active));
}

/** La colonne de `bg_users` qui porte l'identité d'une porte d'entrée. */
const IDENTITY_COLUMNS = {
  GOOGLE: "google_sub",
  DISCORD: "discord_id",
  BLIZZARD: "blizzard_sub",
} as const;

/**
 * Refuse une connexion **avant** que la porte n'écrive quoi que ce soit.
 *
 * Les portes d'entrée écrivent sur le compte en le retrouvant — BattleTag
 * réécrit par Blizzard, tag Discord recertifié, avatar Google importé —, et
 * `createSession` ne vient qu'après : un compte suspendu voyait donc un tag
 * qu'il avait retiré redevenir certifié, donc lisible de l'arbitrage, à la
 * seule tentative de connexion qui lui était refusée. Ce contrôle-ci retrouve le
 * compte par son identité, sans rien écrire ; celui de `createSession` reste le
 * dernier mot (une suspension prononcée entre les deux).
 *
 * @throws AccountSuspendedError
 */
export async function assertIdentityNotSuspended(
  provider: keyof typeof IDENTITY_COLUMNS,
  subject: string,
): Promise<void> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE ${IDENTITY_COLUMNS[provider]} = ? AND is_deleted = 0 LIMIT 1`,
    [subject],
  );
  if (rows[0]) await assertNotSuspended(Number(rows[0].id));
}

/**
 * Efface les suspensions terminées depuis plus de `SUSPENSION_RETENTION_MONTHS`
 * mois. Ne lève jamais : une purge manquée se refait à la connexion suivante,
 * et ne doit pas faire échouer celle-ci.
 */
export async function purgeEndedSuspensions(): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(
      `DELETE FROM bg_account_suspensions
       WHERE COALESCE(lifted_at, ends_at) IS NOT NULL
         AND COALESCE(lifted_at, ends_at) < DATE_SUB(NOW(), INTERVAL ? MONTH)`,
      [SUSPENSION_RETENTION_MONTHS],
    );
  } catch (error) {
    console.error("[moderation] purge des suspensions terminées impossible", error);
  }
}

/** Les suspensions conservées d'un compte, pour son export (droit d'accès). */
export async function listOwnSuspensions(userId: number): Promise<AccountSuspensionView[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<SuspensionRow[]>(
    `SELECT id, reason, ground, starts_at, ends_at, lifted_at
     FROM bg_account_suspensions WHERE user_id = ? ORDER BY id`,
    [userId],
  );
  return rows.map(toView);
}

function termsUrl(ground: SuspensionGround): string {
  return `${siteCanonicalBase()}${TERMS_PATH}#${SUSPENSION_GROUND_DEFINITIONS[ground].anchor}`;
}

/**
 * Prononce une suspension. Dans **une** transaction, ouverte par le verrou de
 * la ligne du compte (première instruction, comme partout où une écriture doit
 * relire l'état qu'elle juge) : contrôle du compte, refus d'une seconde
 * suspension, écriture, puis effacement de toutes les sessions du compte.
 *
 * Le titulaire est prévenu **après le commit** (message privé et push, jamais
 * attendus), et le geste part au journal du staff sans le pseudo du joueur.
 *
 * @throws USER_NOT_FOUND           compte inconnu ou supprimé
 * @throws CANNOT_SUSPEND_SELF
 * @throws CANNOT_SUSPEND_ADMIN     un administrateur ne se suspend pas — sans
 *                                  quoi la modération pourrait fermer le site
 *                                  à ceux qui peuvent la corriger
 * @throws ACCOUNT_ALREADY_SUSPENDED
 */
export async function suspendAccount(
  targetUserId: number,
  input: SuspensionInput,
  actor: StaffActor,
): Promise<AccountSuspensionView> {
  if (targetUserId === actor.id) throw new Error("CANNOT_SUSPEND_SELF");
  const db = await getDatabase();
  const connection = await db.getConnection();
  let view: AccountSuspensionView;
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute<(RowDataPacket & { is_admin: 0 | 1 })[]>(
      `SELECT is_admin FROM bg_users WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
      [targetUserId],
    );
    if (users.length === 0) throw new Error("USER_NOT_FOUND");
    if (Number(users[0].is_admin) === 1) throw new Error("CANNOT_SUSPEND_ADMIN");
    if (await getActiveSuspension(targetUserId, connection)) throw new Error("ACCOUNT_ALREADY_SUSPENDED");

    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO bg_account_suspensions (user_id, reason, ground, starts_at, ends_at, created_by)
       VALUES (?, ?, ?, NOW(), ${input.durationDays === null ? "NULL" : "DATE_ADD(NOW(), INTERVAL ? DAY)"}, ?)`,
      input.durationDays === null
        ? [targetUserId, input.reason, input.ground, actor.id]
        : [targetUserId, input.reason, input.ground, input.durationDays, actor.id],
    );
    const [rows] = await connection.execute<SuspensionRow[]>(
      `SELECT id, reason, ground, starts_at, ends_at, lifted_at FROM bg_account_suspensions WHERE id = ?`,
      [inserted.insertId],
    );
    view = toView(rows[0]);
    await connection.execute(`DELETE FROM bg_user_sessions WHERE user_id = ?`, [targetUserId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  publishStaffAction(formatSuspensionLog({ id: view.id, ground: view.ground, endsAt: view.endsAt }), actor);
  void loadNotificationRecipients([targetUserId], "proven")
    .then((recipients) =>
      notifyUsers(recipients, {
        topic: "MODERATION",
        discord: {
          message: formatSuspensionNotice({
            id: view.id,
            reason: view.reason,
            ground: view.ground,
            endsAt: view.endsAt,
            termsUrl: termsUrl(view.ground),
          }),
          context: "account-suspended",
        },
        push: suspensionPush("SUSPENDED"),
      }),
    )
    .catch((error) => console.error("[moderation] joueur non prévenu de sa suspension", error));
  return view;
}

/**
 * Lève la suspension en cours d'un compte, avant son terme — contestation
 * accueillie, ou erreur reconnue. La ligne reste (`lifted_at`, `lifted_by`) :
 * c'est la trace de la décision et de son retrait, effacée avec le délai de
 * conservation.
 *
 * @throws NO_ACTIVE_SUSPENSION
 */
export async function liftSuspension(targetUserId: number, actor: StaffActor): Promise<number> {
  const db = await getDatabase();
  const active = await getActiveSuspension(targetUserId);
  if (!active) throw new Error("NO_ACTIVE_SUSPENSION");
  // Condition relue dans l'écriture : une levée concurrente, ou l'échéance
  // atteinte entre les deux instructions, ne laisse rien à lever.
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE bg_account_suspensions s SET s.lifted_at = NOW(), s.lifted_by = ?
     WHERE s.id = ? AND ${activeSuspensionSql("s")}`,
    [actor.id, active.id],
  );
  if (result.affectedRows === 0) throw new Error("NO_ACTIVE_SUSPENSION");

  publishStaffAction(formatSuspensionLiftedLog(active.id), actor);
  void loadNotificationRecipients([targetUserId], "proven")
    .then((recipients) =>
      notifyUsers(recipients, {
        topic: "MODERATION",
        discord: { message: formatSuspensionLiftedNotice(active.id), context: "account-suspension-lifted" },
        push: suspensionPush("LIFTED"),
      }),
    )
    .catch((error) => console.error("[moderation] joueur non prévenu de la levée", error));
  return active.id;
}
