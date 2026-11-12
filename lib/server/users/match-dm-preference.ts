/**
 * Messages privés Discord de match et d'équipe (`bg_users.match_dm_enabled`).
 *
 * Un joueur peut s'opposer, depuis « Mon profil », aux messages privés que le
 * bot lui envoie pour ses matchs (horaire posé, changé ou retiré, rappels,
 * check-in, « Match retiré ») et pour ses équipes (invitation, reprise
 * d'équipe fantôme proposée, propriété reçue, demande d'adhésion à une équipe
 * qu'il gère — décision D68). Base légale de ces messages : l'intérêt légitime
 * de l'association (bon déroulement des tournois, constitution des équipes) ;
 * ce réglage honore le **droit d'opposition** (art. 21 RGPD). Il est lu par
 * `loadNotificationRecipients(…, { matchDm: true })` (`lib/server/notify.ts`)
 * pour les messages de match, et par {@link withoutOptedOutDiscord} pour les
 * messages d'équipe (`team-invite-notifications.ts`, `team-join-notifications.ts`).
 *
 * Ce qu'il ne touche pas : les notifications push (réglées par sujet dans le
 * même écran), les messages du staff (arbitres, administration : exécution du
 * service), les autres messages privés au compte (modération, données).
 *
 * Défaut `1` (activé) : le comportement d'avant le réglage. Remis au défaut à
 * l'anonymisation, exporté avec les données du compte.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";

/** Code de refus d'une valeur qui n'est pas un booléen (`PUT /api/profile/match-dms`). */
export const INVALID_MATCH_DM_PREFERENCE = "INVALID_MATCH_DM_PREFERENCE";

/**
 * Une valeur lue en base ramenée à un booléen. Absente (`null`, colonne non
 * lue) : activé, le comportement d'avant le réglage. Seul l'envoi des messages
 * de match (`loadNotificationRecipients`) survit à une colonne manquante ;
 * « Mon profil » et l'export la lisent comme `locale`, sans repli.
 */
export function matchDmEnabled(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return Number(value) !== 0;
}

/**
 * Enregistre le choix. Une seule instruction, sans lecture préalable ; un
 * compte supprimé n'est jamais touché. Rend `true` si une ligne vivante porte
 * désormais ce choix.
 */
export async function recordMatchDmPreference(userId: number, enabled: boolean): Promise<boolean> {
  if (!Number.isInteger(userId) || userId <= 0 || typeof enabled !== "boolean") return false;
  const db = await getDatabase();
  const [result] = await db.execute(`UPDATE bg_users SET match_dm_enabled = ? WHERE id = ? AND is_deleted = 0`, [
    enabled ? 1 : 0,
    userId,
  ]);
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/**
 * Les destinataires donnés, **sans canal Discord** pour ceux qui ont coupé
 * leurs messages privés (`match_dm_enabled = 0`) : ils gardent leurs
 * notifications push, réglées par sujet. Pour les messages privés d'équipe,
 * dont les destinataires sont lus hors de `loadNotificationRecipients`.
 *
 * Colonne `match_dm_enabled` absente (migration en échec) : personne n'a pu s'y opposer, rien
 * n'est retiré. Toute autre erreur de lecture retire le canal Discord à tous :
 * dans le doute, une opposition n'est jamais enjambée (art. 21) — le push part.
 */
export async function withoutOptedOutDiscord<R extends { userId: number; discord: unknown }>(
  recipients: readonly R[],
): Promise<(R | (R & { discord: null }))[]> {
  const ids = [...new Set(recipients.filter((r) => r.discord !== null).map((r) => r.userId))];
  if (ids.length === 0) return [...recipients];
  let optedOut: Set<number>;
  try {
    const db = await getDatabase();
    const [rows] = await db.query<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM bg_users WHERE match_dm_enabled = 0 AND id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
    optedOut = new Set(rows.map((row) => Number(row.id)));
  } catch (error) {
    // Seule l'absence de cette colonne-ci vaut « personne n'a pu s'y opposer » :
    // une autre colonne inconnue reste une lecture en échec, donc fermée.
    if (isUnknownColumnError(error) && /match_dm_enabled/.test(String((error as { message?: unknown }).message ?? ""))) {
      return [...recipients];
    }
    console.error("[notify] réglage des messages privés illisible : envoi Discord retenu", failureReason(error));
    optedOut = new Set(ids);
  }
  return recipients.map((recipient) =>
    recipient.discord !== null && optedOut.has(recipient.userId) ? { ...recipient, discord: null } : recipient,
  );
}
