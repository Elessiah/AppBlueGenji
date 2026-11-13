import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  type AccountDeletionPlan,
  accountDeletionPlan,
  type AccountTrace,
  type SoloRegistrationFact,
  type StoredDate,
  withdrawableSoloRegistrations,
} from "@/lib/shared/account-deletion";
import { isReferencedRowError } from "@/lib/server/mysql-errors";
import { deletionDueSql, windowFlag } from "@/lib/server/users/reactivation-window";
import { avatarFileLocations } from "@/lib/server/logo-quarantine";
import { unlink } from "node:fs/promises";
import { blockRemovedImageFiles } from "@/lib/server/blocked-images";
import { storedUploadAbsolutePath } from "@/lib/server/stored-upload-cleanup";
import { closeUserStreams } from "@/lib/server/session-streams";
import { invalidateTeamIdentityViews } from "@/lib/server/ranking-cache";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { toDiskUploadPath, toServedUploadUrl } from "@/lib/shared/uploads";
import { recordAccountDeletion } from "@/lib/server/account-deletion-journal";
import { playedMatchSql } from "@/lib/shared/ranking";
import { publishMatchUpdatedEvent, publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { retryOnDeadlock } from "@/lib/server/tournaments/deadlock-retry";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { anonymizeAccount, eraseAccount } from "./account-erasure";
import { dropDeletionHold, readDeletionHold } from "./account-deletion-hold";
import { failureReason } from "@/lib/server/failure-reason";

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
 * Les tournois où l'entrée solo du compte est inscrite, par id croissant — tous
 * (`openOnly` faux : ceux dont les lecteurs voient son nom d'engagé changer),
 * ou les seuls tournois **pas encore commencés** (`openOnly`) : ceux dont la
 * suppression verrouille la ligne avant de décider (`deleteOwnAccount`). Une
 * inscription à un tournoi en cours ou terminé ne se retire jamais : verrouiller
 * sa ligne ferait attendre un tournoi en cours pour rien.
 */
export async function listSoloRegistrationTournamentIds(
  runner: SqlRunner,
  userId: number,
  openOnly = false,
): Promise<number[]> {
  const openJoin = openOnly
    ? `
       JOIN bg_tournaments t ON t.id = r.tournament_id AND t.state IN ('UPCOMING', 'REGISTRATION')`
    : "";
  const [rows] = await runner.execute<(RowDataPacket & { tournament_id: number })[]>(
    `SELECT DISTINCT r.tournament_id
       FROM bg_teams s
       JOIN bg_tournament_registrations r ON r.team_id = s.id${openJoin}
      WHERE s.solo_user_id = ?
      ORDER BY r.tournament_id`,
    [userId],
  );
  return rows.map((row) => Number(row.tournament_id));
}

/** Levée quand une inscription solo est apparue hors du jeu de verrous : la transaction se rejoue. */
export class StaleLockSetError extends Error {
  constructor() {
    super("STALE_LOCK_SET");
    this.name = "StaleLockSetError";
  }
}

const STALE_LOCK_SET_ATTEMPTS = 3;

/**
 * Sous le verrou du compte (plus aucune inscription solo ne peut se prendre :
 * `ensureSoloEntry` le demande), relit les tournois pas encore commencés de
 * l'entrée solo. L'un d'eux manque au jeu de verrous relevé avant la
 * transaction — une inscription prise dans l'intervalle — : `StaleLockSetError`,
 * la transaction se rejoue avec un relevé frais (`retryOnStaleLockSet`). Sans
 * cela l'inscription restait (retirée à la passe horaire seulement), ou
 * retenait la ligne sous un motif faux (« tournoi déjà commencé »).
 * `lastAttempt` : on n'insiste plus, l'issue prudente d'avant s'applique.
 */
export async function assertSoloLockSetFresh(
  connection: SqlRunner,
  userId: number,
  locked: ReadonlySet<number>,
  lastAttempt: boolean,
): Promise<void> {
  if (lastAttempt) return;
  const open = await listSoloRegistrationTournamentIds(connection, userId, true);
  if (open.some((tournamentId) => !locked.has(tournamentId))) throw new StaleLockSetError();
}

/** Rejoue `write` tant qu'il lève `StaleLockSetError` ; `lastAttempt` est vrai au dernier essai. */
export async function retryOnStaleLockSet<T>(write: (lastAttempt: boolean) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await write(attempt >= STALE_LOCK_SET_ATTEMPTS);
    } catch (error) {
      if (!(error instanceof StaleLockSetError)) throw error;
    }
  }
}

/**
 * Les tournois dont un match nomme le compte (caster, lien de chaîne, arbitre,
 * lancement du direct — `live_trigger_user_id`, que `withdrawUserCasts`
 * verrouille aussi), par id croissant : `withdrawUserCasts` y verrouille des matchs, donc la ligne
 * du tournoi se prend **avant**, comme partout (tournoi, puis match).
 */
export async function listCastTournamentIds(runner: SqlRunner, userId: number): Promise<number[]> {
  const [rows] = await runner.execute<(RowDataPacket & { tournament_id: number })[]>(
    `SELECT m.tournament_id FROM bg_matches m JOIN bg_match_casters c ON c.match_id = m.id WHERE c.user_id = ?
     UNION
     SELECT m.tournament_id FROM bg_matches m JOIN bg_match_streams s ON s.match_id = m.id WHERE s.link_user_id = ?
     UNION
     SELECT tournament_id FROM bg_matches WHERE referee_user_id = ?
     UNION
     SELECT tournament_id FROM bg_matches WHERE live_trigger_user_id = ?
     ORDER BY tournament_id`,
    [userId, userId, userId, userId],
  );
  return rows.map((row) => Number(row.tournament_id));
}

/**
 * Les tournois **pas terminés** dont une page nomme le compte, par id
 * croissant : son entrée solo inscrite, l'effectif d'une équipe engagée dont il
 * est membre ou l'était au coup d'envoi (une équipe quittée avant ne le nomme
 * plus), un match qu'il caste, dont il a fourni le lien, qu'il
 * arbitre ou dont il a lancé le direct. La demande et la réactivation changent
 * le nom sous lequel il paraît : leurs lecteurs ouverts sont rediffusés
 * (`publishUpdatedEvent`). Un tournoi terminé n'a plus de flux qui vive des
 * jours : sa page se relit au chargement.
 *
 * `leftTeamIds` : les équipes que la demande vient de quitter. Leur départ
 * (`left_at = NOW()`) précède le coup d'envoi d'un tournoi pas commencé, que
 * la borne ci-dessus écarterait — alors que ses lecteurs ouverts affichent
 * encore l'effectif d'avant, nom compris : leurs tournois pas terminés sont
 * rediffusés aussi.
 */
export async function listNamingTournamentIds(
  runner: SqlRunner,
  userId: number,
  leftTeamIds: readonly number[] = [],
): Promise<number[]> {
  const justLeft = leftTeamIds.length > 0 ? `
         UNION
         SELECT r.tournament_id FROM bg_tournament_registrations r WHERE r.team_id IN (${leftTeamIds.map(() => "?").join(", ")})` : "";
  const [rows] = await runner.execute<(RowDataPacket & { tournament_id: number })[]>(
    `SELECT n.tournament_id
       FROM (
         SELECT r.tournament_id FROM bg_teams s JOIN bg_tournament_registrations r ON r.team_id = s.id WHERE s.solo_user_id = ?
         UNION
         SELECT r.tournament_id FROM bg_team_members tm
           JOIN bg_tournament_registrations r ON r.team_id = tm.team_id
           JOIN bg_tournaments rt ON rt.id = r.tournament_id
          WHERE tm.user_id = ? AND (tm.left_at IS NULL OR tm.left_at >= rt.start_at)
         UNION
         SELECT m.tournament_id FROM bg_matches m JOIN bg_match_casters c ON c.match_id = m.id WHERE c.user_id = ?
         UNION
         SELECT m.tournament_id FROM bg_matches m JOIN bg_match_streams st ON st.match_id = m.id WHERE st.link_user_id = ?
         UNION
         SELECT tournament_id FROM bg_matches WHERE referee_user_id = ?
         UNION
         SELECT tournament_id FROM bg_matches WHERE live_trigger_user_id = ?${justLeft}
       ) n
       JOIN bg_tournaments t ON t.id = n.tournament_id AND t.state <> 'FINISHED' AND t.finished_at IS NULL
      ORDER BY n.tournament_id`,
    [userId, userId, userId, userId, userId, userId, ...leftTeamIds],
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
 *
 * `accountCreatedAt` (rejeu du journal) : la ligne verrouillée doit être ce
 * compte-là, sans quoi rien n'est écrit (`ACCOUNT_REASSIGNED`). `replay` :
 * rejeu d'une restauration, aucun tournoi n'est synchronisé (ni lancé).
 *
 * @throws USER_NOT_FOUND | ACCOUNT_REASSIGNED
 */
export async function deleteOwnAccount(
  userId: number,
  options: { accountCreatedAt?: string; replay?: boolean } = {},
): Promise<AccountDeletionPlan> {
  const plan = await deleteAccountNow(userId, false, options.accountCreatedAt, options.replay === true);
  if (plan === null) throw new Error("USER_NOT_FOUND");
  return plan;
}

/**
 * La suppression **définitive** d'un compte en attente (E4) : rien si la
 * demande a été annulée (réactivation) ou si ses trente jours ne sont pas
 * écoulés — relu sous le verrou du compte. Idempotent : un compte déjà effacé
 * ou anonymisé n'est plus en attente. Rend `null` quand rien n'est fait.
 * `accountCreatedAt` (rejeu du journal) : si la ligne verrouillée n'est pas ce
 * compte-là (identifiant réattribué), rien n'est écrit et `ACCOUNT_REASSIGNED`
 * est levé. `replay` : rejeu d'une restauration, sans synchronisation.
 *
 * @throws ACCOUNT_REASSIGNED
 */
export async function finalizeAccountDeletion(
  userId: number,
  options: { accountCreatedAt?: string; replay?: boolean } = {},
): Promise<AccountDeletionPlan | null> {
  return deleteAccountNow(userId, true, options.accountCreatedAt, options.replay === true);
}

/**
 * Efface ou anonymise le compte selon le plan. À l'effacement, les fichiers des
 * avatars en quarantaine sont relevés sous le verrou (l'effacement retire leurs
 * lignes) sans que leur empreinte soit bloquée : un avatar seulement **masqué**
 * se conteste encore (décision D6, `lib/server/blocked-images.ts`). Seul
 * l'avatar du compte que la modération a **supprimé** (quarantaine `PURGED` à
 * son adresse) est bloqué, par `deleteAccountNow` après le commit. Anonymisé, le compte n'est plus en
 * attente : la suppression est faite.
 */
async function applyDeletionMode(
  connection: PoolConnection,
  userId: number,
  plan: AccountDeletionPlan,
  soloWithdrawals: readonly SoloRegistrationFact[],
): Promise<{
  withdrawal: { tournamentIds: number[]; liveTournamentIds: number[] };
  withdrawnFrom: number[];
  quarantinedFiles: string[];
}> {
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
export function afterCommit(step: () => void, failure: string): void {
  try {
    step();
  } catch (error) {
    console.error(`[account-deletion] ${failure} :`, failureReason(error));
  }
}

/**
 * La suppression définitive est due : demande relevée il y a trente jours ou
 * plus, compte toujours en attente. L'échéance vient de la base
 * (`deletionDueSql`, contre son `NOW()`), comme le relevé des comptes échus.
 */
function deletionIsDue(row: { is_deleted: 0 | 1; deletion_requested_at: StoredDate; deletion_due: unknown } | undefined): boolean {
  return (
    row !== undefined &&
    Number(row.is_deleted) === 1 &&
    row.deletion_requested_at !== null &&
    windowFlag(row.deletion_due)
  );
}

/**
 * Les fichiers d'avatar en quarantaine du compte (signalés, masqués) — ce que
 * l'effacement emporte. Lus **sous le verrou du compte**, dans la transaction
 * qui efface : un avatar masqué pendant l'attente du verrou est vu, et son
 * fichier part avec les autres après le commit.
 */
export async function loadQuarantinedAvatarFiles(runner: SqlRunner, userId: number): Promise<string[]> {
  const [rows] = await runner.execute<(RowDataPacket & { logo_url: string })[]>(
    `SELECT logo_url FROM bg_logo_quarantines WHERE user_id = ? AND status = 'HIDDEN' ORDER BY id`,
    [userId],
  );
  return rows
    .map((row) => avatarFileLocations(row.logo_url, userId)?.quarantined ?? null)
    .filter((file): file is string => file !== null);
}

/**
 * L'avatar que l'effacement emporte a-t-il été **supprimé par la modération**
 * (quarantaine `PURGED` à son adresse) ? Alors son empreinte est bloquée avant
 * que le fichier ne parte (D6) — un fichier qu'une suppression de modération
 * n'aurait pas pu atteindre (course, écriture refaite) ne s'échappe pas par
 * l'effacement. Un avatar seulement masqué ne l'est pas, ni un avatar dont la
 * contestation a été acceptée (D18, D23). Lu sous le verrou du
 * compte : l'effacement retire ces lignes (D31). Rend le **jour** de la
 * suppression la plus ancienne (`AAAA-MM-JJ`), que porte l'empreinte si elle
 * est neuve — jamais celui de l'effacement (D31) —, ou `null`. `settled` :
 * l'une de ces suppressions a bloqué l'image (`hash_blocked`) ou a vu sa
 * contestation maintenue — une suppression d'office dont la contestation
 * attend son issue ne bloque l'image qu'à l'effacement, jamais à
 * l'anonymisation (revue juridique #571, cycle 2).
 */
type ModerationRemoval = { day: string; settledDay: string | null };

async function avatarRemovedByModeration(
  runner: SqlRunner,
  userId: number,
  avatarUrl: string | null,
): Promise<ModerationRemoval | null> {
  const disk = toDiskUploadPath(avatarUrl);
  if (!disk) return null;
  // Sous ses deux formes, servie et disque, comme `isUploadReferenced`.
  // Deux jours : celui de toute suppression non annulée (effacement) et celui
  // des seules suppressions qui bloquent (anonymisation) — chacun daté par la
  // décision qui le justifie (D31).
  const [rows] = await runner.execute<(RowDataPacket & { removed_on: string | null; settled_on: string | null })[]>(
    `SELECT DATE_FORMAT(MIN(COALESCE(closed_at, hidden_at)), '%Y-%m-%d') AS removed_on,
            DATE_FORMAT(MIN(CASE WHEN hash_blocked = 1 OR contest_outcome = 'UPHELD'
                                 THEN COALESCE(closed_at, hidden_at) END), '%Y-%m-%d') AS settled_on
       FROM bg_logo_quarantines
      WHERE user_id = ? AND status = 'PURGED' AND logo_url IN (?, ?)
        AND (contest_outcome IS NULL OR contest_outcome = 'UPHELD')`,
    [userId, toServedUploadUrl(disk), disk],
  );
  const day = rows[0]?.removed_on ?? null;
  return day ? { day, settledDay: rows[0]?.settled_on ?? null } : null;
}

type LockedAccount = RowDataPacket & {
  avatar_url: string | null;
  discord_id: string | null;
  created_at: string;
  is_deleted: 0 | 1;
  deletion_requested_at: StoredDate;
  deletion_due: unknown;
};

/**
 * Verrouille la ligne du compte et dit si la suppression peut suivre. `null` :
 * rien à faire (`onlyIfDue` — ligne disparue, ou fenêtre de réactivation
 * relue sous le verrou encore ouverte : une reconnexion qui vient de réactiver
 * le compte, ou une demande encore dans ses trente jours, ne tombe pas).
 *
 * @throws USER_NOT_FOUND — ligne absente, suppression immédiate.
 * @throws ACCOUNT_REASSIGNED — rejeu : la ligne n'est pas ce compte-là ; levé
 *   pour que le rejeu le compte comme tel (`otherAccount`), jamais comme une
 *   demande à attendre.
 */
async function lockAccountForDeletion(
  connection: PoolConnection,
  userId: number,
  onlyIfDue: boolean,
  expectedCreatedAt: string | undefined,
): Promise<LockedAccount | null> {
  const [locked] = await connection.execute<LockedAccount[]>(
    `SELECT avatar_url, discord_id, created_at, is_deleted, deletion_requested_at, ${deletionDueSql()} AS deletion_due
       FROM bg_users WHERE id = ? FOR UPDATE`,
    [userId],
  );
  const account = locked[0];
  if (!account) {
    if (onlyIfDue) return null;
    throw new Error("USER_NOT_FOUND");
  }
  if (expectedCreatedAt !== undefined && String(account.created_at) !== expectedCreatedAt) {
    throw new Error("ACCOUNT_REASSIGNED");
  }
  if (onlyIfDue && !deletionIsDue(account)) return null;
  return account;
}

async function deleteAccountNow(
  userId: number,
  onlyIfDue: boolean,
  expectedCreatedAt?: string,
  replay = false,
): Promise<AccountDeletionPlan | null> {
  const db = await getDatabase();
  // Le fichier de l'avatar, relevé **avant** l'effacement : la ligne partie, son
  // chemin ne se retrouve plus. Il ne part qu'après le commit — un `unlink` ne
  // se défait pas, et une transaction annulée rendrait un compte vivant sans sa
  // photo.
  let orphanedAvatar: string | null = null;
  // Supprimé par la modération : bloqué avant d'être effacé (D6).
  // Assignée dans la transaction rejouable : le type est dit, pas déduit de `null`.
  let orphanedAvatarRemoval = null as ModerationRemoval | null;
  // La date de création, relue sous le verrou : c'est elle qui permet au rejeu
  // de reconnaître **ce** compte-là après une restauration, l'identifiant seul
  // pouvant avoir été réattribué (`lib/shared/account-deletion-journal.ts`).
  let accountCreatedAt = "";
  // Les tournois dont un match nommait le compte (caster, lien, arbitre) :
  // prévenus après le commit.
  let touchedTournaments: number[] = [];
  // Parmi eux, ceux dont un match touché n'est pas terminé : seuls ceux-là
  // peuvent changer l'accueil (le message #live, lui, est toujours redemandé).
  let liveTournaments: ReadonlySet<number> = new Set();
  // Les tournois dont une inscription solo part avec le compte (D12) :
  // instantanés et aperçus à relire après le commit.
  let withdrawnFrom: number[] = [];
  // Les avatars en quarantaine qu'emporte l'effacement : le fichier part après
  // le commit.
  let quarantinedFiles: string[] = [];
  // Les tournois pas encore commencés de l'entrée solo, synchronisés sous
  // verrou : prévenus après le commit (un coup d'envoi a pu y être donné).
  let startedTournaments: number[] = [];

  // Une transaction annulée par un interblocage (une désignation d'arbitre
  // verrouille le match puis le compte, la suppression l'inverse) se rejoue
  // entière, relevé des tournois compris (`retryOnDeadlock`) : sans quoi le
  // joueur lisait un échec générique et devait recommencer.
  const transact = async (lastAttempt: boolean): Promise<AccountDeletionPlan | null> => {
    // Les tournois pas encore commencés où l'entrée solo est inscrite (les seuls
    // dont une inscription peut partir), relevés **avant** de prendre une
    // connexion : la relève en emprunte une autre au pool, et en tenir une pendant
    // ce temps ferait attendre chaque suppression simultanée sur une connexion que
    // les autres tiennent (pool saturé, plus aucune requête ne passe).
    // Y compris ceux de ses casts et arbitrages : la transaction verrouille leurs
    // matchs, et le tournoi se verrouille avant (`listCastTournamentIds`).
    const openSoloTournaments = await listSoloRegistrationTournamentIds(db, userId, true);
    const soloTournaments = mergeTournamentIds(openSoloTournaments, await listCastTournamentIds(db, userId));
    const connection = await db.getConnection();
    try {
      // Une inscription faite entre le relevé ci-dessus et le verrou tombe dans un
      // tournoi non verrouillé : la transaction se rejoue (`assertSoloLockSetFresh`),
      // et au dernier essai elle retient la ligne (`withdrawableSoloRegistrations`).
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
      const account = await lockAccountForDeletion(connection, userId, onlyIfDue, expectedCreatedAt);
      if (!account) {
        await connection.rollback();
        return null;
      }
      await assertSoloLockSetFresh(connection, userId, new Set(soloTournaments), lastAttempt);
      // Les tournois pas encore commencés de l'entrée solo, remis à l'heure
      // comme au retrait d'un engagé par le staff (`syncTournamentState`) : un
      // tournoi dont l'heure de début est passée sans synchronisation passe en
      // cours ici, et son inscription retient la ligne (anonymisation) au lieu
      // d'être retirée d'un plateau déjà tiré. Ses lignes de journal partent
      // avec le commit. Seuls ceux dont l'état a changé sont rediffusés (comme
      // `syncOpenSoloTournamentsOn`, que ce module ne peut importer sans cycle).
      // Pas au rejeu d'une restauration (`replay`, dit par l'appelant), comme à la
      // demande : synchroniser lancerait des tournois pendant la remise en
      // état. Un tournoi dont l'heure est passée garde alors l'inscription
      // (la fenêtre de retrait la refuse) ; la passe horaire le lancera puis
      // forfaitera l'entrée, une fois le site rouvert.
      const changed: number[] = [];
      if (!replay) {
        for (const tournamentId of openSoloTournaments) {
          if ((await syncTournamentState(connection, tournamentId)).stateChanged) changed.push(tournamentId);
        }
      }
      // Anonyme depuis la demande, le compte en attente n'a plus d'avatar sur sa
      // ligne : son chemin attend dans le masque (`account-deletion-hold.ts`).
      const hold = await readDeletionHold(connection, userId, true);
      const avatarUrl = account.avatar_url ?? hold?.avatarUrl ?? null;
      orphanedAvatar = toDiskUploadPath(avatarUrl);
      orphanedAvatarRemoval = await avatarRemovedByModeration(connection, userId, avatarUrl);
      accountCreatedAt = String(account.created_at);

      const facts = await loadAccountDeletionFacts(connection, userId, new Set(soloTournaments));
      const plan = accountDeletionPlan(facts.trace);

      // Les visites n'ont rien à détacher : `bg_site_visits` ne garde aucun lien
      // vers un compte, seulement une empreinte salée qu'on ne sait pas renverser
      // (`lib/server/site-visits-service.ts`).

      const applied = await applyDeletionMode(connection, userId, plan, facts.soloWithdrawals);
      quarantinedFiles = applied.quarantinedFiles;
      withdrawnFrom = applied.withdrawnFrom;
      const withdrawal = applied.withdrawal;
      touchedTournaments = withdrawal.tournamentIds;
      liveTournaments = new Set(withdrawal.liveTournamentIds);

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
      const discordId = account.discord_id;
      if (discordId) {
        await connection.execute(
          `DELETE FROM bg_discord_login_challenges WHERE discord_id = ?`,
          [discordId],
        );
      }

      await connection.commit();
      afterCommit(() => flushBotLogs(connection), "Lignes de journal du coup d'envoi non envoyées");
      // Passés en cours : leurs lecteurs voient le coup d'envoi.
      startedTournaments = changed;
      return plan;
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
      // Après le commit, la file est déjà partie ; sur un échec, ses lignes
      // (coup d'envoi d'une transaction annulée) ne partent jamais.
      discardBotLogs(connection);
      connection.release();
    }
  };
  const plan = await retryOnStaleLockSet((lastAttempt) => retryOnDeadlock(() => transact(lastAttempt)));
  if (plan === null) return null;

  // Ses sessions sont parties avec la transaction, pas ses flux de tournoi
  // ouverts, qui ne relisent pas la session (`session-streams.ts`).
  afterCommit(() => closeUserStreams(userId), "Flux de tournoi du compte non fermés");

  // Les instantanés ouverts des matchs qu'il castait ou arbitrait montreraient
  // sinon son cast, le lien de sa chaîne ou « Arbitre désigné » jusqu'à la
  // prochaine écriture du match ; l'évènement remet aussi à jour le message
  // #live de la soirée (`publishMatchUpdatedEvent`), qui portait ce lien —
  // toujours ; le cache de l'accueil, lui, n'est vidé que pour les tournois
  // dont un match touché n'est pas terminé (`landingLive`).
  // La suppression est commitée : un écouteur qui lève ne doit ni la faire lire
  // comme un échec, ni sauter le ménage de l'avatar et la ligne du journal.
  for (const tournamentId of touchedTournaments) {
    afterCommit(
      () => publishMatchUpdatedEvent(tournamentId, { landingLive: liveTournaments.has(tournamentId) }),
      `Tournoi #${tournamentId} non prévenu`,
    );
  }
  // Le cache des pseudos d'arbitre n'est pas vidé : le retrait de l'arbitrage
  // (`referee_user_id` remis à NULL) change la version des instantanés touchés,
  // donc la clé — vider tout le cache à chaque suppression le rendrait inutile.

  // Le plateau des tournois dont l'inscription solo est partie (D12) : la liste
  // des engagés, l'aperçu du tirage et les instantanés ouverts.
  for (const tournamentId of new Set([...withdrawnFrom, ...startedTournaments])) {
    afterCommit(() => publishUpdatedEvent(tournamentId), `Tournoi #${tournamentId} non prévenu`);
  }

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
  // Anonymisé, seule une suppression qui bloquait déjà (ou maintenue) bloque ;
  // effacé, toute suppression non annulée (comme `pinAccountBlockedHashesOn`).
  // Le blocage y est en principe déjà posé par la décision (`hash_blocked`) ;
  // l'appel ne compte que si le fichier vivant se lit encore (course, écriture
  // refaite).
  const blockDayFor =
    plan.mode === "ERASE" ? (orphanedAvatarRemoval?.day ?? null) : (orphanedAvatarRemoval?.settledDay ?? null);
  const blockedFile = blockDayFor ? storedUploadAbsolutePath(orphanedAvatar, "avatars") : null;
  // Anonymisé, le compte garde ses lignes de quarantaine : le blocage reste
  // levable par une contestation acceptée (D18). Effacé, plus rien ne le
  // justifierait : définitif (revue sécurité #571, cycle 3).
  // Daté du jour de la suppression de modération, jamais de l'effacement (D31).
  if (blockedFile && blockDayFor) {
    await blockRemovedImageFiles([blockedFile], { liftable: plan.mode === "ANONYMIZE", day: blockDayFor });
  }
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
