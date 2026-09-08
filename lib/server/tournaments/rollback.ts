/**
 * Retour en arrière : effacer le dernier stade joué d'un tournoi, à répétition.
 *
 * La décision — quel stade, et ce qu'il advient de ce qui le suit — appartient
 * au module pur `lib/shared/tournament-rollback.ts`, partagé avec l'interface.
 * Ici, trois choses : l'écriture, les quelques états du moteur qui ne se
 * déduisent pas des matchs, et l'entretien qui suit.
 *
 * **Le moteur n'a presque rien à apprendre.** On ne défait ni classement, ni
 * élimination, ni qualification : les trois modes à classement *rejouent* tout
 * depuis l'historique des matchs (`replaySwiss`, `replaySurvival`,
 * `replayEndurance`), et un stade effacé disparaît donc du rejeu comme s'il
 * n'avait jamais été joué. Il suffit d'effacer les saisies puis d'appeler la
 * réconciliation ordinaire, celle-là même qu'une correction de score déclenche.
 * Aucun mode n'a de branche « retour en arrière ».
 *
 * *Presque* : quatre états ne se déduisent pas des matchs, et ce module est seul
 * à devoir les reculer.
 *
 * · le **curseur de manche** d'un format à classement ({@link rewindRoundCursor}),
 *   posé sur le tournoi ou sur la phase selon où le format est joué ;
 * · le drapeau **`endurance_playoffs_started`**, qui doit retomber quand le
 *   dernier tour de l'arbre final vient d'être supprimé
 *   ({@link rewindEndurancePlayoffs}) ;
 * · l'**état des phases** d'un tournoi multi-phases, dont la clôture a distribué
 *   des qualifiées ({@link reopenPhases}) ;
 * · l'**état du tournoi** lui-même, quand il était terminé
 *   ({@link reopenTournament}).
 *
 * **Les identifiants de match survivent** partout où c'est possible. Le stade
 * visé est *vidé*, jamais supprimé : un identifiant de match est une adresse
 * publique — lien profond (`lib/shared/match-anchor.ts`), horaire annoncé,
 * diffusion programmée — et les rencontres vont se rejouer entre les mêmes
 * équipes. Ce qui suit n'a pas cette chance dans les formats à classement, ni
 * dans une phase ultérieure : le moteur y pose ses manches au fur et à mesure,
 * leurs appariements sont périmés, et il les reposera.
 *
 * **Un tournoi terminé se défait aussi**, et c'est la raison d'être de
 * {@link reopenTournament} : sans lui, la seule erreur qu'on ne pouvait plus
 * rattraper était celle de la finale — exactement celle qui compte le plus.
 * Corriger *un* score d'archive se rejoue déjà et réécrit un palmarès
 * (`docs/features/FINISHED_TOURNAMENT_RECONCILIATION.md`) ; effacer la finale
 * entière demande une chose de plus, rouvrir, parce qu'une clôture, elle, ne se
 * rejoue pas.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie";
import {
  planRoundRollback,
  rollbackStageLabelWithArticle,
  type RollbackMatch,
  type RollbackPlan,
} from "@/lib/shared/tournament-rollback";
import type { BracketType, PhaseFormat, TournamentFormat } from "@/lib/shared/types";
import { discardBotLogs, flushBotLogs } from "./bot-logs";
import { tryAutoResolveByes } from "./byes";
import { publishUpdatedEvent } from "./notifications";
import { loadPhases } from "./phases-repository";
import { resetRegistrationRanks } from "./repository";
import { syncTournamentState } from "./state";

/** Réglages du geste. */
export type RollbackOptions = {
  /**
   * Stade que l'appelant croit effacer, sous sa forme de chaîne
   * (`RollbackPlan.stageKey`).
   *
   * Contrôle de concurrence optimiste : le plan est recalculé ici, sur une
   * lecture verrouillée, et peut donc désigner un **autre** stade que celui
   * montré à l'écran. Omis, le geste porte sur ce que la base dit au moment du
   * verrou.
   */
  expectedStage?: string;
};

/** Ce que le retour en arrière a défait, pour le message et le journal. */
export type RolledBackRound = {
  tournamentId: number;
  tournamentName: string;
  /** Stade défait, sous la forme échangée avec l'interface. */
  stageKey: string;
  /** Numéro affiché de la manche défaite (voir `RollbackPlan.roundNumber`). */
  roundNumber: number;
  /** Rang de la phase concernée (0 = tournoi sans phases). */
  phaseRank: number;
  /** Libellé complet, article compris : « la manche 4 », « le tour 2 des play-offs ». */
  label: string;
  /** Nombre de rencontres vidées de leur résultat. */
  clearedMatches: number;
  /** Le tournoi était terminé : il vient d'être rouvert. */
  reopenedTournament: boolean;
};

interface RollbackMatchRow extends RowDataPacket {
  id: number;
  bracket: BracketType;
  round_number: number;
  phase_id: number;
  phase_position: number | null;
  team1_id: number | null;
  team2_id: number | null;
  team1_score: number | null;
  team2_score: number | null;
  winner_team_id: number | null;
  forfeit_team_id: number | null;
  status: string;
  team1_reported_at: string | null;
  team2_reported_at: string | null;
  next_winner_match_id: number | null;
  next_loser_match_id: number | null;
}

/**
 * Le plateau, dans le vocabulaire du module pur.
 *
 * Les liens de plateau comptent, désormais : c'est d'eux que le module tire
 * l'ordre de déroulement d'une double élimination, où les numéros de manche des
 * deux tableaux ne se comparent pas.
 */
function toRollbackMatch(row: RollbackMatchRow): RollbackMatch {
  return {
    id: Number(row.id),
    bracket: row.bracket,
    roundNumber: Number(row.round_number),
    phaseId: Number(row.phase_id),
    phasePosition: row.phase_position === null ? null : Number(row.phase_position),
    team1Id: row.team1_id === null ? null : Number(row.team1_id),
    team2Id: row.team2_id === null ? null : Number(row.team2_id),
    team1Score: row.team1_score === null ? null : Number(row.team1_score),
    team2Score: row.team2_score === null ? null : Number(row.team2_score),
    winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
    forfeitTeamId: row.forfeit_team_id === null ? null : Number(row.forfeit_team_id),
    decided: row.status === "COMPLETED",
    hasPendingReport: row.team1_reported_at !== null || row.team2_reported_at !== null,
    nextWinnerMatchId: row.next_winner_match_id === null ? null : Number(row.next_winner_match_id),
    nextLoserMatchId: row.next_loser_match_id === null ? null : Number(row.next_loser_match_id),
  };
}

/**
 * Tout le plateau, phase comprise.
 *
 * La **position** de la phase est jointe plutôt que déduite de son identifiant :
 * c'est elle qui ordonne les phases entre elles, et c'est aussi elle que le
 * libellé annonce (« la manche 2 de la phase 3 »). Un match hors phase porte
 * `phase_id = 0`, que la jointure laisse à `NULL` — le module pur retombe alors
 * sur le rang 0, commun à tout le tournoi.
 */
async function loadRollbackMatches(
  connection: PoolConnection,
  tournamentId: number,
): Promise<RollbackMatch[]> {
  const [rows] = await connection.execute<RollbackMatchRow[]>(
    `SELECT m.id, m.bracket, m.round_number, m.phase_id, p.position AS phase_position,
            m.team1_id, m.team2_id, m.team1_score, m.team2_score,
            m.winner_team_id, m.forfeit_team_id, m.status,
            m.team1_reported_at, m.team2_reported_at,
            m.next_winner_match_id, m.next_loser_match_id
     FROM bg_matches m
     LEFT JOIN bg_tournament_phases p ON p.id = m.phase_id
     WHERE m.tournament_id = ?`,
    [tournamentId],
  );
  return rows.map(toRollbackMatch);
}

/**
 * Borne du nombre d'identifiants glissés dans un `IN (…)`.
 *
 * Une manche de tournoi à 256 engagés compte 128 rencontres, et le plan en
 * ajoute autant en aval : découper garde la requête lisible par le planificateur
 * et la taille du paquet sous contrôle.
 */
const ID_CHUNK = 200;

function chunk(ids: readonly number[]): number[][] {
  const chunks: number[][] = [];
  for (let from = 0; from < ids.length; from += ID_CHUNK) {
    chunks.push(ids.slice(from, from + ID_CHUNK));
  }
  return chunks;
}

/**
 * Ramène des rencontres à l'état « pas encore jouées ».
 *
 * Tout ce qui a été *saisi* part — scores, vainqueur, perdant, forfait, reports
 * en attente et leur délai. Tout ce qui a été *annoncé* reste : les engagées, la
 * date de début et la diffusion décrivent une rencontre qui va se rejouer entre
 * les mêmes équipes, à la même heure, sur la même chaîne.
 *
 * Le statut se recalcule sur les engagées plutôt que d'être remis à `READY` :
 * une rencontre à un seul camp (bye) doit retomber sur `PENDING`, faute de quoi
 * elle s'annoncerait jouable sans adversaire.
 */
async function clearMatchResults(
  connection: PoolConnection,
  matchIds: readonly number[],
): Promise<void> {
  for (const ids of chunk(matchIds)) {
    await connection.execute(
      `UPDATE bg_matches
       SET team1_score = NULL,
           team2_score = NULL,
           winner_team_id = NULL,
           loser_team_id = NULL,
           forfeit_team_id = NULL,
           team1_report_score = NULL,
           team1_report_opponent_score = NULL,
           team1_reported_at = NULL,
           team2_report_score = NULL,
           team2_report_opponent_score = NULL,
           team2_reported_at = NULL,
           score_deadline_at = NULL,
           status = CASE
             WHEN team1_id IS NOT NULL AND team2_id IS NOT NULL THEN 'READY'
             ELSE 'PENDING'
           END
       WHERE id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
  }
}

/**
 * Vide de leurs qualifiées les rencontres qui suivaient le stade défait.
 *
 * Réservé aux plateaux, dont la structure est créée au lancement : on ne peut
 * pas supprimer ces lignes sans détruire le tournoi, mais les laisser garnies
 * afficherait au tour suivant une équipe qui n'a plus rien gagné.
 *
 * Appelé **après** {@link clearMatchResults}, qui a déjà effacé leur résultat :
 * une rencontre en aval du stade défait n'a pas été jouée, mais elle peut avoir
 * été *résolue* — un bye posé par `tryAutoResolveByes`. Lui retirer ses engagées
 * en lui laissant son vainqueur donnerait une ligne qui annonce un gagnant sans
 * participante, et `isEliminationPhaseComplete` la compterait pour jouée.
 *
 * L'antenne est refermée pour la même raison que dans `pushTeamToTarget` : une
 * affiche qui perd ses deux camps n'est plus l'affiche qu'on diffusait.
 */
async function detachMatchParticipants(
  connection: PoolConnection,
  matchIds: readonly number[],
): Promise<void> {
  for (const ids of chunk(matchIds)) {
    await connection.execute(
      `UPDATE bg_matches
       SET team1_id = NULL,
           team2_id = NULL,
           status = 'PENDING',
           live_started_at = NULL
       WHERE id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
  }
}

/**
 * Re-remplit les créneaux détachés depuis les résultats qui subsistent.
 *
 * Le détachement est **volontairement large** — tout ce qui suit le stade défait
 * —, et il le faut : décider créneau par créneau demanderait de suivre les liens
 * de plateau à la main. Mais large veut dire qu'il vide aussi des créneaux que le
 * stade défait n'alimentait pas, et rien ne les reposerait : `pushTeamToTarget`
 * n'est appelé qu'à la **résolution** d'un match, jamais après coup.
 *
 * Le cas n'est pas de coin, il est ordinaire en double élimination, où un match
 * peut être alimenté par un match situé deux stades plus haut. Sur un plateau à
 * huit, la finale du tableau principal se joue *après* le deuxième tour de
 * repêchage : défaire ce tour la détachait, et ses deux engagées — venues du
 * deuxième tour du tableau principal, joué et non effacé — disparaissaient sans
 * retour. La grande finale perdait de même son finaliste du tableau principal
 * chaque fois qu'on défaisait le dernier tour de repêchage.
 *
 * D'où ce passage, qui est au plateau ce que le rejeu est aux modes à classement
 * : on ne cherche pas à écrire juste du premier coup, on **relit** ce qui reste.
 * Toute rencontre encore tranchée dont la cible vient d'être détachée y repose
 * son vainqueur et son perdant. Les byes qui en naissent seront résolus par
 * `tryAutoResolveByes`, juste après, comme après n'importe quelle correction.
 */
async function repopulateDetachedMatches(
  connection: PoolConnection,
  tournamentId: number,
  matchIds: readonly number[],
): Promise<void> {
  const { pushTeamToTarget } = await import("./scoring");

  for (const ids of chunk(matchIds)) {
    const placeholders = ids.map(() => "?").join(", ");
    const [feeders] = await connection.execute<
      (RowDataPacket & {
        winner_team_id: number | null;
        loser_team_id: number | null;
        next_winner_match_id: number | null;
        next_winner_slot: number | null;
        next_loser_match_id: number | null;
        next_loser_slot: number | null;
      })[]
    >(
      `SELECT winner_team_id, loser_team_id,
              next_winner_match_id, next_winner_slot,
              next_loser_match_id, next_loser_slot
       FROM bg_matches
       WHERE tournament_id = ?
         AND (winner_team_id IS NOT NULL OR loser_team_id IS NOT NULL)
         AND (next_winner_match_id IN (${placeholders})
              OR next_loser_match_id IN (${placeholders}))
       ORDER BY round_number ASC, match_number ASC`,
      [tournamentId, ...ids, ...ids],
    );

    const detached = new Set(ids);
    for (const feeder of feeders) {
      const winnerTarget =
        feeder.next_winner_match_id === null ? null : Number(feeder.next_winner_match_id);
      if (winnerTarget !== null && detached.has(winnerTarget)) {
        await pushTeamToTarget(
          connection,
          winnerTarget,
          feeder.next_winner_slot === null ? null : Number(feeder.next_winner_slot),
          feeder.winner_team_id === null ? null : Number(feeder.winner_team_id),
        );
      }

      const loserTarget =
        feeder.next_loser_match_id === null ? null : Number(feeder.next_loser_match_id);
      if (loserTarget !== null && detached.has(loserTarget)) {
        await pushTeamToTarget(
          connection,
          loserTarget,
          feeder.next_loser_slot === null ? null : Number(feeder.next_loser_slot),
          feeder.loser_team_id === null ? null : Number(feeder.loser_team_id),
        );
      }
    }
  }
}

/**
 * Supprime les manches que le moteur reposera.
 *
 * Elles n'ont plus d'objet : leurs appariements ont été tirés d'un classement
 * que le retour en arrière vient de défaire — ou, pour une phase ultérieure,
 * d'une liste de qualifiées qu'il vient d'annuler.
 *
 * Les tables qui pendent à une manche partent avec elle, écrites à la main
 * plutôt que laissées aux cascades — même raison que la suppression d'un tournoi
 * (`./deletion.ts`) : les contraintes ne sont posées qu'à la création des tables,
 * et une base installée plus tôt ne les a jamais gagnées.
 */
async function deleteMatches(
  connection: PoolConnection,
  matchIds: readonly number[],
): Promise<void> {
  for (const ids of chunk(matchIds)) {
    const placeholders = ids.map(() => "?").join(", ");
    await connection.execute(
      `DELETE FROM bg_match_reminders WHERE match_id IN (${placeholders})`,
      ids,
    );
    // Sous `try` comme dans `./deletion.ts` : la création de cette table est
    // avalée par un `catch` dans `database.ts`, et une base à qui elle manque
    // rendrait sinon tout retour en arrière impossible — pour une table de
    // notifications, où il n'y aurait de toute façon rien à effacer.
    try {
      await connection.execute(
        `DELETE FROM bg_referee_alerts WHERE match_id IN (${placeholders})`,
        ids,
      );
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
    await connection.execute(`DELETE FROM bg_matches WHERE id IN (${placeholders})`, ids);
  }
}

/** Phase d'un tournoi multi-phases, réduite à ce que ce module en fait. */
type RollbackPhase = { id: number; position: number; format: PhaseFormat };

/**
 * Colonne où chaque format à classement retient **la manche où il en est**,
 * quand il est joué comme un tournoi entier.
 *
 * Le nombre n'est pas dérivé des matchs : `generateSwissRound` et ses jumelles
 * posent la manche « compteur + 1 » puis incrémentent. Un retour en arrière qui
 * n'y touche pas laisse donc le moteur reprendre *après* les manches qu'on vient
 * d'effacer — cela s'est vu en conditions réelles : défaire la manche 1 d'une
 * ronde suisse à huit y créait une « ronde 3 » pendant que la 1 restait vierge.
 *
 * Les formats à plateau n'y figurent pas : leur plateau naît entier, ils n'ont
 * pas de curseur.
 */
const TOURNAMENT_ROUND_CURSOR: Partial<Record<TournamentFormat, string>> = {
  SWISS: "swiss_current_round",
  SURVIVAL: "survival_current_round",
  BG_SURVIE: "endurance_current_round",
};

/**
 * La même chose pour une **phase**, qui tient son curseur sur sa propre ligne.
 *
 * La BlueGenji Survie n'est pas un format de phase (`PhaseFormat`), elle n'a donc
 * rien à faire ici.
 */
const PHASE_ROUND_CURSOR: Partial<Record<PhaseFormat, string>> = {
  SWISS: "swiss_current_round",
  SURVIVAL: "survival_current_round",
};

/**
 * Ramène le curseur de manche sur le stade défait.
 *
 * La manche existe toujours — vidée, pas supprimée : le moteur la retrouve donc
 * incomplète et la réapparie si le rejeu l'a rendue caduque, exactement comme
 * après une correction de score.
 *
 * Rien à faire sur un plateau (aucune colonne ne lui correspond) ni sur un tour
 * de l'arbre final d'une BlueGenji Survie : le curseur ne compte que les manches
 * **qualificatives**, et le ramener à 1002 ferait repartir la qualification mille
 * manches plus loin.
 */
async function rewindRoundCursor(
  connection: PoolConnection,
  tournamentId: number,
  format: TournamentFormat,
  plan: RollbackPlan,
  phases: readonly RollbackPhase[],
): Promise<void> {
  if (plan.playoffRound) return;

  if (plan.stage.phaseRank > 0) {
    const phase = phases.find((candidate) => candidate.position === plan.stage.phaseRank);
    const column = phase === undefined ? undefined : PHASE_ROUND_CURSOR[phase.format];
    if (phase === undefined || column === undefined) return;

    await connection.execute(`UPDATE bg_tournament_phases SET ${column} = ? WHERE id = ?`, [
      plan.roundNumber,
      phase.id,
    ]);
    return;
  }

  const column = TOURNAMENT_ROUND_CURSOR[format];
  if (column === undefined) return;

  await connection.execute(`UPDATE bg_tournaments SET ${column} = ? WHERE id = ?`, [
    plan.roundNumber,
    tournamentId,
  ]);
}

/**
 * Referme la phase éliminatoire d'une BlueGenji Survie qui n'a plus d'arbre.
 *
 * Le drapeau est le seul état que `reconcileEndurance` consulte pour savoir s'il
 * doit relire un arbre ou apparier une manche. Défaire le **premier** tour de
 * l'arbre n'y touche pas — le tour reste posé, simplement vierge —, mais le pas
 * suivant, qui vise la dernière manche qualificative, supprime l'arbre entier :
 * le laisser levé ferait alors relire un arbre qui n'existe plus.
 *
 * Le drapeau est **relu sur ce qui reste** plutôt que déduit du plan : c'est la
 * seule lecture qui ne puisse pas se tromper, et elle rattrape aussi un arbre
 * effacé par un autre chemin.
 */
async function rewindEndurancePlayoffs(
  connection: PoolConnection,
  tournamentId: number,
  format: TournamentFormat,
): Promise<void> {
  if (format !== "BG_SURVIE") return;

  const [rows] = await connection.execute<(RowDataPacket & { remaining: number })[]>(
    `SELECT COUNT(*) AS remaining FROM bg_matches
     WHERE tournament_id = ? AND round_number >= ?`,
    [tournamentId, PLAYOFF_ROUND_OFFSET],
  );
  if (Number(rows[0]?.remaining ?? 0) > 0) return;

  await connection.execute(`UPDATE bg_tournaments SET endurance_playoffs_started = 0 WHERE id = ?`, [
    tournamentId,
  ]);
}

/**
 * Rouvre la phase visée et remet à zéro celles qui la suivaient.
 *
 * C'est le seul endroit du projet qui fasse **reculer** un tournoi multi-phases,
 * et il faut bien le faire ici : `reconcilePhases` ne sait qu'avancer — il relit
 * un classement, clôt une phase, en lance une autre, jamais l'inverse.
 *
 * Une phase ultérieure retourne à `PENDING` avec ses compteurs, et surtout **son
 * plateau d'engagées est effacé** : `insertPhaseTeams` étant un upsert, une
 * ancienne liste de qualifiées survivrait à la nouvelle et la phase repartirait
 * avec des équipes que plus rien ne qualifie. Les classements que ses moteurs
 * tiennent (`bg_swiss_standings`, `bg_survival_standings`) partent pour la même
 * raison : leurs initialisations sont des upserts, elles ne suppriment pas une
 * ligne devenue orpheline.
 *
 * La phase visée, elle, redevient celle qu'on joue, et perd ses rangs et ses
 * qualifications — ils seront réécrits quand elle s'achèvera de nouveau, et les
 * laisser afficherait des qualifiées que plus rien ne désigne.
 */
async function reopenPhases(
  connection: PoolConnection,
  tournamentId: number,
  plan: RollbackPlan,
  phases: readonly RollbackPhase[],
): Promise<void> {
  const target = phases.find((phase) => phase.position === plan.stage.phaseRank);
  if (target === undefined) return;

  const later = phases.filter((phase) => phase.position > target.position);
  if (later.length > 0) {
    const ids = later.map((phase) => phase.id);
    const placeholders = ids.map(() => "?").join(", ");

    await connection.execute(
      `DELETE FROM bg_tournament_phase_teams WHERE phase_id IN (${placeholders})`,
      ids,
    );
    await connection.execute(
      `DELETE FROM bg_swiss_standings WHERE tournament_id = ? AND phase_id IN (${placeholders})`,
      [tournamentId, ...ids],
    );
    await connection.execute(
      `DELETE FROM bg_survival_standings WHERE tournament_id = ? AND phase_id IN (${placeholders})`,
      [tournamentId, ...ids],
    );
    await connection.execute(
      `UPDATE bg_tournament_phases
       SET state = 'PENDING',
           started_at = NULL,
           finished_at = NULL,
           bracket_size = NULL,
           swiss_current_round = 0,
           survival_current_round = 0,
           survival_barrage_rounds = 0
       WHERE id IN (${placeholders})`,
      ids,
    );
  }

  await connection.execute(
    `UPDATE bg_tournament_phases SET state = 'RUNNING', finished_at = NULL WHERE id = ?`,
    [target.id],
  );
  await connection.execute(
    "UPDATE bg_tournament_phase_teams SET `rank` = NULL, qualified = 0 WHERE phase_id = ?",
    [target.id],
  );
  await connection.execute(`UPDATE bg_tournaments SET current_phase_id = ? WHERE id = ?`, [
    target.id,
    tournamentId,
  ]);
}

/**
 * Rouvre un tournoi terminé.
 *
 * `finishTournament` est écrit pour ne clore qu'une fois (`state <> 'FINISHED'`) :
 * remettre l'état et effacer la date de clôture suffisent à lui rendre son effet,
 * et le tournoi sera reclos — avec sa ligne de journal et sa nouvelle championne
 * — dès que le stade rouvert aura été rejoué.
 *
 * Le classement final part avec : il désignait une championne que plus aucun
 * match ne désigne. Chaque mode réécrira le sien à la clôture suivante.
 */
async function reopenTournament(connection: PoolConnection, tournamentId: number): Promise<void> {
  await connection.execute(
    `UPDATE bg_tournaments SET state = 'RUNNING', finished_at = NULL WHERE id = ?`,
    [tournamentId],
  );
  await resetRegistrationRanks(connection, tournamentId);
}

/** Applique le plan : le stade est vidé, ce qui le suivait est traité. */
async function applyRollback(
  connection: PoolConnection,
  tournamentId: number,
  format: TournamentFormat,
  plan: RollbackPlan,
  phases: readonly RollbackPhase[],
): Promise<void> {
  // Les détachés sont vidés de leur résultat au même titre que le stade défait :
  // ils n'ont pas été joués, mais le moteur a pu en *résoudre* certains (byes).
  await clearMatchResults(connection, [...plan.clearedMatchIds, ...plan.detachedMatchIds]);

  if (plan.detachedMatchIds.length > 0) {
    await detachMatchParticipants(connection, plan.detachedMatchIds);
    await repopulateDetachedMatches(connection, tournamentId, plan.detachedMatchIds);
  }
  if (plan.deletedMatchIds.length > 0) {
    await deleteMatches(connection, plan.deletedMatchIds);
  }

  await rewindRoundCursor(connection, tournamentId, format, plan, phases);
  await rewindEndurancePlayoffs(connection, tournamentId, format);
  await reopenPhases(connection, tournamentId, plan, phases);
}

/**
 * Rejoue le tournoi sur son nouvel historique.
 *
 * Exactement la chaîne d'une correction de score (`adminSaveMatchScoresPublic`),
 * `reconcilePhases` en plus, et c'est le but : le retour en arrière n'est qu'une
 * correction de plus, en gros. Chaque réconciliation sort d'elle-même si le
 * format ne la concerne pas.
 */
async function reconcileAfterRollback(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  // Les byes du stade vidé ont perdu leur 1-0 : le moteur les repose. En
  // multi-phases, ceux de la phase courante sont l'affaire de `reconcilePhases`,
  // qui les résout dans le bon périmètre.
  await tryAutoResolveByes(connection, tournamentId);

  const { reconcileSurvival } = await import("./survival");
  await reconcileSurvival(tournamentId, connection);
  const { reconcileSwiss } = await import("./swiss");
  await reconcileSwiss(tournamentId, connection);
  const { reconcileEndurance } = await import("./bg-survie");
  await reconcileEndurance(tournamentId, connection);
  const { reconcilePhases } = await import("./phases");
  await reconcilePhases(tournamentId, connection);
}

/**
 * Défait le dernier stade joué du tournoi.
 *
 * Le geste est **répétable** : chaque appel recule d'un stade, du dernier joué
 * jusqu'au premier, et le tournoi finit par se retrouver à l'instant de son coup
 * d'envoi (`ROLLBACK_NOTHING_TO_UNDO`).
 *
 * @param tournamentId Tournoi concerné.
 * @param options `expectedStage` — le stade que l'appelant croit effacer. Voir
 *   {@link RollbackOptions}.
 * @returns Ce qui a été défait, pour la confirmation et le journal.
 * @throws `TOURNAMENT_NOT_FOUND` — identifiant inconnu.
 * @throws `ROLLBACK_TOURNAMENT_NOT_STARTED` — tournoi pas encore lancé.
 * @throws `ROLLBACK_ROUND_CHANGED` — le stade courant a bougé depuis l'écran.
 * @throws `ROLLBACK_NOTHING_TO_UNDO` — plus aucune saisie sur le plateau.
 */
export async function rollbackCurrentRound(
  tournamentId: number,
  options?: RollbackOptions,
): Promise<RolledBackRound> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Verrou en toute première instruction, avant toute lecture ordinaire : sous
    // `REPEATABLE READ`, c'est la première lecture non verrouillante qui fige
    // l'instantané, et le plateau lu ensuite serait celui d'avant l'attente —
    // même précaution que l'inscription en lot des équipes fantômes.
    const [rows] = await connection.execute<
      (RowDataPacket & { id: number; name: string; format: TournamentFormat })[]
    >(`SELECT id, name, format FROM bg_tournaments WHERE id = ? FOR UPDATE`, [tournamentId]);
    if (rows.length === 0) throw new Error("TOURNAMENT_NOT_FOUND");
    const tournament = rows[0];

    // L'entretien d'abord : un tournoi dont l'heure de coup d'envoi est passée
    // doit être jugé sur son état réel, pas sur celui que la base traîne.
    const { row: synced } = await syncTournamentState(connection, tournamentId);
    if (!synced) throw new Error("TOURNAMENT_NOT_FOUND");

    // Un tournoi **terminé** se défait : c'est même le cas qui manquait le plus,
    // l'erreur de finale étant la seule que `match-lock` ne laisse plus corriger.
    // Un tournoi qui n'a jamais commencé, lui, n'a rien à défaire.
    const finished = synced.state === "FINISHED";
    if (synced.state !== "RUNNING" && !finished) {
      throw new Error("ROLLBACK_TOURNAMENT_NOT_STARTED");
    }

    const phases: RollbackPhase[] =
      tournament.format === "MULTI"
        ? (await loadPhases(connection, tournamentId)).map((phase) => ({
            id: Number(phase.id),
            position: Number(phase.position),
            format: phase.format as PhaseFormat,
          }))
        : [];

    const plan = planRoundRollback(await loadRollbackMatches(connection, tournamentId));
    if (typeof plan === "string") throw new Error(plan);

    // Le stade courant a-t-il bougé depuis l'écran qui a demandé le geste ? Le
    // dialogue **montre** les rencontres qu'il va effacer, et c'est là toute la
    // sauvegarde que l'arbitre aura : si un second arbitre saisit un score sur la
    // manche suivante entre l'ouverture et le clic, le plan recalculé ici viserait
    // des scores que personne n'a vus. On refuse plutôt que d'effacer à l'aveugle
    // — l'écran se rafraîchit par le flux, et le geste se redemande.
    if (options?.expectedStage !== undefined && options.expectedStage !== plan.stageKey) {
      throw new Error("ROLLBACK_ROUND_CHANGED");
    }

    // Rouvrir **avant** d'écrire : la réconciliation qui suit lit l'état du
    // tournoi pour décider ce qu'elle a le droit de reposer, et un tournoi resté
    // « terminé » se contenterait d'y réécrire un palmarès.
    if (finished) await reopenTournament(connection, tournamentId);

    await applyRollback(connection, tournamentId, tournament.format, plan, phases);
    await reconcileAfterRollback(connection, tournamentId);

    await connection.commit();

    // Le journal part après le commit, comme partout : rien n'est annoncé qui ne
    // soit écrit. La réconciliation ci-dessus a pu mettre en file ses propres
    // lignes (un bye reposé, par exemple).
    flushBotLogs(connection);

    // Le plateau vient de changer pour tout le monde. Un seul appel : c'est lui
    // qui vide l'instantané, l'aperçu, les listes, les agrégats de l'accueil et le
    // classement du site, puis réveille la salle du flux. Rejouter une
    // invalidation ici donnerait à croire que ce module a une règle de cache à
    // lui, et une règle ajoutée dans `./notifications` serait contredite en
    // silence.
    publishUpdatedEvent(tournamentId);

    return {
      tournamentId: Number(tournament.id),
      tournamentName: tournament.name,
      stageKey: plan.stageKey,
      roundNumber: plan.roundNumber,
      phaseRank: plan.stage.phaseRank,
      label: rollbackStageLabelWithArticle(plan),
      clearedMatches: plan.clearedMatchIds.length,
      reopenedTournament: finished,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}
