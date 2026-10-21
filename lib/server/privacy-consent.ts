import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { toIso } from "@/lib/server/serialization";
import {
  PRIVACY_CHANGES,
  pendingPrivacyChanges,
  privacyChangeDay,
  type PrivacyChange,
} from "@/lib/shared/privacy-changes";
import { rolesGranting } from "@/lib/shared/permissions";

/**
 * Lecture et écriture de la prise de connaissance des changements du traitement des
 * données (`lib/shared/privacy-changes.ts`).
 */

type PendingRow = RowDataPacket & {
  created_at: string | null;
  google_linked: 0 | 1 | null;
  live_staff: 0 | 1 | null;
  change_id: string | null;
};

/**
 * Le compte `u` peut-il caster (permission `live`) ? Même règle que `can` :
 * administrateur, ou l'un des rôles qui l'accordent (`rolesGranting`, tiré de
 * la table des permissions). En base, parce que l'annonce Discord doit filtrer
 * **avant** sa limite de lot, sans quoi des comptes non concernés en
 * occuperaient les places à chaque balayage ; et la modale lit **la même**
 * expression, pour qu'une entrée ne soit jamais annoncée sur Discord à qui ne
 * la verrait pas sur le site, ni l'inverse (un seul scalaire par ligne, pas la
 * colonne JSON). Un test confronte la liste des rôles à `can` rôle par rôle.
 * Les rôles sont des constantes du code,
 * jamais une saisie : les écrire dans la requête est sûr ; l'écran des rôles
 * (`lib/server/users/roles.ts`) est seul à écrire la colonne, en tableau JSON.
 */
export const LIVE_STAFF_SQL = `(u.is_admin = 1${rolesGranting("live")
  .map((role) => ` OR JSON_CONTAINS(u.platform_roles_json, '"${role}"')`)
  .join("")})`;

/**
 * Condition SQL d'une entrée ciblée (`PrivacyChange.audience`) sur la ligne
 * `u` de `bg_users` — la traduction en base de `privacyChangeReachesAccount`,
 * pour qui filtre les comptes avant de les lire (annonce Discord). Une entrée
 * sans cible vaut pour tous.
 */
export function privacyAudienceSql(change: PrivacyChange): string {
  switch (change.audience) {
    case undefined:
      return "1 = 1";
    case "GOOGLE_LINKED":
      return "u.google_sub IS NOT NULL";
    case "LIVE_STAFF":
      return LIVE_STAFF_SQL;
    default:
      return "1 = 0";
  }
}

/**
 * Les changements publiés dont un compte n'a pas encore pris connaissance.
 *
 * Une seule requête — la mise en page racine l'appelle à chaque page d'un
 * visiteur connecté : la date de création et les prises de connaissance arrivent
 * ensemble par une jointure externe. Registre vide : aucune requête du tout.
 *
 * Un compte supprimé n'a rien à lire (`is_deleted = 0`) : la session l'a
 * déjà écarté, la condition le redit pour qui appellerait sans elle.
 */
export async function loadPendingPrivacyChanges(userId: number): Promise<PrivacyChange[]> {
  if (PRIVACY_CHANGES.length === 0) return [];

  const db = await getDatabase();
  const [rows] = await db.execute<PendingRow[]>(
    `SELECT u.created_at, u.google_sub IS NOT NULL AS google_linked, ${LIVE_STAFF_SQL} AS live_staff, a.change_id
       FROM bg_users u
       LEFT JOIN bg_privacy_acknowledgments a ON a.user_id = u.id
      WHERE u.id = ? AND u.is_deleted = 0`,
    [userId],
  );
  if (rows.length === 0) return [];

  const acknowledged = rows.flatMap((row) => (row.change_id ? [row.change_id] : []));
  return pendingPrivacyChanges(
    rows[0].created_at ? String(rows[0].created_at) : null,
    acknowledged,
    privacyChangeDay(new Date()),
    PRIVACY_CHANGES,
    { googleLinked: Number(rows[0].google_linked) === 1, liveStaff: Number(rows[0].live_staff) === 1 },
  );
}

/**
 * Enregistre la prise de connaissance de changements **déjà validés** par
 * `checkPrivacyAcknowledgement`.
 *
 * `INSERT IGNORE` : acquitter deux fois (deux onglets, double clic) n'est pas une
 * erreur, la première date fait foi. L'insertion passe par un `SELECT` sur la
 * ligne du compte vivant : un acquittement arrivé après la suppression du
 * compte ne se pose pas sur une ligne anonymisée.
 */
export async function acknowledgePrivacyChanges(userId: number, changeIds: readonly string[]): Promise<void> {
  if (changeIds.length === 0) return;
  const db = await getDatabase();
  const changes = changeIds.map(() => "SELECT ? AS change_id").join(" UNION ALL ");
  await db.execute(
    `INSERT IGNORE INTO bg_privacy_acknowledgments (user_id, change_id)
     SELECT u.id, c.change_id
       FROM bg_users u
       JOIN (${changes}) c
      WHERE u.id = ? AND u.is_deleted = 0`,
    [...changeIds, userId],
  );
}

/** Prises de connaissance d'un compte, pour l'export RGPD — la date prouve que l'information a été présentée (la colonne `accepted_at` garde son nom d'origine). */
export async function listPrivacyAcknowledgments(
  userId: number,
): Promise<{ changeId: string; acceptedAt: string }[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { change_id: string; accepted_at: string })[]>(
    `SELECT change_id, accepted_at
       FROM bg_privacy_acknowledgments
      WHERE user_id = ?
      ORDER BY accepted_at, change_id`,
    [userId],
  );
  return rows.map((row) => ({ changeId: row.change_id, acceptedAt: toIso(row.accepted_at) ?? String(row.accepted_at) }));
}
