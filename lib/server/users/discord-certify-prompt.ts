/**
 * Fenêtre « Certifier ton tag Discord » proposée à la connexion — côté serveur
 * (`docs/features/DISCORD_CERTIFY_PROMPT.md`).
 *
 * Deux faits, deux colonnes :
 *
 * - `bg_user_sessions.certify_prompt_due` — posé à l'ouverture d'une session
 *   par Discord ou Blizzard (`createSession`), levé par la première réponse
 *   (« Plus tard », fermeture, passage au dialogue de « Mon profil »,
 *   certification réussie ou refusée parce que le tag ne peut plus être
 *   certifié depuis la fenêtre — `STATE_CHANGED` —, « Ne plus voir », qui le
 *   lève sur toutes les sessions du compte) ou dès qu'il n'y a plus rien à
 *   proposer : **une fois par connexion**, pas une fois par page ;
 * - `bg_users.discord_certify_prompt_dismissed_at` — « Ne plus voir », gardé
 *   sur le compte, remis à `NULL` à l'anonymisation, rendu dans l'export.
 *
 * Aucune de ces écritures ne certifie : seul `POST /api/profile/discord` le fait.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import { forgetCertificationPromptsOf } from "@/lib/server/tournaments/certification-prompt-cache";
import { certifyPromptFor, type CertifyPrompt } from "@/lib/shared/discord-certify-prompt";

type PromptRow = RowDataPacket & {
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_pseudo_from_discord: number | boolean | null;
};

/**
 * La fenêtre est-elle due pour cette session, et quel parcours offre-t-elle ?
 *
 * Une seule requête, toutes conditions comprises : session encore valide et
 * marquée, compte vivant, tag **non certifié**, pas de « Ne plus voir ». Une
 * colonne absente (son `ALTER` a échoué au démarrage) rend `null` : la
 * fenêtre se tait, la page ne tombe pas.
 *
 * Rien à proposer (tag déjà certifié, « Ne plus voir », compte supprimé) : la
 * marque de la session est levée sur-le-champ (sans l'attendre), sans quoi
 * chaque page de ses trente jours relancerait cette lecture pour rien — sauf
 * `{ clearStale: false }` : la relecture `GET` de la fenêtre n'écrit rien (une
 * lecture hors du contrôle de provenance des écritures), la page suivante
 * lèvera la marque.
 */
export async function loadDiscordCertifyPrompt(
  userId: number,
  tokenHash: string,
  { clearStale = true }: { clearStale?: boolean } = {},
): Promise<CertifyPrompt | null> {
  if (!Number.isInteger(userId) || userId <= 0 || !tokenHash) return null;
  const db = await getDatabase();
  try {
    const [rows] = await db.execute<PromptRow[]>(
      `SELECT u.discord_id, u.discord_pseudo, u.discord_pseudo_from_discord
       FROM bg_user_sessions s
       JOIN bg_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.user_id = ?
         AND s.certify_prompt_due = 1
         AND s.expires_at > NOW()
         AND u.is_deleted = 0
         AND u.discord_verified_at IS NULL
         AND u.discord_certify_prompt_dismissed_at IS NULL
       LIMIT 1`,
      [tokenHash, userId],
    );
    const row = rows[0];
    if (!row) {
      if (!clearStale) return null;
      // Jamais attendue : la réponse (`null`) n'en dépend pas, et la page
      // (mise en page racine) n'a pas à payer un aller-retour de plus.
      void markDiscordCertifyPromptSeen(userId, tokenHash).catch((error: unknown) =>
        console.error("[discord-certify-prompt] marque non levée", error),
      );
      return null;
    }
    return certifyPromptFor({
      discordId: row.discord_id,
      discordPseudo: row.discord_pseudo,
      pseudoFromDiscord: Number(row.discord_pseudo_from_discord ?? 0) === 1,
    });
  } catch (error) {
    if (!isUnknownColumnError(error)) throw error;
    if (!clearStale) return null;
    // Colonne du compte absente : lever la marque (colonne de session, elle,
    // présente puisque lue) évite une lecture vouée à l'échec à chaque page.
    void markDiscordCertifyPromptSeen(userId, tokenHash).catch(() => undefined);
    return null;
  }
}

/** « Plus tard » : la fenêtre ne revient pas avant la prochaine connexion. Une instruction. */
export async function markDiscordCertifyPromptSeen(userId: number, tokenHash: string): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0 || !tokenHash) return;
  const db = await getDatabase();
  await db.execute(
    `UPDATE bg_user_sessions SET certify_prompt_due = 0 WHERE token_hash = ? AND user_id = ?`,
    [tokenHash, userId],
  );
}

/**
 * « Ne plus voir » : posé sur le compte, jamais sur un compte supprimé. La date
 * d'un premier choix est gardée (`COALESCE`). Rend `true` si une ligne vivante
 * le porte désormais (déjà posé compris) — et lève alors la marque de
 * **toutes** ses sessions (choix du compte : une autre session ouverte ne
 * relira pas pour rien à sa page suivante).
 */
export async function recordDiscordCertifyPromptOff(userId: number): Promise<boolean> {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const db = await getDatabase();
  const [result] = await db.execute(
    `UPDATE bg_users
     SET discord_certify_prompt_dismissed_at = COALESCE(discord_certify_prompt_dismissed_at, NOW())
     WHERE id = ? AND is_deleted = 0`,
    [userId],
  );
  if (Number((result as { affectedRows?: number }).affectedRows ?? 0) === 0) return false;
  // Ce refus tait aussi l'invitation de la fiche tournoi (meneur, Discord seul
  // manquant) : celle retenue pour ce compte ne vaut plus.
  forgetCertificationPromptsOf(userId);
  // Au mieux : le choix est déjà gardé, et le chargeur lève lui-même une
  // marque restée (il filtre sur `discord_certify_prompt_dismissed_at`).
  await db
    .execute(`UPDATE bg_user_sessions SET certify_prompt_due = 0 WHERE user_id = ? AND certify_prompt_due = 1`, [userId])
    .catch((error: unknown) => console.error("[discord-certify-prompt] sessions non levées", error));
  return true;
}
