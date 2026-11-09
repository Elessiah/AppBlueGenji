import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  type AccountDeletionPlan,
  accountDeletionPlan,
  type AccountTrace,
  isReactivationWindowOpen,
  type SoloRegistrationFact,
  type StoredDate,
  withdrawableSoloRegistrations,
} from "@/lib/shared/account-deletion";
import { isReferencedRowError } from "@/lib/server/mysql-errors";
import { avatarFileLocations } from "@/lib/server/logo-quarantine";
import { unlink } from "node:fs/promises";
import { closeUserStreams } from "@/lib/server/session-streams";
import { invalidateTeamIdentityViews } from "@/lib/server/ranking-cache";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { toDiskUploadPath } from "@/lib/shared/uploads";
import { recordAccountDeletion } from "@/lib/server/account-deletion-journal";
import { playedMatchSql } from "@/lib/shared/ranking";
import { publishMatchUpdatedEvent, publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import { anonymizeAccount, eraseAccount } from "./account-erasure";
import { dropDeletionHold, readDeletionHold } from "./account-deletion-hold";

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
    // effacer le compte la laisserait nommer quelqu'un qui n'existe plus. Règle
    // brute, d'avant D12 : la suppression (`loadAccountDeletionFacts`) la
    // corrige ensuite en retirant les inscriptions à un tournoi pas encore
    // commencé, sans match ; le rattrapage (`reconcileDeletedAccounts`) la
    // garde telle quelle (conservateur). Une
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
 * Les tournois où l'entrée solo du compte est inscrite, par id croissant : ceux
 * dont la suppression verrouille la ligne avant de décider (`deleteOwnAccount`).
 */
export async function listSoloRegistrationTournamentIds(runner: SqlRunner, userId: number): Promise<number[]> {
  const [rows] = await runner.execute<(RowDataPacket & { tournament_id: number })[]>(
    `SELECT DISTINCT r.tournament_id
       FROM bg_teams s
       JOIN bg_tournament_registrations r ON r.team_id = s.id
      WHERE s.solo_user_id = ?
      ORDER BY r.tournament_id`,
    [userId],
  );
  return rows.map((row) => Number(row.tournament_id));
}

/**
 * Les tournois dont un match nomme le compte (caster, lien de chaîne, arbitre),
 * par id croissant : `withdrawUserCasts` y verrouille des matchs, donc la ligne
 * du tournoi se prend **avant**, comme partout (tournoi, puis match).
 */
export async function listCastTournamentIds(runner: SqlRunner, userId: number): Promise<number[]> {
  const [rows] = await runner.execute<(RowDataPacket & { tournament_id: number })[]>(
    `SELECT m.tournament_id FROM bg_matches m JOIN bg_match_casters c ON c.match_id = m.id WHERE c.user_id = ?
     UNION
     SELECT m.tournament_id FROM bg_matches m JOIN bg_match_streams s ON s.match_id = m.id WHERE s.link_user_id = ?
     UNION
     SELECT tournament_id FROM bg_matches WHERE referee_user_id = ?
     ORDER BY tournament_id`,
    [userId, userId, userId],
  );
  return rows.map((row) => Number(row.tournament_id));
}

/** Plusieurs listes de tournois en une, sans doublon, par id croissant : l'ordre de prise des verrous. */
export function mergeTournamentIds(...lists: readonly (readonly number[])[]): number[] {
  return [...new Set(lists.flat())].sort((a, b) => a - b);
}

/**
 * Les inscriptions de l'entrée solo du compte, avec ce qui décide de leur sort
 * (`withdrawableSoloRegistrations`) : les dates du tournoi et la présence d'un
 * match qui nomme l'entrée **dans ce tournoi** (l'entrée solo est unique pour
 * tous les tournois du compte : un tournoi passé ne bloque pas le retrait d'un
 * tournoi à venir).
 */
export async function loadSoloRegistrations(runner: SqlRunner, userId: number): Promise<SoloRegistrationFact[]> {
  const [rows] = await runner.execute<(RowDataPacket & {
    tournament_id: number;
    team_id: number;
    state: SoloRegistrationFact["state"];
    finished_at: Date | string | null;
    registration_open_at: Date | string;
    registration_close_at: Date | string;
    start_at: Date | string;
    has_match: number;
  })[]>(
    `SELECT r.tournament_id, r.team_id, t.state, t.finished_at,
            t.registration_open_at, t.registration_close_at, t.start_at,
            (EXISTS (SELECT 1 FROM bg_matches m WHERE m.team1_id = s.id AND m.tournament_id = r.tournament_id)
              OR EXISTS (SELECT 1 FROM bg_matches m WHERE m.team2_id = s.id AND m.tournament_id = r.tournament_id))
              AS has_match
       FROM bg_teams s
       JOIN bg_tournament_registrations r ON r.team_id = s.id
       JOIN bg_tournaments t ON t.id = r.tournament_id
      WHERE s.solo_user_id = ?
      ORDER BY r.tournament_id`,
    [userId],
  );
  return rows.map((row) => ({
    tournamentId: Number(row.tournament_id),
    teamId: Number(row.team_id),
    state: row.state,
    finishedAt: row.finished_at,
    registrationOpenAt: row.registration_open_at,
    registrationCloseAt: row.registration_close_at,
    startAt: row.start_at,
    hasMatch: Boolean(Number(row.has_match)),
  }));
}

/** Les traces du compte, et les inscriptions solo que l'effacement retirera. */
export type AccountDeletionFacts = {
  trace: AccountTrace;
  /** Vide si rien n'est à retirer — ou si la ligne est retenue par ailleurs. */
  soloWithdrawals: readonly SoloRegistrationFact[];
};

/**
 * Les traces du compte, l'inscription solo **jamais jouée à un tournoi pas
 * encore commencé** mise à part (décision D12) : elle ne retient plus la ligne,
 * elle part avec le compte. Toute autre inscription solo la retient toujours.
 *
 * `locked` : les tournois verrouillés par la transaction (`null` pour
 * l'aperçu) — voir `withdrawableSoloRegistrations`.
 */
export async function loadAccountDeletionFacts(
  runner: SqlRunner,
  userId: number,
  locked: ReadonlySet<number> | null,
): Promise<AccountDeletionFacts> {
  const trace = await loadAccountTrace(runner, userId);
  if (!trace.soloRegistrations) return { trace, soloWithdrawals: [] };
  const withdrawals = withdrawableSoloRegistrations(await loadSoloRegistrations(runner, userId), locked);
  if (withdrawals === null) return { trace, soloWithdrawals: [] };
  return { trace: { ...trace, soloRegistrations: false }, soloWithdrawals: withdrawals };
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
  return accountDeletionPlan((await loadAccountDeletionFacts(db, userId, null)).trace);
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
  const plan = await deleteAccountNow(userId, false);
  if (plan === null) throw new Error("USER_NOT_FOUND");
  return plan;
}

/**
 * La suppression **définitive** d'un compte en attente (E4) : rien si la
 * demande a été annulée (réactivation) ou si ses trente jours ne sont pas
 * écoulés — relu sous le verrou du compte. Idempotent : un compte déjà effacé
 * ou anonymisé n'est plus en attente. Rend `null` quand rien n'est fait.
 * `accountCreatedAt` (rejeu du journal) : rien non plus si la ligne verrouillée
 * n'est pas ce compte-là (identifiant réattribué).
 */
export async function finalizeAccountDeletion(
  userId: number,
  options: { accountCreatedAt?: string } = {},
): Promise<AccountDeletionPlan | null> {
  return deleteAccountNow(userId, true, options.accountCreatedAt);
}

/**
 * Efface ou anonymise le compte selon le plan. À l'effacement, les fichiers des
 * avatars en quarantaine sont relevés sous le verrou (la cascade emporte leurs
 * lignes) ; aucune empreinte n'est bloquée : un avatar seulement **masqué** se
 * conteste encore, seule sa suppression par la modération le bloque (décision
 * D6, `lib/server/blocked-images.ts`). Anonymisé, le compte n'est plus en
 * attente : la suppression est faite.
 */
async function applyDeletionMode(
  connection: PoolConnection,
  userId: number,
  plan: AccountDeletionPlan,
  soloWithdrawals: readonly SoloRegistrationFact[],
): Promise<{ withdrawal: { tournamentIds: number[] }; withdrawnFrom: number[]; quarantinedFiles: string[] }> {
  if (plan.mode === "ERASE") {
    const quarantinedFiles = await loadQuarantinedAvatarFiles(connection, userId);
    const withdrawal = await eraseAccount(connection, userId, soloWithdrawals);
    return {
      withdrawal,
      withdrawnFrom: soloWithdrawals.map((registration) => registration.tournamentId),
      quarantinedFiles,
    };
  }
  const withdrawal = await anonymizeAccount(connection, userId);
  await connection.execute(`UPDATE bg_users SET deletion_requested_at = NULL WHERE id = ? AND is_deleted = 1`, [userId]);
  // Le vrai pseudo mis de côté pour la réactivation ne survit pas à la
  // suppression définitive (l'effacement l'emporte par cascade).
  await dropDeletionHold(connection, userId);
  return { withdrawal, withdrawnFrom: [], quarantinedFiles: [] };
}

/** Une suite après le commit ; une erreur est consignée, jamais propagée (la suppression est faite). */
function afterCommit(step: () => void, failure: string): void {
  try {
    step();
  } catch (error) {
    console.error(`[account-deletion] ${failure} :`, error);
  }
}

/** Prévient un tournoi après le commit ; un écouteur qui lève est consigné, jamais propagé. */
function publishAfterCommit(publish: () => void, tournamentId: number): void {
  afterCommit(publish, `Tournoi #${tournamentId} non prévenu`);
}

/** La suppression définitive est due : demande relevée il y a trente jours ou plus, compte toujours en attente. */
function deletionIsDue(row: { is_deleted: 0 | 1; deletion_requested_at: StoredDate } | undefined): boolean {
  return (
    row !== undefined &&
    Number(row.is_deleted) === 1 &&
    row.deletion_requested_at !== null &&
    !isReactivationWindowOpen(row.deletion_requested_at)
  );
}

/**
 * Les fichiers d'avatar en quarantaine du compte (signalés, masqués) — ce que
 * l'effacement emporte. Lus **sous le verrou du compte**, dans la transaction
 * qui efface : un avatar masqué pendant l'attente du verrou est vu, et son
 * fichier part avec les autres après le commit.
 */
async function loadQuarantinedAvatarFiles(runner: SqlRunner, userId: number): Promise<string[]> {
  const [rows] = await runner.execute<(RowDataPacket & { logo_url: string })[]>(
    `SELECT logo_url FROM bg_logo_quarantines WHERE user_id = ? AND status = 'HIDDEN' ORDER BY id`,
    [userId],
  );
  return rows
    .map((row) => avatarFileLocations(row.logo_url, userId)?.quarantined ?? null)
    .filter((file): file is string => file !== null);
}

async function deleteAccountNow(
  userId: number,
  onlyIfDue: boolean,
  expectedCreatedAt?: string,
): Promise<AccountDeletionPlan | null> {
  const db = await getDatabase();
  // Les tournois où l'entrée solo est inscrite, relevés **avant** de prendre une
  // connexion : la relève en emprunte une autre au pool, et en tenir une pendant
  // ce temps ferait attendre chaque suppression simultanée sur une connexion que
  // les autres tiennent (pool saturé, plus aucune requête ne passe).
  // Y compris ceux de ses casts et arbitrages : la transaction verrouille leurs
  // matchs, et le tournoi se verrouille avant (`listCastTournamentIds`).
  const soloTournaments = mergeTournamentIds(
    await listSoloRegistrationTournamentIds(db, userId),
    await listCastTournamentIds(db, userId),
  );
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
  // Les tournois dont un match nommait le compte (caster, lien, arbitre) :
  // prévenus après le commit.
  let touchedTournaments: number[] = [];
  // Les tournois dont une inscription solo part avec le compte (D12) :
  // instantanés et aperçus à relire après le commit.
  let withdrawnFrom: number[] = [];
  // Les avatars en quarantaine qu'emporte l'effacement : le fichier part après
  // le commit.
  let quarantinedFiles: string[] = [];

  try {
    // Une inscription faite entre le relevé ci-dessus et le verrou tombe dans un
    // tournoi non verrouillé, et retient alors la ligne
    // (`withdrawableSoloRegistrations`).
    await connection.beginTransaction();

    // Les tournois d'abord, par id croissant, **avant toute lecture** : la
    // transaction peut retirer une inscription (D12), elle lit puis écrit les
    // inscrites et prend donc `lockTournamentRow` en tête, comme le retrait
    // d'un engagé. Même ordre que l'inscription en tournoi individuel
    // (tournoi, puis compte dans `ensureSoloEntry`) : deux verrous pris dans le
    // même ordre ne s'attendent pas l'un l'autre.
    for (const tournamentId of soloTournaments) await lockTournamentRow(connection, tournamentId);

    // Verrou du compte avant toute lecture ordinaire, et lecture des traces juste
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
      is_deleted: 0 | 1;
      deletion_requested_at: StoredDate;
    })[]>(
      `SELECT avatar_url, discord_id, created_at, is_deleted, deletion_requested_at FROM bg_users WHERE id = ? FOR UPDATE`,
      [userId],
    );
    if (locked.length === 0 && !onlyIfDue) throw new Error("USER_NOT_FOUND");
    // La fenêtre de réactivation, relue sous le verrou : une reconnexion qui
    // vient de réactiver le compte, ou une demande encore dans ses trente
    // jours, ne tombe pas.
    const otherAccount = expectedCreatedAt !== undefined && String(locked[0]?.created_at) !== expectedCreatedAt;
    if (onlyIfDue && (!deletionIsDue(locked[0]) || otherAccount)) {
      await connection.rollback();
      return null;
    }
    // Anonyme depuis la demande, le compte en attente n'a plus d'avatar sur sa
    // ligne : son chemin attend dans le masque (`account-deletion-hold.ts`).
    const hold = await readDeletionHold(connection, userId, true);
    orphanedAvatar = toDiskUploadPath(locked[0].avatar_url ?? hold?.avatarUrl ?? null);
    accountCreatedAt = String(locked[0].created_at);

    const facts = await loadAccountDeletionFacts(connection, userId, new Set(soloTournaments));
    plan = accountDeletionPlan(facts.trace);

    // Les visites n'ont rien à détacher : `bg_site_visits` ne garde aucun lien
    // vers un compte, seulement une empreinte salée qu'on ne sait pas renverser
    // (`lib/server/site-visits-service.ts`).

    const applied = await applyDeletionMode(connection, userId, plan, facts.soloWithdrawals);
    quarantinedFiles = applied.quarantinedFiles;
    withdrawnFrom = applied.withdrawnFrom;
    const withdrawal = applied.withdrawal;
    touchedTournaments = withdrawal.tournamentIds;

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
    // Sur une connexion morte, l'annulation lève à son tour : gardée, pour que
    // l'erreur d'origine (dont `ACCOUNT_STILL_REFERENCED`) reste celle rendue.
    await connection.rollback().catch(() => {});
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
  afterCommit(() => closeUserStreams(userId), "Flux de tournoi du compte non fermés");

  // Les instantanés ouverts des matchs qu'il castait ou arbitrait montreraient
  // sinon son cast, le lien de sa chaîne ou « Arbitre désigné » jusqu'à la
  // prochaine écriture du match ; l'évènement remet aussi à jour le message
  // #live de la soirée (`publishMatchUpdatedEvent`), qui portait ce lien.
  // La suppression est commitée : un écouteur qui lève ne doit ni la faire lire
  // comme un échec, ni sauter le ménage de l'avatar et la ligne du journal.
  for (const tournamentId of touchedTournaments) {
    publishAfterCommit(() => publishMatchUpdatedEvent(tournamentId, { landingLive: true }), tournamentId);
  }

  // Le plateau des tournois dont l'inscription solo est partie (D12) : la liste
  // des engagés, l'aperçu du tirage et les instantanés ouverts.
  for (const tournamentId of withdrawnFrom) publishAfterCommit(() => publishUpdatedEvent(tournamentId), tournamentId);

  // L'accueil, lu sans compte, garde en cache des vues qui nomment l'entrée
  // solo du compte (bandeau, mini-arbre, leaderboard) et le compteur de
  // joueurs, le classement ses identités (nom et logo de l'entrée solo
  // anonymisée) et la liste des fiches de comptes supprimés sans statistiques
  // (`profileless-players.ts`) : sans cela, le pseudo d'un compte supprimé y
  // resterait servi jusqu'à l'échéance de ces caches.
  afterCommit(invalidateTeamIdentityViews, "Vues de l'accueil non invalidées");

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
  for (const file of quarantinedFiles) await unlink(file).catch(() => {});

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
