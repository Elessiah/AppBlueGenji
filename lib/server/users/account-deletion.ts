import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  type AccountDeletionPlan,
  accountDeletionPlan,
  type AccountTrace,
} from "@/lib/shared/account-deletion";
import { isReferencedRowError } from "@/lib/server/mysql-errors";
import { closeUserStreams } from "@/lib/server/session-streams";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { toDiskUploadPath } from "@/lib/shared/uploads";
import { recordAccountDeletion } from "@/lib/server/account-deletion-journal";
import { playedMatchSql } from "@/lib/shared/ranking";
import { anonymizeAccount, eraseAccount } from "./account-erasure";

/*
 * Suppression de son compte par le joueur : ce qu'elle emportera (le plan,
 * montré avant), puis la suppression elle-même, sous verrou.
 */

/**
 * Pool ou connexion de transaction : la lecture des traces se fait sur l'une ou
 * sur l'autre selon qu'on **informe** (route de prévisualisation, hors
 * transaction) ou qu'on **écrit** (suppression, sous verrou).
 */
type SqlRunner = Pick<PoolConnection, "execute">;

/**
 * Les quatre questions qui décident du sort d'un compte, en fragments SQL
 * portant sur une colonne `u.id`.
 *
 * « A joué » se lit comme les statistiques le lisent : un match **compté**
 * (`playedMatchSql` — ni exemption, ni match fantôme, ni double forfait) d'une
 * équipe dont il était membre **pendant le tournoi** (même fenêtre
 * d'appartenance que `stats-service`, close comprise : un joueur parti d'une
 * équipe a tout de même joué ses matchs sous ses couleurs), ou de son entrée
 * solo. Être seulement au roster d'une équipe engagée ne suffit plus : sans
 * match, la fiche du joueur n'a aucune statistique à garder sous un faux nom.
 *
 * Les deux côtés d'un match sont lus en deux branches : une jointure
 * `team1_id = … OR team2_id = …` n'utilise aucun des deux index.
 *
 * Les quatre questions sont écrites **une fois**, sur une colonne `u.id` : la
 * suppression les pose pour un compte (`FROM (SELECT ? AS id) u`), le
 * rattrapage des comptes supprimés pour tous d'un coup (`FROM bg_users u`).
 */
export function accountTraceSql(): {
  played: string;
  soloRegistered: string;
  organized: string;
  owned: string;
} {
  const played = playedMatchSql("m");
  const teamSide = (column: "team1_id" | "team2_id") => `EXISTS (
           SELECT 1
           FROM bg_team_members tm
           JOIN bg_matches m ON m.${column} = tm.team_id
           JOIN bg_tournaments t ON t.id = m.tournament_id
           WHERE tm.user_id = u.id
             AND (t.finished_at IS NULL OR tm.joined_at <= t.finished_at)
             AND (tm.left_at IS NULL OR tm.left_at >= t.start_at)
             AND ${played}
         )`;
  const soloSide = (column: "team1_id" | "team2_id") => `EXISTS (
           SELECT 1
           FROM bg_teams s
           JOIN bg_matches m ON m.${column} = s.id
           WHERE s.solo_user_id = u.id
             AND ${played}
         )`;
  return {
    played: `(
         ${teamSide("team1_id")}
         OR ${teamSide("team2_id")}
         OR ${soloSide("team1_id")}
         OR ${soloSide("team2_id")}
       )`,
    // L'entrée solo compte dès qu'elle est **inscrite**, jouée ou non : son nom
    // d'engagé est le pseudo du joueur, et elle n'a pas de clé étrangère (une
    // cascade effacerait l'engagé, et avec lui l'historique des matchs) —
    // effacer le compte la laisserait nommer quelqu'un qui n'existe plus. Une
    // entrée jamais inscrite part avec le compte (eraseAccount). Question à
    // part de `played` parce que sa phrase l'est : une inscription jamais
    // jouée ne laisse aucune statistique à conserver.
    soloRegistered: `EXISTS (
         SELECT 1
         FROM bg_teams s
         JOIN bg_tournament_registrations r ON r.team_id = s.id
         WHERE s.solo_user_id = u.id
       )`,
    organized: `EXISTS (
         SELECT 1 FROM bg_tournaments WHERE organizer_user_id = u.id
       )`,
    owned: `EXISTS (
         SELECT 1
         FROM bg_team_members om
         JOIN bg_teams ot ON ot.id = om.team_id AND ot.deleted_at IS NULL
         WHERE om.user_id = u.id AND om.left_at IS NULL
           AND JSON_CONTAINS(om.roles_json, '"OWNER"')
       )`,
  };
}

/**
 * Ce que ce compte laisse derrière lui, en **une** requête.
 *
 * Quatre `EXISTS` indexés plutôt que quatre allers-retours : la suppression est
 * un geste unique, ses quatre questions se posent au même instant et sur le même
 * instantané. Les poser séparément laisserait un `await` entre elles — un
 * tournoi créé entre la deuxième et la troisième et la ligne partirait quand
 * même, sur une base qui la refuse.
 */
export async function loadAccountTrace(
  runner: SqlRunner,
  userId: number,
): Promise<AccountTrace> {
  const trace = accountTraceSql();
  const [rows] = await runner.execute<(RowDataPacket & {
    played: number;
    solo_registered: number;
    organized: number;
    owned: number;
  })[]>(
    `SELECT
       ${trace.played} AS played,
       ${trace.soloRegistered} AS solo_registered,
       ${trace.organized} AS organized,
       ${trace.owned} AS owned
     FROM (SELECT ? AS id) u`,
    [userId],
  );
  const row = rows[0];
  // Une ligne absente **n'est pas** une absence de trace : lue en booléens, elle
  // donnerait trois `false`, donc `ERASE` — le seul dénouement qui ne se défait
  // pas, et l'exact contraire de la règle conservatrice du module pur. La
  // requête en rend toujours une aujourd'hui (une table dérivée d'une ligne) ;
  // le jour où elle porte un `FROM bg_users`, l'anomalie doit lever et non
  // effacer.
  if (!row) throw new Error("ACCOUNT_TRACE_UNAVAILABLE");
  return {
    playedMatches: Boolean(row.played),
    soloRegistrations: Boolean(row.solo_registered),
    organizedTournaments: Boolean(row.organized),
    ownedTeams: Boolean(row.owned),
  };
}

/**
 * Ce que la suppression **ferait** à ce compte, sans rien écrire.
 *
 * L'écran doit annoncer le geste avant le clic : une confirmation qui promet la
 * conservation des statistiques à un compte qui n'en a aucune est un mensonge
 * poli, et l'inverse serait pire. La question n'est posée qu'au moment où elle
 * peut changer la réponse — sur le chemin de la suppression, jamais à chaque
 * chargement du profil.
 *
 * Ce n'est **pas** une promesse : l'écriture repose la question sur son propre
 * instantané. Rien n'interdit qu'un tournoi soit créé entre les deux, et c'est
 * l'écriture qui fait foi.
 */
export async function getAccountDeletionPlan(userId: number): Promise<AccountDeletionPlan> {
  const db = await getDatabase();
  return accountDeletionPlan(await loadAccountTrace(db, userId));
}

/**
 * Supprimer son compte — **effacé** s'il ne laisse rien, anonymisé sinon.
 *
 * Le mode est décidé par `accountDeletionMode` (`lib/shared/account-deletion.ts`),
 * partagé avec l'écran qui annonce le geste avant le clic : une confirmation
 * qui promet la conservation des statistiques à un compte qui n'en a aucune est
 * un mensonge poli, et l'inverse serait pire.
 *
 * Lecture des traces et écriture vivent dans **une seule transaction**, sous un
 * verrou pris sur la ligne du compte : une trace relue hors transaction laisse
 * un `await` entre la question et la réponse, et l'effacement d'un compte ne se
 * défait pas. La transaction ferme au passage l'état intermédiaire de ses
 * écritures — un `DELETE` refusé après la purge des défis de connexion ne laisse
 * pas un compte à moitié défait.
 *
 * Deux choses échappent à la transaction, chacune pour sa raison : le **fichier
 * de l'avatar**, qu'un `unlink` ne rendrait pas (il part après le commit), et
 * les tables sans clé étrangère, dont seul le verrou du compte protège
 * — `bg_teams.solo_user_id` en particulier, que `ensureSoloEntry` verrouille de
 * son côté.
 *
 * Rend le plan appliqué — le mode **et** le motif —, pour que la route puisse
 * le dire au joueur : « tes statistiques restent » ne veut rien dire à qui n'en
 * a aucune et dont la ligne n'est retenue que par une équipe à transférer.
 */
export async function deleteOwnAccount(userId: number): Promise<AccountDeletionPlan> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  let plan: AccountDeletionPlan;
  // Le fichier de l'avatar, relevé **avant** l'effacement : la ligne partie, son
  // chemin ne se retrouve plus. Il ne part qu'après le commit — un `unlink` ne
  // se défait pas, et une transaction annulée rendrait un compte vivant sans sa
  // photo.
  let orphanedAvatar: string | null = null;
  // La date de création, relue sous le verrou : c'est elle qui permet au rejeu
  // de reconnaître **ce** compte-là après une restauration, l'identifiant seul
  // pouvant avoir été réattribué (`lib/shared/account-deletion-journal.ts`).
  let accountCreatedAt = "";

  try {
    await connection.beginTransaction();

    // Verrou en **toute première instruction**, et lecture des traces juste
    // après : sous `REPEATABLE READ`, c'est la première lecture *ordinaire* qui
    // fige l'instantané, si bien qu'une trace lue avant le verrou daterait
    // d'avant l'attente. Le compte est ici la ressource disputée, et une
    // inscription en tournoi individuel pose le même verrou (`ensureSoloEntry`)
    // — seul moyen de tenir une entrée solo, qui n'a volontairement aucune clé
    // étrangère et resterait sinon à pendre sur un identifiant disparu.
    //
    // L'inscription d'une **équipe** n'est pas couverte, et c'est assumé : elle
    // n'écrit que `bg_tournament_registrations`, qui ne référence que l'équipe,
    // sans jamais toucher `bg_team_members` — aucune clé étrangère ne tranche
    // donc cette course-là. Un membre qui supprime son compte à l'instant où sa
    // capitaine engage l'équipe est effacé alors qu'il figurait au roster
    // engagé. Rien ne pend (son appartenance part en cascade), l'équipe garde
    // son inscription et ses matchs, et ce qu'il perd est son propre historique
    // — ce qu'il venait de demander. Le fermer coûterait un verrou sur la ligne
    // de **chaque** membre à chaque inscription.
    const [locked] = await connection.execute<(RowDataPacket & {
      avatar_url: string | null;
      discord_id: string | null;
      created_at: string;
    })[]>(
      `SELECT avatar_url, discord_id, created_at FROM bg_users WHERE id = ? FOR UPDATE`,
      [userId],
    );
    if (locked.length === 0) throw new Error("USER_NOT_FOUND");
    orphanedAvatar = toDiskUploadPath(locked[0].avatar_url);
    accountCreatedAt = String(locked[0].created_at);

    plan = accountDeletionPlan(await loadAccountTrace(connection, userId));

    // Les visites n'ont rien à détacher : `bg_site_visits` ne garde aucun lien
    // vers un compte, seulement une empreinte salée qu'on ne sait pas renverser
    // (`lib/server/site-visits-service.ts`).

    if (plan.mode === "ERASE") {
      await eraseAccount(connection, userId);
    } else {
      await anonymizeAccount(connection, userId);
    }

    // Les signalements qui le visent gardent leur cible — ils restent à
    // traiter —, mais pas son pseudo : relevé à l'envoi pour survivre à la
    // disparition du compte, il est justement ce que la suppression promet de
    // retirer. Aucune clé étrangère ne le couvre (une cible n'en a pas, pour
    // ne pas emporter le signalement), et les deux modes sont concernés : le
    // panneau ne relit que les comptes vivants et retombe sinon sur ce relevé.
    await connection.execute(
      `UPDATE bg_report_targets SET label_snapshot = NULL WHERE target_type = 'USER' AND target_id = ?`,
      [userId],
    );

    // Les défis de connexion par message privé, relevés sur la ligne **avant**
    // qu'elle ne parte ou ne soit vidée de son identifiant.
    //
    // `bg_discord_login_challenges` n'a **aucune clé étrangère** — elle est
    // indexée sur un identifiant Discord, pas sur un compte du site —, donc
    // aucune cascade ne la couvre, et son seul ménage est la purge des lignes
    // expirées depuis un jour, déclenchée par la demande de code d'un *autre*
    // joueur : un soir calme, l'identifiant Discord du compte effacé reste en
    // base indéfiniment, alors qu'on vient de promettre qu'il ne resterait rien.
    // C'est la même coordonnée que le tag, et le seul geste des deux modes qui
    // regarde une table hors de `bg_users`.
    const discordId = locked[0].discord_id;
    if (discordId) {
      await connection.execute(
        `DELETE FROM bg_discord_login_challenges WHERE discord_id = ?`,
        [discordId],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    // Une clé étrangère en `RESTRICT` peut encore refuser l'effacement : ses
    // contrôles lisent la dernière version commitée et non l'instantané de la
    // transaction, donc un tournoi créé après la lecture des traces retient la
    // ligne. Le message brut de MySQL nomme la base, la table et la contrainte
    // — il partirait tel quel dans la notification, `DELETE /api/profile`
    // rendant le message de l'erreur. Un code stable à la place : le second
    // essai lira la trace et anonymisera, ce qui est la bonne réponse.
    if (isReferencedRowError(error)) throw new Error("ACCOUNT_STILL_REFERENCED");
    throw error;
  } finally {
    connection.release();
  }

  // Ses sessions sont parties avec la transaction, pas ses flux de tournoi
  // ouverts, qui ne relisent pas la session (`session-streams.ts`).
  closeUserStreams(userId);

  // Les deux modes effacent la photo : l'un fait disparaître la ligne, l'autre
  // met `avatar_url` à `NULL` — dans les deux cas le fichier resterait servi
  // par `/api/uploads/avatars/...`, donc une donnée personnelle publique que
  // plus aucune ligne ne désigne. L'échec est **avalé** : la suppression est
  // commitée, annoncer un refus au joueur serait faux.
  try {
    await deleteStoredImage(orphanedAvatar);
  } catch {
    // Fichier verrouillé ou disque en lecture seule : un résidu, pas un échec.
  }

  // Consignée **après** le commit, pour qu'une restauration de sauvegarde la
  // rejoue (`npm run replay:deletions`). Ne lève jamais : la suppression a eu
  // lieu, quoi qu'il arrive au journal.
  await recordAccountDeletion({
    userId,
    accountCreatedAt,
    deletedAt: new Date().toISOString(),
  });

  return plan;
}
