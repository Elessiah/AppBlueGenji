import type { Pool, RowDataPacket } from "mysql2/promise";
import { strayLiftAuditLine } from "@/lib/server/player-view-audit";
import { liftImpersonations } from "@/lib/server/impersonation-sql";
import { CONTACT_DISCORD_URL_KEY, CONTACT_EMAIL_KEY, SUPERSEDED_CONTACT_EMAILS } from "@/lib/shared/contact";
import { DISCORD_INVITE_URL, SUPERSEDED_DISCORD_INVITE_URLS } from "@/lib/shared/discord";

/** Rattrapages permanents, rejoués à chaque démarrage. */
export async function applyPermanentCatchUps(db: Pool): Promise<void> {
  // Quatre filets, et non des migrations à cocher : leur cause peut se reproduire,
  // et ils sont donc **volontairement** rejoués à chaque démarrage. Tous quatre
  // sont idempotents et ne trouvent rien à faire dans le cas nominal.

  // L'invitation Discord est une constante partout **sauf** en pied de page, où
  // elle est une donnée que le staff peut modifier (`contact_discord_url`).
  // Changer de serveur ne suffit donc pas à changer ce lien-là, et l'écran qui
  // l'affiche est justement celui qu'on ne relit jamais — la panne serait muette,
  // l'ancienne adresse menant toujours quelque part.
  //
  // Seules les adresses **périmées connues** sont remplacées : une invitation que
  // le staff a saisie lui appartient, et l'écraser à chaque démarrage ferait de
  // ce champ un leurre.
  try {
    const placeholders = SUPERSEDED_DISCORD_INVITE_URLS.map(() => "?").join(", ");
    await db.execute(
      `UPDATE bg_settings
          SET setting_value = ?
        WHERE setting_key = ?
          AND setting_value IN (${placeholders})`,
      [DISCORD_INVITE_URL, CONTACT_DISCORD_URL_KEY, ...SUPERSEDED_DISCORD_INVITE_URLS],
    );
  } catch {
    // Rattrapage remis au prochain démarrage.
  }

  // Même panne pour le courriel du pied de page (`contact_email`) : un ancien
  // défaut y a écrit une adresse **fausse**, que le site affichait sur toutes les
  // pages vitrine comme celle de l'association. Elle est **vidée** — le canal
  // disparaît du pied de page, le vrai courriel figurant dans les mentions
  // légales —, et seules les adresses fausses connues le sont : celle que le
  // staff a saisie lui appartient.
  try {
    const placeholders = SUPERSEDED_CONTACT_EMAILS.map(() => "?").join(", ");
    await db.execute(
      `UPDATE bg_settings
          SET setting_value = ''
        WHERE setting_key = ?
          AND setting_value IN (${placeholders})`,
      [CONTACT_EMAIL_KEY, ...SUPERSEDED_CONTACT_EMAILS],
    );
  } catch {
    // Rattrapage remis au prochain démarrage.
  }

  // Le logo d'une entrée solo est une **copie** de l'avatar du joueur. Le
  // masquage posé dans `solo-entries-service` ne vaut que pour les écritures à
  // venir — la prochaine inscription ou édition de profil —, si bien qu'une ligne
  // déjà écrite continuerait de publier un avatar masqué, jusque sur la carte
  // « match en direct » de l'accueil que lit un visiteur sans compte. Le chemin
  // inverse (l'avatar redevient public) est tenu par `syncSoloEntryIdentity`.
  //
  // Le `try` n'est pas une formalité : c'est la seule instruction de cette passe
  // qui prenne des **verrous de ligne** sur une table chaude — `registerGhostTeams`
  // tient `bg_teams` sous `SELECT … FOR UPDATE` le temps de 32 insertions. Un lot
  // d'inscriptions qui chevauche un démarrage à froid rendrait
  // `ER_LOCK_WAIT_TIMEOUT`, et l'exception emporterait tout ce qui suit.
  try {
    await db.execute(`
      UPDATE bg_teams t
        JOIN bg_users u ON u.id = t.solo_user_id
         SET t.logo_url = NULL
       WHERE t.solo_user_id IS NOT NULL
         AND u.visible_avatar = 0
         AND t.logo_url IS NOT NULL
    `);
  } catch {
    // Rattrapage remis au prochain démarrage.
  }

  await liftStrayImpersonations(db);
}

/**
 * Lève l'incarnation **en cours** des sessions d'un compte qui n'est pas (ou
 * plus) administrateur (`docs/features/ADMIN_ROLE_IMPERSONATION.md`) : ignorée
 * tant qu'il ne l'est pas, elle revenait telle quelle s'il le redevenait dans
 * les 12 h. Cause rare mais possible à tout moment — une entrée qui croise une
 * rétrogradation et dont le retour échoue (`setPlayerView`) —, et reste
 * d'avant la fonctionnalité (vue joueur ouverte aux non-administrateurs).
 *
 * En deux temps, sans verrou sur `bg_users` : une lecture cohérente (sans
 * verrou) trouve les sessions, puis un `UPDATE` sur leur seule table, borné à
 * chaque session **et à l'échéance lue** — rien ne se prend dans l'ordre
 * inverse de la rétrogradation (`bg_users` puis sessions). Une session
 * redevenue légitime entre les deux (compte promu, retour puis nouvelle entrée
 * depuis un autre processus) porte une autre échéance : elle n'est pas levée
 * (l'échéance est à la seconde, une entrée la repousse de 12 h). Les rôles
 * incarnés partent avec l'échéance (sans leur colonne, l'échéance seule). Une
 * ligne pm2 sans nom donne le nombre de sessions levées (registre, T05).
 * Toute panne est remise au démarrage suivant.
 */
export async function liftStrayImpersonations(db: Pool): Promise<void> {
  try {
    // `idx_bg_sessions_player_view` : seules les sessions en incarnation sont lues.
    const [rows] = await db.execute<(RowDataPacket & { id: number | string; until_key: string })[]>(
      `SELECT s.id, CAST(s.player_view_until AS CHAR) AS until_key
         FROM bg_user_sessions s JOIN bg_users u ON u.id = s.user_id
        WHERE s.player_view_until > NOW() AND (u.is_admin = 0 OR u.is_deleted = 1)`,
    );
    if (rows.length === 0) return;
    const where = rows.map(() => "(id = ? AND player_view_until = ?)").join(" OR ");
    const params = rows.flatMap((row) => [Number(row.id), String(row.until_key)]);
    const lifted = await liftImpersonations(db, where, params);
    if (lifted > 0) console.info(strayLiftAuditLine("startup", lifted));
  } catch {
    // Rattrapage remis au prochain démarrage.
  }
}
