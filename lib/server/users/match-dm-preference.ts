/**
 * Messages privés Discord de match (`bg_users.match_dm_enabled`).
 *
 * Un joueur peut s'opposer, depuis « Mon profil », aux messages privés que le
 * bot lui envoie pour ses matchs : horaire posé, changé ou retiré, rappels
 * (24 h, check-in de 10 h), « Match retiré ». Base légale de ces messages :
 * l'intérêt légitime de l'organisation à prévenir les joueurs de leurs matchs ;
 * ce réglage honore le **droit d'opposition** (art. 21 RGPD). Il est lu par
 * `loadNotificationRecipients(…, { matchDm: true })` (`lib/server/notify.ts`),
 * seul chemin des messages privés de match.
 *
 * Ce qu'il ne touche pas : les notifications push (réglées par sujet dans le
 * même écran), les messages du staff (arbitres, administration : exécution du
 * service), les autres messages privés au compte (modération, données).
 *
 * Défaut `1` (activé) : le comportement d'avant le réglage. Remis au défaut à
 * l'anonymisation, exporté avec les données du compte.
 */
import { getDatabase } from "@/lib/server/database";

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
