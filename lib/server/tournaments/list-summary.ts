/**
 * Résumé des cartes de la liste des tournois : le vainqueur d'un tournoi
 * terminé, l'avancement d'un tournoi en cours (`lib/shared/tournament-card-
 * summary.ts`, qui décide de la règle).
 *
 * Lu **par lots**, quelques requêtes pour toute la liste quel que soit le
 * nombre de tournois : la liste est la lecture la plus sollicitée du site, et
 * une requête par carte la ferait grandir avec chaque tournoi en cours. Les
 * matchs n'en sortent que **comptés** par manche, jamais ligne à ligne.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import {
  pickChampion,
  runningProgressFrom,
  type MatchCountRow,
  type RunningProgressSource,
} from "@/lib/shared/tournament-card-summary";
import type {
  EnduranceStandingRow,
  PhaseFormat,
  PhaseState,
  SurvivalStandingRow,
  TournamentCard,
} from "@/lib/shared/types";

export type CardSummary = Pick<TournamentCard, "champion" | "runningProgress">;

/**
 * Placeholders `?, ?, ?` d'un `IN (...)` : `execute` ne développe pas les
 * tableaux, les identifiants restent des paramètres liés.
 */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function groupBy<T>(rows: readonly T[], key: (row: T) => number): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

type ChampionRow = RowDataPacket & {
  tournament_id: number;
  team_id: number;
  team_name: string;
  final_rank: number | null;
};

/** Vainqueur de chaque tournoi terminé listé. */
async function loadChampions(
  db: Pool,
  tournamentIds: readonly number[],
): Promise<Map<number, CardSummary["champion"]>> {
  const champions = new Map<number, CardSummary["champion"]>();
  if (!tournamentIds.length) return champions;

  // Seuls les premiers : `pickChampion` n'a besoin de voir qu'eux pour
  // reconnaître un ex æquo, et un plateau à 128 n'en compte qu'un.
  const [rows] = await db.execute<ChampionRow[]>(
    `SELECT r.tournament_id, r.team_id, tm.name AS team_name, r.final_rank
     FROM bg_tournament_registrations r
     JOIN bg_teams tm ON tm.id = r.team_id
     WHERE r.final_rank = 1 AND r.tournament_id IN (${placeholders(tournamentIds.length)})`,
    [...tournamentIds],
  );

  const byTournament = groupBy(rows, (row) => Number(row.tournament_id));
  for (const id of tournamentIds) {
    const candidates = (byTournament.get(id) ?? []).map((row) => ({
      teamId: Number(row.team_id),
      name: row.team_name,
      finalRank: row.final_rank === null ? null : Number(row.final_rank),
    }));
    champions.set(id, pickChampion(candidates));
  }
  return champions;
}

type TournamentMetaRow = RowDataPacket & {
  id: number;
  swiss_total_rounds: number | null;
  swiss_current_round: number;
  current_phase_id: number | null;
};

type MatchCountSqlRow = RowDataPacket & {
  tournament_id: number;
  phase_id: number;
  round_number: number;
  total: number | string;
  completed: number | string | null;
};

type StatusRow<S> = RowDataPacket & { tournament_id: number; status: S };

type PhaseSqlRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  state: PhaseState;
  format: PhaseFormat;
  swiss_total_rounds: number | null;
};

/** Avancement de chaque tournoi en cours listé. */
async function loadRunningProgress(
  db: Pool,
  cards: readonly Pick<TournamentCard, "id" | "format">[],
): Promise<Map<number, number | null>> {
  const progress = new Map<number, number | null>();
  if (!cards.length) return progress;

  const ids = cards.map((card) => card.id);
  const idsOf = (formats: TournamentCard["format"][]) =>
    cards.filter((card) => formats.includes(card.format)).map((card) => card.id);

  // Survie et BG Survie se mesurent à leurs éliminations : leurs matchs ne
  // servent à rien, et ce sont les plateaux les plus longs.
  const matchIds = idsOf(["SINGLE", "DOUBLE", "SWISS", "MULTI"]);
  const survivalIds = idsOf(["SURVIVAL"]);
  const enduranceIds = idsOf(["BG_SURVIE"]);
  const multiIds = idsOf(["MULTI"]);

  const [[metaRows], matchRows, survivalRows, enduranceRows, phaseRows] = await Promise.all([
    db.execute<TournamentMetaRow[]>(
      `SELECT id, swiss_total_rounds, swiss_current_round, current_phase_id
       FROM bg_tournaments WHERE id IN (${placeholders(ids.length)})`,
      ids,
    ),
    matchIds.length
      ? db
          .execute<MatchCountSqlRow[]>(
            `SELECT tournament_id, phase_id, round_number,
               COUNT(*) AS total,
               SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed
             FROM bg_matches
             WHERE tournament_id IN (${placeholders(matchIds.length)})
             GROUP BY tournament_id, phase_id, round_number`,
            matchIds,
          )
          .then(([rows]) => rows)
      : Promise.resolve([] as MatchCountSqlRow[]),
    survivalIds.length
      ? db
          .execute<StatusRow<SurvivalStandingRow["status"]>[]>(
            `SELECT tournament_id, status FROM bg_survival_standings
             WHERE phase_id = 0 AND tournament_id IN (${placeholders(survivalIds.length)})`,
            survivalIds,
          )
          .then(([rows]) => rows)
      : Promise.resolve([] as StatusRow<SurvivalStandingRow["status"]>[]),
    enduranceIds.length
      ? db
          .execute<StatusRow<EnduranceStandingRow["status"]>[]>(
            `SELECT tournament_id, status FROM bg_endurance_standings
             WHERE tournament_id IN (${placeholders(enduranceIds.length)})`,
            enduranceIds,
          )
          .then(([rows]) => rows)
      : Promise.resolve([] as StatusRow<EnduranceStandingRow["status"]>[]),
    multiIds.length
      ? db
          .execute<PhaseSqlRow[]>(
            `SELECT id, tournament_id, state, format, swiss_total_rounds
             FROM bg_tournament_phases
             WHERE tournament_id IN (${placeholders(multiIds.length)})`,
            multiIds,
          )
          .then(([rows]) => rows)
      : Promise.resolve([] as PhaseSqlRow[]),
  ]);

  const metaById = new Map(metaRows.map((row) => [Number(row.id), row]));
  const matchesById = groupBy(matchRows, (row) => Number(row.tournament_id));
  const survivalById = groupBy(survivalRows, (row) => Number(row.tournament_id));
  const enduranceById = groupBy(enduranceRows, (row) => Number(row.tournament_id));
  const phasesById = groupBy(phaseRows, (row) => Number(row.tournament_id));

  for (const card of cards) {
    const meta = metaById.get(card.id);
    const matchCounts: MatchCountRow[] = (matchesById.get(card.id) ?? []).map((row) => ({
      phaseId: Number(row.phase_id),
      roundNumber: Number(row.round_number),
      total: Number(row.total),
      completed: Number(row.completed ?? 0),
    }));
    const source: RunningProgressSource = {
      format: card.format,
      swissTotalRounds:
        meta?.swiss_total_rounds === null || meta?.swiss_total_rounds === undefined
          ? null
          : Number(meta.swiss_total_rounds),
      swissCurrentRound: Number(meta?.swiss_current_round ?? 0),
      currentPhaseId:
        meta?.current_phase_id === null || meta?.current_phase_id === undefined
          ? null
          : Number(meta.current_phase_id),
      matchCounts,
      survivalStatuses: (survivalById.get(card.id) ?? []).map((row) => row.status),
      enduranceStatuses: (enduranceById.get(card.id) ?? []).map((row) => row.status),
      phases: (phasesById.get(card.id) ?? []).map((row) => ({
        id: Number(row.id),
        state: row.state,
        format: row.format,
        swissTotalRounds:
          row.swiss_total_rounds === null ? null : Number(row.swiss_total_rounds),
      })),
    };
    progress.set(card.id, runningProgressFrom(source));
  }
  return progress;
}

/**
 * Résumé de chaque carte : vainqueur des terminés, avancement des en-cours.
 * Les autres cartes n'apparaissent pas dans la table — elles gardent les `null`
 * que `mapCard` leur a donnés.
 */
export async function loadCardSummaries(
  db: Pool,
  cards: readonly TournamentCard[],
): Promise<Map<number, Partial<CardSummary>>> {
  const finishedIds = cards.filter((card) => card.state === "FINISHED").map((card) => card.id);
  const running = cards.filter((card) => card.state === "RUNNING");

  const [champions, progress] = await Promise.all([
    loadChampions(db, finishedIds),
    loadRunningProgress(db, running),
  ]);

  const summaries = new Map<number, Partial<CardSummary>>();
  for (const [id, champion] of champions) summaries.set(id, { champion });
  for (const [id, runningProgress] of progress) summaries.set(id, { runningProgress });
  return summaries;
}
