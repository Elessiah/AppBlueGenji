import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { MIN_ENTRANTS_FOR_MATCHES, SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { queueBotLog, queueRefereeAlert } from "./bot-logs";
import {
  loadTournamentMatchFormat,
  resetRegistrationRanks,
  finishTournament,
} from "./repository";
import { matchWinnerSide, type MatchFormat } from "@/lib/shared/match-format";
import { appendSequentialRanks, podiumRanks, type PodiumMatch } from "@/lib/shared/double-forfeit";

export async function isEliminationPhaseComplete(
  connection: PoolConnection,
  tournamentId: number,
  phaseId: number,
): Promise<boolean> {
  const [matchCount] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches WHERE tournament_id = ? AND phase_id = ?`,
    [tournamentId, phaseId],
  );

  if (Number(matchCount[0]?.c ?? 0) === 0) {
    return false;
  }

  const [unfinished] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c
     FROM bg_matches
     WHERE tournament_id = ? AND phase_id = ?
       AND winner_team_id IS NULL
       AND NOT (status = 'COMPLETED' AND double_forfeit = 1)
       AND (team1_id IS NOT NULL OR team2_id IS NOT NULL)`,
    [tournamentId, phaseId],
  );

  // Un double forfait est tranché sans vainqueur : sans l'exception ci-dessus,
  // la rencontre resterait « à jouer » pour toujours, et le plateau avec elle —
  // c'est la fin des matchs qui clôt un tableau.
  return Number(unfinished[0]?.c ?? 0) === 0;
}

/** Un rang de phase à élimination. */
export type EliminationRank = {
  teamId: number;
  /** Rang final ; deux équipes peuvent le partager (double forfait au podium). */
  rank: number;
  /**
   * L'équipe a été sortie par un **double forfait** : elle a perdu sans que
   * personne ne gagne. Une phase intermédiaire ne la qualifie jamais, même si
   * son rang tombe dans la cible — elle est éliminée comme n'importe quelle
   * perdante, et la place laissée vide ne se repêche pas.
   */
  eliminatedByDoubleForfeit: boolean;
};

type PodiumRow = RowDataPacket & {
  team1_id: number | null;
  team2_id: number | null;
  winner_team_id: number | null;
  loser_team_id: number | null;
  status: string;
  double_forfeit: number | null;
};

function toPodiumMatch(row: PodiumRow | undefined): PodiumMatch | null {
  if (!row) return null;
  return {
    team1Id: row.team1_id === null ? null : Number(row.team1_id),
    team2Id: row.team2_id === null ? null : Number(row.team2_id),
    winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
    loserTeamId: row.loser_team_id === null ? null : Number(row.loser_team_id),
    doubleForfeit: row.status === "COMPLETED" && Number(row.double_forfeit ?? 0) === 1,
  };
}

const PODIUM_COLUMNS = `team1_id, team2_id, winner_team_id, loser_team_id, status, double_forfeit`;

export async function rankEliminationPhase(
  connection: PoolConnection,
  tournamentId: number,
  phaseId: number,
  format: "SINGLE" | "DOUBLE",
  hasThirdPlaceMatch: boolean,
): Promise<EliminationRank[]> {
  const podiumMatches: (PodiumMatch | null)[] = [];

  if (format === "DOUBLE") {
    const [grandFinalRows] = await connection.execute<PodiumRow[]>(
      `SELECT ${PODIUM_COLUMNS}
       FROM bg_matches
       WHERE tournament_id = ? AND phase_id = ? AND bracket = 'GRAND' AND round_number = 1`,
      [tournamentId, phaseId],
    );
    podiumMatches.push(toPodiumMatch(grandFinalRows[0]));
  } else {
    const [upperFinalRows] = await connection.execute<PodiumRow[]>(
      `SELECT ${PODIUM_COLUMNS}
       FROM bg_matches
       WHERE tournament_id = ? AND phase_id = ? AND bracket = 'UPPER'
       ORDER BY round_number DESC
       LIMIT 1`,
      [tournamentId, phaseId],
    );
    podiumMatches.push(toPodiumMatch(upperFinalRows[0]));

    if (hasThirdPlaceMatch) {
      const [thirdPlaceRows] = await connection.execute<PodiumRow[]>(
        `SELECT ${PODIUM_COLUMNS}
         FROM bg_matches
         WHERE tournament_id = ? AND phase_id = ? AND bracket = 'THIRD_PLACE'
         LIMIT 1`,
        [tournamentId, phaseId],
      );
      podiumMatches.push(toPodiumMatch(thirdPlaceRows[0]));
    }
  }

  // Qui a été sorti par un double forfait : les deux finalistes d'une finale
  // non jouée comme les deux engagées d'un tour intermédiaire.
  const [forfeitedRows] = await connection.execute<(RowDataPacket & { team_id: number })[]>(
    `SELECT team1_id AS team_id FROM bg_matches
     WHERE tournament_id = ? AND phase_id = ? AND status = 'COMPLETED' AND double_forfeit = 1
       AND team1_id IS NOT NULL
     UNION
     SELECT team2_id AS team_id FROM bg_matches
     WHERE tournament_id = ? AND phase_id = ? AND status = 'COMPLETED' AND double_forfeit = 1
       AND team2_id IS NOT NULL`,
    [tournamentId, phaseId, tournamentId, phaseId],
  );
  const forfeited = new Set(forfeitedRows.map((row) => Number(row.team_id)));

  // Une finale close sur un double forfait ne fait pas de championne : ses deux
  // engagées partagent la 2ᵉ place (`podiumRanks`, règle partagée avec l'arbre
  // final d'une BlueGenji Survie). Une finale gagnée par exemption ne laisse
  // sa 2ᵉ place vacante que si le tableau porte un double forfait : sinon
  // l'exemption est structurelle (la « finale » d'une phase tronquée peut en
  // être une), et la numérotation reste celle d'avant.
  const podium = podiumRanks(podiumMatches, { byeLeavesVacancy: forfeited.size > 0 });
  const placed = podium.entries.map((entry) => entry.teamId);

  // Le reste du tableau, par victoires puis défaites. Un double forfait est une
  // défaite pour **chacune** de ses deux engagées — aucune ne figure dans
  // `loser_team_id`, faute d'une gagnante à lui opposer.
  const involved = `(m.team1_id = r.team_id OR m.team2_id = r.team_id)`;
  const doubleForfeited = `(m.status = 'COMPLETED' AND m.double_forfeit = 1 AND ${involved})`;
  const exclusion =
    placed.length > 0 ? `AND r.team_id NOT IN (${placed.map(() => "?").join(",")})` : "";
  const [rankingRows] = await connection.execute<
    (RowDataPacket & {
      team_id: number;
      wins: number;
      losses: number;
      last_progress_at: Date | null;
    })[]
  >(
    `SELECT
      r.team_id,
      COALESCE(SUM(CASE WHEN m.winner_team_id = r.team_id THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE
        WHEN m.loser_team_id = r.team_id OR ${doubleForfeited} THEN 1 ELSE 0
      END), 0) AS losses,
      MAX(CASE
        WHEN m.winner_team_id = r.team_id OR m.loser_team_id = r.team_id OR ${doubleForfeited}
          THEN m.updated_at
        ELSE NULL
      END) AS last_progress_at
     FROM bg_tournament_registrations r
     LEFT JOIN bg_matches m ON m.tournament_id = r.tournament_id AND m.phase_id = ?
     WHERE r.tournament_id = ? ${exclusion}
     GROUP BY r.team_id
     ORDER BY wins DESC, losses ASC, last_progress_at DESC`,
    [phaseId, tournamentId, ...placed],
  );

  // Le reste est rangé même sans podium — une finale fantôme (deux doubles
  // forfaits en demi-finale) ne désigne personne, et le plateau se range alors
  // tout entier sur son bilan. La garde d'avant (aucun podium → aucun rang)
  // n'existait que pour éviter une liste `NOT IN` vide.
  const rest = rankingRows.map((row) => Number(row.team_id));

  return appendSequentialRanks(podium, rest).map((entry) => ({
    ...entry,
    eliminatedByDoubleForfeit: forfeited.has(entry.teamId),
  }));
}

/**
 * Clôt sans jouer un tournoi qui atteint son coup d'envoi sans adversaires.
 *
 * Un plateau vide ou réduit à une seule engagée n'a aucun match à produire : le
 * laisser passer en `RUNNING` l'y bloquerait pour de bon, puisque c'est
 * justement la fin des matchs qui clôt un tournoi. La règle est **commune à
 * tous les formats** et appliquée avant toute initialisation, si bien qu'aucun
 * moteur (plateau, Survie, Ronde suisse, Endurance, phases) n'a besoin de
 * connaître ce cas dégénéré ni de créer un classement pour personne.
 *
 * L'unique engagée, s'il y en a une, est déclarée première — c'est déjà ce que
 * faisait l'élimination dans `createBracketIfMissing`.
 *
 * Une inscription n'est jamais retirée en cours de route : un tournoi qui en
 * compte moins de deux n'a donc pas pu commencer, ce qui rend l'appel sûr aussi
 * bien à la bascule qu'à l'entretien d'un tournoi déjà `RUNNING`.
 *
 * @returns `true` si le tournoi a été clos, `false` s'il a de quoi être joué.
 */
export async function finalizeUnderfilledTournament(
  connection: PoolConnection,
  tournamentId: number,
): Promise<boolean> {
  // Le `LIMIT` s'arrête au seuil : seule la distinction « moins de deux » nous
  // intéresse, jamais l'effectif exact d'un plateau à 128. Le nombre vient de
  // `MIN_ENTRANTS_FOR_MATCHES` (`lib/shared/constants.ts`), partagé avec la
  // confirmation du lancement anticipé, qui annonce cette clôture avant le clic
  // — écrit deux fois, il aurait fini par se contredire. C'est une constante du
  // module, jamais une entrée : rien d'externe n'atteint cette interpolation.
  const [rows] = await connection.execute<(RowDataPacket & { team_id: number })[]>(
    `SELECT team_id FROM bg_tournament_registrations
     WHERE tournament_id = ? LIMIT ${MIN_ENTRANTS_FOR_MATCHES}`,
    [tournamentId],
  );

  if (rows.length >= MIN_ENTRANTS_FOR_MATCHES) return false;

  if (rows.length === 1) {
    await connection.execute(
      `UPDATE bg_tournament_registrations
       SET final_rank = 1
       WHERE tournament_id = ? AND team_id = ?`,
      [tournamentId, Number(rows[0].team_id)],
    );
  }

  // `bracket_size` reçoit l'effectif retenu : même écriture, mêmes colonnes que
  // la clôture d'un plateau vide dans `createBracketIfMissing`, pour qu'un
  // tournoi clos porte toujours la taille de son plateau plutôt qu'un NULL.
  await connection.execute(
    `UPDATE bg_tournaments
     SET state = 'FINISHED', finished_at = NOW(), bracket_size = ?
     WHERE id = ?`,
    [rows.length, tournamentId],
  );

  // Un tournoi qui se clôt sans avoir joué est un incident d'organisation : il
  // mérite sa ligne, et une ligne à lui — la clôture ordinaire annonce une
  // championne, celle-ci annonce une salle vide.
  queueBotLog(connection, { kind: "tournament_underfilled", tournamentId });

  return true;
}

export async function finalizeTournamentIfDone(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  // Les modes à classement (Survie, Ronde suisse) pilotent eux-mêmes leur
  // clôture et leur classement final via `reconcileSurvival` / `reconcileSwiss`
  // — ne pas les finaliser ici, sinon le classement générique par victoires
  // écraserait le résultat. En suisse, une ronde terminée ne clôt d'ailleurs
  // rien tant que le compte de rondes prévues n'est pas atteint.
  // Le mode MULTI est, lui, orchestré par `reconcilePhases` : c'est la phase
  // finale qui décide de la clôture et du classement global. « BlueGenji
  // Survie » suit la même règle via `reconcileEndurance` / `finalizeEndurance` :
  // sans cette garde, un instant où tous les matchs sont terminés (entre deux
  // manches) suffirait à clore le tournoi et à écraser le podium d'endurance.
  const [formatRows] = await connection.execute<(RowDataPacket & { format: string })[]>(
    `SELECT format FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  const format = formatRows[0]?.format;
  if (
    format === "SURVIVAL" ||
    format === "SWISS" ||
    format === "MULTI" ||
    format === "BG_SURVIE"
  ) {
    return;
  }

  const phaseId = 0;
  const isComplete = await isEliminationPhaseComplete(connection, tournamentId, phaseId);

  if (!isComplete) {
    return;
  }

  await finishTournament(connection, tournamentId);
  await resetRegistrationRanks(connection, tournamentId);

  const [tournamentMetaRows] = await connection.execute<
    (RowDataPacket & { format: string; has_third_place_match: number })[]
  >(`SELECT format, has_third_place_match FROM bg_tournaments WHERE id = ? LIMIT 1`, [
    tournamentId,
  ]);
  const tournamentMeta = tournamentMetaRows[0];

  const rankedTeams = await rankEliminationPhase(
    connection,
    tournamentId,
    phaseId,
    (tournamentMeta?.format === "DOUBLE" ? "DOUBLE" : "SINGLE") as "SINGLE" | "DOUBLE",
    Boolean(tournamentMeta?.has_third_place_match),
  );

  for (const { teamId, rank } of rankedTeams) {
    await connection.execute(
      `UPDATE bg_tournament_registrations
       SET final_rank = ?
       WHERE tournament_id = ? AND team_id = ?`,
      [rank, tournamentId, teamId],
    );
  }
}

/**
 * Tranche les reports de score dont le délai a expiré, et **alerte l'arbitre**
 * sur ceux qu'aucune règle ne peut trancher.
 *
 * Le délai n'a d'effet que sur une manche à **un seul** report : il vaut alors
 * accord tacite de l'adversaire silencieux, et le moteur clôt la rencontre. Sur
 * une manche où les **deux** engagées ont reporté des scores contradictoires, il
 * ne peut rien — départager deux affirmations opposées n'est pas une règle,
 * c'est une décision. Ces manches restent donc `AWAITING_CONFIRMATION`
 * indéfiniment, et sont exactement celles qui attendent un humain.
 *
 * D'où une alerte, distincte de celle du conflit lui-même : la première part au
 * moment du désaccord, celle-ci constate qu'un délai de report plus tard —
 * `SCORE_REPORT_TIMEOUT_MINUTES`, la seule source — personne n'a tranché.
 * `claimRefereeAlert` la réserve dans la transaction en cours pour qu'elle ne
 * parte qu'une fois : la fonction, elle, est appelée à chaque entretien.
 *
 * L'escalade attend **un délai de plus** après `score_deadline_at`. Cette
 * colonne est posée au premier report et jamais réécrite tant que la manche
 * n'est pas tranchée (`COALESCE`) : elle ne peut donc pas être repoussée par
 * une engagée qui resaisirait son score en boucle, contrairement aux
 * horodatages de report.
 *
 * Le doublon avec l'alerte de conflit — les deux évènements peuvent naître dans
 * la même transaction — n'est pas écarté ici : cette fonction est appelée
 * **deux fois** par report de score, une fois avant la mise en file du conflit
 * et une fois après, et une garde posée à la réservation ne verrait donc qu'un
 * des deux ordres. C'est `flushBotLogs` qui tranche, sur la file entière.
 */
/**
 * Les deux identifiants d'un résultat, depuis les scores et le format.
 *
 * `null` des deux côtés sur un match nul : `finalizeMatch` écrit alors deux
 * colonnes vides et ne propage rien, ce qui est exactement ce qu'un nul veut
 * dire — personne ne monte, personne ne tombe.
 */
function resolveSides(
  match: { team1_id: number | null; team2_id: number | null },
  format: MatchFormat | null,
  team1Score: number,
  team2Score: number,
): { winnerTeamId: number | null; loserTeamId: number | null } {
  const side = matchWinnerSide(format, team1Score, team2Score);
  if (side === null) return { winnerTeamId: null, loserTeamId: null };

  return side === 1
    ? { winnerTeamId: Number(match.team1_id), loserTeamId: Number(match.team2_id) }
    : { winnerTeamId: Number(match.team2_id), loserTeamId: Number(match.team1_id) };
}

/**
 * Tranche les reports de score dont le délai a expiré.
 *
 * Renvoie le **nombre de manches réellement closes** — et non `void` : c'est la
 * seule information qui distingue un balayage sans effet d'un balayage qui vient
 * d'écrire un résultat, et l'appelant en a besoin. Les modes à classement
 * (Survie, Ronde suisse, BlueGenji Survie) et le multi-phases ne posent leur
 * manche suivante qu'en réconciliant ; sans ce compte, l'entretien passif ne
 * saurait pas qu'il doit les rappeler, et une manche close par le délai — la
 * dernière de sa ronde — laisserait le tournoi sans suite (voir
 * `./state.ts`).
 *
 * Un désaccord entre les deux engagés ne compte pas : il n'est pas tranché, il
 * est escaladé à l'arbitrage.
 */
export async function resolveExpiredScoreReports(
  connection: PoolConnection,
  tournamentId: number,
): Promise<number> {
  const [rows] = await connection.execute<ExpiredMatchRow[]>(
    `SELECT
      id,
      tournament_id,
      team1_id,
      team2_id,
      team1_report_score,
      team1_report_opponent_score,
      team2_report_score,
      team2_report_opponent_score,
      next_winner_match_id,
      next_winner_slot,
      next_loser_match_id,
      next_loser_slot,
      round_number,
      (score_deadline_at <= DATE_SUB(NOW(), INTERVAL ? MINUTE)) AS conflict_stalled
     FROM bg_matches
     WHERE tournament_id = ?
       AND status = 'AWAITING_CONFIRMATION'
       AND score_deadline_at IS NOT NULL
       AND score_deadline_at <= NOW()
       AND winner_team_id IS NULL`,
    [SCORE_REPORT_TIMEOUT_MINUTES, tournamentId],
  );

  // Import at runtime to avoid circular deps
  const { finalizeMatch } = await import("./scoring");

  let resolved = 0;

  for (const match of rows) {
    if (match.team1_id === null || match.team2_id === null) {
      continue;
    }

    const team1Reported =
      match.team1_report_score !== null && match.team1_report_opponent_score !== null;
    const team2Reported =
      match.team2_report_score !== null && match.team2_report_opponent_score !== null;

    // Un seul report : il fait foi. Le vainqueur se dérive du **format** de la
    // manche, seul à savoir si un score nul est un résultat ou une aberration —
    // la règle vit dans `matchWinnerSide`, partagée avec l'arbitrage et
    // l'accord des deux engagés.
    if (team1Reported !== team2Reported) {
      const team1Score = team1Reported
        ? Number(match.team1_report_score)
        : Number(match.team2_report_opponent_score);
      const team2Score = team1Reported
        ? Number(match.team1_report_opponent_score)
        : Number(match.team2_report_score);

      const format = await loadTournamentMatchFormat(
        connection,
        tournamentId,
        Number(match.round_number),
      );
      const { winnerTeamId, loserTeamId } = resolveSides(match, format, team1Score, team2Score);

      await finalizeMatch(connection, tournamentId, match, {
        team1Score,
        team2Score,
        winnerTeamId,
        loserTeamId,
      });
      resolved += 1;
      continue;
    }

    // Les deux ont reporté, et ils se contredisent — sans quoi le report aurait
    // clos la manche sur-le-champ. C'est le seul cas où l'expiration du délai ne
    // débloque rien.
    if (!team1Reported || !team2Reported) continue;

    // Un délai de plus après l'expiration : l'escalade constate une souffrance
    // qui dure, pas un désaccord qui vient de naître.
    if (Number(match.conflict_stalled ?? 0) !== 1) continue;

    await queueRefereeAlert(connection, {
      kind: "score_report_stalled",
      matchId: Number(match.id),
    });
  }

  return resolved;
}

// Import MatchRow type
import type { MatchRow } from "./_internal";

/**
 * Manche au report expiré, augmentée du seul calcul qu'il vaut mieux laisser à
 * MySQL : le désaccord a-t-il lui-même dépassé le délai ?
 *
 * Comparer deux horodatages côté Node demanderait de faire confiance à
 * l'alignement de son horloge et de son fuseau avec ceux du serveur ; `NOW()`
 * les compare dans le même référentiel que celui qui les a écrits.
 */
type ExpiredMatchRow = MatchRow & { conflict_stalled: number | null };
