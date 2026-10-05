import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { ignoreMissingTable, isDuplicateEntryError } from "@/lib/server/mysql-errors";
import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { ANONYMOUS_PSEUDOS, pickAnonymousPseudo } from "@/lib/shared/anonymous-pseudos";

/**
 * L'effacement pur et simple, sous le verrou de `deleteOwnAccount`.
 *
 * Les cascades déjà déclarées font tout (sessions, appartenances, invitations
 * reçues) ; `bg_endurance_penalties.created_by` et `bg_team_invitations`
 * .`created_by` passent à `NULL`, la sanction restant due et l'invitation
 * restant l'acte de l'équipe. Les visites n'ont rien à suivre : elles ne
 * désignent aucun compte.
 */
export async function eraseAccount(connection: PoolConnection, userId: number): Promise<void> {
  // Une entrée solo jamais inscrite ni jouée part avec le compte : elle n'a pas
  // de clé étrangère, et son nom d'engagé est le pseudo du joueur — laissée en
  // place, elle le nommerait encore. Les deux `NOT EXISTS` ne sont pas une
  // redite de la trace : ils gardent l'entrée qu'une inscription aurait reprise
  // entre-temps, la suppression tournant alors en anonymisation au second essai.
  await connection.execute(
    `DELETE FROM bg_teams
      WHERE solo_user_id = ?
        AND NOT EXISTS (SELECT 1 FROM bg_tournament_registrations r WHERE r.team_id = bg_teams.id)
        AND NOT EXISTS (SELECT 1 FROM bg_matches m WHERE m.team1_id = bg_teams.id)
        AND NOT EXISTS (SELECT 1 FROM bg_matches m WHERE m.team2_id = bg_teams.id)`,
    [userId],
  );
  await connection.execute(`DELETE FROM bg_users WHERE id = ?`, [userId]);
}

/** Tentatives de pose d'un pseudo d'emprunt avant d'abandonner. */
const ANONYMOUS_PSEUDO_ATTEMPTS = 5;

/**
 * L'anonymisation : la ligne reste — ses matchs et son palmarès en dépendent —,
 * sous un **pseudo d'emprunt** (`lib/shared/anonymous-pseudos.ts`), et tout ce
 * qui désigne une personne part : tags de jeu et Discord, identités de
 * connexion, avatar, majorité, rôles de plateforme, consentements et
 * acceptation des conditions d'utilisation. Rien ne
 * relie plus la ligne à quelqu'un ; c'est la fiche du joueur qui annonce le
 * compte supprimé, jamais le nom, qu'un plateau affiche sans contexte.
 *
 * Le pseudo est posé **dans la même instruction** que le reste : les pseudos
 * déjà portés sont relus sur la connexion de la transaction, puis l'écriture
 * est tentée. Deux suppressions simultanées peuvent tirer le même nom, et
 * c'est l'index unique de `bg_users.pseudo` qui tranche — le perdant retire
 * son tirage et recommence. Sous MySQL, une instruction refusée n'annule pas
 * la transaction, seulement elle-même.
 */
export async function anonymizeAccount(connection: PoolConnection, userId: number): Promise<void> {
  const [takenRows] = await connection.execute<(RowDataPacket & { pseudo: string })[]>(
    `SELECT pseudo FROM bg_users
      WHERE id <> ?
        AND pseudo IN (${ANONYMOUS_PSEUDOS.map(() => "?").join(", ")})`,
    [userId, ...ANONYMOUS_PSEUDOS],
  );
  const taken = new Set(takenRows.map((row) => row.pseudo));
  for (let attempt = 0; ; attempt += 1) {
    const pseudo = pickAnonymousPseudo(taken);
    try {
      await connection.execute(
        `UPDATE bg_users
         SET pseudo = ?,
             avatar_url = NULL,
             overwatch_battletag = NULL,
             marvel_rivals_tag = NULL,
             discord_pseudo = NULL,
             -- Le tag part, sa certification avec : elle ne certifie rien d'autre
             -- que lui, et une date restée seule ferait d'un compte anonymisé un
             -- compte « vérifié » sans tag.
             discord_verified_at = NULL,
             discord_pseudo_from_discord = 0,
             is_adult = NULL,
             discord_id = NULL,
             -- La méthode décrit un rattachement, pas un compte : les trois portes
             -- partant, il n'en reste aucun à décrire.
             discord_link_method = NULL,
             google_sub = NULL,
             blizzard_sub = NULL,
             visible_avatar = 0,
             visible_overwatch = 0,
             visible_marvel = 0,
             visible_major = 0,
             visible_discord = 0,
             open_to_recruitment = 0,
             -- Un titre de staff est public (displayRoles) : il désignerait la
             -- personne derrière le pseudo d'emprunt aussi sûrement que son nom.
             is_admin = 0,
             platform_roles_json = NULL,
             -- La dernière acceptation des conditions part avec leur détail
             -- (bg_terms_acceptances, effacé plus bas) : un compte qui ne peut
             -- plus rien faire n'a plus d'acceptation à prouver, et une version
             -- datée restée seule serait une trace de plus sans objet.
             terms_version = NULL,
             terms_accepted_at = NULL,
             is_deleted = 1
         WHERE id = ?`,
        [pseudo, userId],
      );
      break;
    } catch (error) {
      if (!isDuplicateEntryError(error) || attempt + 1 >= ANONYMOUS_PSEUDO_ATTEMPTS) throw error;
      taken.add(pseudo);
    }
  }
  await connection.execute(`DELETE FROM bg_user_sessions WHERE user_id = ?`, [userId]);
  // Les consentements aux changements de traitement et la trace des messages
  // privés envoyés : ils ne concernent plus personne, et le compte ne sera plus
  // jamais sollicité (`is_deleted = 0` borne les deux lectures).
  await connection.execute(`DELETE FROM bg_privacy_acknowledgments WHERE user_id = ?`, [userId]);
  await connection.execute(`DELETE FROM bg_privacy_change_notifications WHERE user_id = ?`, [userId]);
  // Les appareils abonnés aux notifications push, et les sujets coupés : un
  // compte anonymisé ne reçoit plus rien, et garder l'adresse d'abonnement
  // d'un appareil qui n'est plus à personne serait garder une donnée sans
  // objet. Tables tolérées (`isMissingTableError`) : une base qui en manque
  // n'a rien à effacer.
  await ignoreMissingTable(connection.execute(`DELETE FROM bg_push_subscriptions WHERE user_id = ?`, [userId]));
  await ignoreMissingTable(connection.execute(`DELETE FROM bg_push_topic_optouts WHERE user_id = ?`, [userId]));
  // Même raison pour les acceptations des conditions d'utilisation. Les
  // signalements qu'il a envoyés restent à traiter — l'association en a
  // besoin —, mais ne pointent plus vers lui.
  await connection.execute(`DELETE FROM bg_terms_acceptances WHERE user_id = ?`, [userId]);
  // Les suspensions du compte : elles décrivent une personne que le compte ne
  // désigne plus, et un compte anonymisé ne peut plus se connecter — il n'y a
  // plus rien à suspendre ni à contester. Les décisions **prononcées** par ce
  // compte (staff) restent dues à leurs titulaires et ne sont pas touchées
  // (`created_by` ne se lit nulle part). Table tolérée : une base qui en
  // manque n'a rien à effacer.
  await ignoreMissingTable(connection.execute(`DELETE FROM bg_account_suspensions WHERE user_id = ?`, [userId]));
  await connection.execute(`UPDATE bg_reports SET reporter_user_id = NULL WHERE reporter_user_id = ?`, [userId]);
  // Détail map par map (`docs/features/MAP_SCORES.md`) : le résultat reste,
  // le lien vers le compte qui l'a saisi disparaît — c'est ce que promettent
  // `/rgpd` et le registre. L'anonymisation garde la ligne `bg_users`, la clé
  // étrangère `SET NULL` ne joue donc pas ici. Table tolérée.
  await ignoreMissingTable(
    connection.execute(`UPDATE bg_match_maps SET submitted_by_user_id = NULL WHERE submitted_by_user_id = ?`, [userId]),
  );
  // Les invitations et demandes **en attente** sont annulées, et c'est le seul
  // chemin par lequel un compte supprimé rejoignait encore une équipe vivante.
  // Une demande d'adhésion (`REQUEST`) déposée avant la suppression reste
  // visible du gérant, qui n'a aucune raison de deviner : l'accepter passe par
  // `respondToInvitation`, qui travaille sur un identifiant et non sur un
  // pseudo — le filtre de `getUserIdByPseudo` ne l'atteint pas. Le compte
  // réapparaissait alors au roster, à la fiche d'équipe et « avec équipe » à
  // l'annuaire. Dans l'autre sens, une invitation adressée au compte n'a plus
  // personne pour l'accepter : ses sessions viennent d'être effacées et ses
  // identités avec.
  //
  // `CANCELLED` plutôt qu'un `DELETE` : la ligne ne nomme plus personne (le
  // pseudo est anonymisé), et l'équipe garde la trace d'un échange qui a eu
  // lieu. Le mode « effacement » n'a rien à faire ici — la cascade emporte la
  // table avec la ligne.
  await connection.execute(
    `UPDATE bg_team_invitations
        SET status = 'CANCELLED', responded_at = NOW()
      WHERE user_id = ? AND status = 'PENDING'`,
    [userId],
  );
  // Un caster supprimé ne se présentera à aucun match à venir : son inscription
  // est retirée, sans quoi le lancement attendrait un « Prêt » que plus
  // personne ne peut donner (`lib/shared/match-launch.ts`). Les matchs joués
  // gardent la leur — l'histoire ne se réécrit pas, et le pseudo est anonymisé.
  // L'effacement n'a rien à faire : la clé étrangère passe à `NULL`.
  await connection.execute(
    `UPDATE bg_matches
        SET caster_user_id = NULL, caster_ready_at = NULL
      WHERE caster_user_id = ? AND status <> 'COMPLETED'`,
    [userId],
  );
  // Le pseudo anonymisé doit aussi remplacer le nom affiché en tournoi — sur la
  // connexion de la transaction, sans quoi le renommage survivrait à un
  // rollback de l'anonymisation qui l'a motivé.
  await syncSoloEntryIdentityOn(connection, userId);
}
