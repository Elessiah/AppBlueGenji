import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { resolvePhasePlan } from "@/lib/shared/tournament-phases";
import type { TournamentPhaseStanding } from "@/lib/shared/types";
import {
  loadPhases,
  loadPhase,
  updatePhaseResolution,
  setPhaseState,
  setCurrentPhase,
  insertPhaseTeams,
  savePhaseResults,
  loadPhaseTeamIds,
  loadPhaseStandings,
} from "./phases-repository";
import { loadTournamentRow, finishTournament, getRegistrationRows } from "./repository";
import {
  rankingMatchJoinSql,
  rankingPointsForTeamSql,
  rankingWinsSql,
} from "@/lib/shared/ranking";
import { createBracketIfMissing } from "./bracket-generator";
import { tryAutoResolveByes } from "./byes";
import { isEliminationPhaseComplete, rankEliminationPhase } from "./finalization";
import {
  initializeSwissTournament,
  generateSwissRound,
  loadSwissRanking,
  reconcileSwiss,
} from "./swiss";
import { initializeSurvivalTournament, generateSurvivalRound } from "./survival";

/**
 * Initialise un tournoi multi-phase : seed la phase 1 depuis le classement du site,
 * résout le plan des phases (entrants, qualifiants, phases sautées), et lance la
 * première phase non-sautée.
 *
 * La résolution du plan est idempotente : si certaines équipes se sont retirées
 * après initialisation, la prochaine tentative (via reconcilePhases) réajustera
 * le plan et sautera des phases devenues trop petites.
 */
export async function initializeMultiTournament(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournamentRow(conn, tournamentId);
  if (!tournament || tournament.format !== "MULTI") return;

  const phases = await loadPhases(conn, tournamentId);
  const registrations = await getRegistrationRows(conn, tournamentId);
  const registeredCount = registrations.length;

  // Résout le plan des phases (effectifs, qualifiants, phases sautées)
  const phaseConfigs = phases.map((p) => ({
    position: p.position,
    format: p.format,
    name: p.name,
    qualifierMode: p.qualifier_mode,
    qualifierValue: p.qualifier_value,
    hasThirdPlaceMatch: Boolean(p.has_third_place_match),
    swissTotalRounds: p.swiss_total_rounds,
    survivalRoundsBeforeFirstCut: p.survival_rounds_before_first_cut,
    survivalRoundsPerCut: p.survival_rounds_per_cut,
  }));

  const resolved = resolvePhasePlan(registeredCount, phaseConfigs);

  // Seed la phase 1 depuis le classement du site (exactement comme Survie),
  // barème **et** assiette compris (`lib/shared/ranking.ts`) — sauf si le staff
  // a ordonné le seeding à la main, auquel cas l'ordre des inscriptions fait
  // autorité.
  const WINS = rankingWinsSql("r.team_id");

  const [seededRows] = Number(tournament.manual_seeding ?? 0) === 1
    ? await conn.execute<(RowDataPacket & { team_id: number; seed: number })[]>(
        `SELECT
          team_id,
          ROW_NUMBER() OVER (ORDER BY COALESCE(seed, 1000000), registered_at ASC) AS seed
         FROM bg_tournament_registrations
         WHERE tournament_id = ?`,
        [tournamentId],
      )
    : await conn.execute<(RowDataPacket & { team_id: number; seed: number })[]>(
        `SELECT
          r.team_id,
          ROW_NUMBER() OVER (ORDER BY ${rankingPointsForTeamSql("r.team_id")} DESC, ${WINS} DESC, r.team_id ASC) AS seed
         FROM bg_tournament_registrations r
         LEFT JOIN bg_matches m
           ON ${rankingMatchJoinSql("r.team_id")}
         WHERE r.tournament_id = ?
         GROUP BY r.team_id`,
        [tournamentId],
      );

  // Persiste les métriques de chaque phase (entrants, qualifiants, max_rounds, state=SKIPPED)
  for (const resolvedPhase of resolved) {
    const phaseRow = phases.find((p) => p.position === resolvedPhase.position);
    if (!phaseRow) continue;

    await updatePhaseResolution(conn, phaseRow.id, {
      entrants: resolvedPhase.entrants,
      qualifiers: resolvedPhase.qualifiers,
      maxRounds: resolvedPhase.maxRounds,
      state: resolvedPhase.skipped ? "SKIPPED" : "PENDING",
    });
  }

  // Insère les équipes de la phase 1 avec seed
  if (seededRows.length > 0) {
    const firstNonSkipped = resolved.find((p) => !p.skipped);
    if (firstNonSkipped) {
      const firstPhaseRow = phases.find((p) => p.position === firstNonSkipped.position);
      if (firstPhaseRow) {
        await insertPhaseTeams(
          conn,
          tournamentId,
          firstPhaseRow.id,
          seededRows.map((row) => ({
            teamId: Number(row.team_id),
            seed: Number(row.seed),
          })),
        );

        // Lance la première phase non-sautée
        await startPhase(tournamentId, firstPhaseRow.id, conn);

        // Réconcilie immédiatement pour avancer si la phase est dégénérée (0 ou 1 équipe)
        await reconcilePhases(tournamentId, conn);
      }
    } else {
      // Toutes les phases sont sautées : finalise immédiatement
      if (seededRows.length === 1) {
        await conn.execute(
          `UPDATE bg_tournament_registrations SET final_rank = 1 WHERE tournament_id = ? AND team_id = ?`,
          [tournamentId, seededRows[0].team_id],
        );
      }
      await finishTournament(conn, tournamentId);
    }
  } else {
    // Zéro inscription : finalise vide
    await finishTournament(conn, tournamentId);
  }
}

/**
 * Lance une phase non-sautée : la passe en état RUNNING, initialise le moteur
 * (bracket, Survie, Suisse) avec le roster de la phase, et génère la première
 * manche (ou vérifie que la phase est déjà complète si seulement 1 équipe).
 *
 * Après génération de la première manche, une appel à reconcilePhases() peut
 * immédiatement clôturer une phase dégénérée et chaîner à la suivante.
 */
export async function startPhase(
  tournamentId: number,
  phaseId: number,
  conn: PoolConnection,
): Promise<void> {
  const phase = await loadPhase(conn, phaseId);
  if (!phase || phase.state !== "PENDING") return;

  // Met en état RUNNING + timestamp started_at
  await setPhaseState(conn, phaseId, "RUNNING", "started_at");
  await setCurrentPhase(conn, tournamentId, phaseId);

  // Charge les équipes de la phase, triées par seed
  const teamIds = await loadPhaseTeamIds(conn, phaseId);

  if (teamIds.length === 0) {
    // Cas dégénéré : aucune équipe. Clôture immédiatement.
    await setPhaseState(conn, phaseId, "FINISHED", "finished_at");
    return;
  }

  // Dispatch sur le format de la phase
  if (phase.format === "SWISS") {
    await initializeSwissTournament(tournamentId, conn, { phaseId, teamIds });
    await generateSwissRound(tournamentId, conn, phaseId);
  } else if (phase.format === "SURVIVAL") {
    await initializeSurvivalTournament(tournamentId, conn, { phaseId, teamIds });
    await generateSurvivalRound(tournamentId, conn, phaseId);
  } else {
    // SINGLE ou DOUBLE : crée le bracket pour le roster limité à la phase
    const tournament = await loadTournamentRow(conn, tournamentId);
    if (tournament) {
      await createBracketIfMissing(conn, tournament, {
        phaseId,
        maxRounds: phase.max_rounds,
        // Le tournoi porte le format « MULTI » : c'est la phase qui décide du
        // type de bracket et de la petite finale.
        format: phase.format as "SINGLE" | "DOUBLE",
        hasThirdPlaceMatch: Boolean(phase.has_third_place_match),
      });
    }
  }
}

/**
 * Réconciliation des phases : idempotent et sans effet si le tournoi n'est pas MULTI+RUNNING.
 *
 * Vérrouille la ligne du tournoi (FOR UPDATE) pour sérialiser les opérations concurrentes :
 * deux reconcilePhases() ne se chevauchent jamais. Charge la phase active, demande à son
 * moteur si elle est complète, et si oui :
 * - Écrit les résultats (rang, qualification) sur la phase
 * - Clôt la phase + timestamp finished_at
 * - Recalcule le plan des phases avec le nombre réel de qualifiants (abandon peut en réduire le nombre)
 * - Lance la phase suivante non-sautée si elle existe, puis récurse (une phase dégénérée enchaîne)
 * - Sinon, finalise le tournoi
 *
 * Le verrouillage FOR UPDATE garantit qu'aucune autre opération ne change l'état pendant
 * la réconciliation, ce qui est critique pour les appels concurrents du même tournoi.
 */
export async function reconcilePhases(tournamentId: number, conn: PoolConnection): Promise<void> {
  const [rows] = await conn.execute<(RowDataPacket & { format: string; state: string })[]>(
    `SELECT format, state FROM bg_tournaments WHERE id = ? LIMIT 1 FOR UPDATE`,
    [tournamentId],
  );

  if (rows.length === 0 || rows[0].format !== "MULTI" || rows[0].state !== "RUNNING") {
    return;
  }

  const phases = await loadPhases(conn, tournamentId);
  const tournament = await loadTournamentRow(conn, tournamentId);
  if (!tournament) return;

  // Charge la phase active
  const currentPhaseId = tournament.current_phase_id;
  if (!currentPhaseId) return;

  const currentPhase = await loadPhase(conn, currentPhaseId);
  if (!currentPhase || currentPhase.state !== "RUNNING") return;

  // Vérifie si la phase est complète selon son format
  let isDone = false;
  let phaseFinalRanking: number[] = [];

  if (currentPhase.format === "SURVIVAL") {
    const { reconcileSurvival: reconcileSurvivalInternal } = await import("./survival");
    const result = await reconcileSurvivalInternal(tournamentId, conn, {
      phaseId: currentPhaseId,
      targetTeams: currentPhase.qualifiers ?? undefined,
    });
    isDone = result?.done ?? false;
    if (isDone && result?.standings) {
      const { computeFinalRanks } = await import("@/lib/shared/survival");
      const rankMap = computeFinalRanks(result.standings);
      phaseFinalRanking = Array.from(rankMap.entries())
        .sort((a, b) => a[1] - b[1])
        .map(([teamId]) => teamId);
    }
  } else if (currentPhase.format === "SWISS") {
    // On DÉLÈGUE au moteur suisse, exactement comme la branche Survie ci-dessus :
    // c'est `reconcileSwiss` qui apparie la ronde suivante et incrémente le
    // compteur de la phase. Se contenter de lire `swiss_current_round` laissait
    // la phase figée à la ronde 1 — le tournoi ne se terminait jamais.
    const result = await reconcileSwiss(tournamentId, conn, { phaseId: currentPhaseId });
    isDone = result.done;

    if (isDone) {
      phaseFinalRanking = await loadSwissRanking(conn, tournamentId, currentPhaseId);
    }
  } else {
    // SINGLE ou DOUBLE : les byes de la phase d'abord, la complétude ensuite.
    // Un match d'exemption n'a pas de perdant : le match de lower qu'il
    // alimentait reste à une seule équipe, sans plus aucun feeder à attendre.
    // Sans cette résolution **portée par la phase** (les appels du reste du
    // moteur travaillent sur `phase_id = 0`, où il n'y a rien à résoudre en
    // MULTI), le plateau se fige sur des matchs PENDING sans adversaire et la
    // phase n'est jamais complète — le tournoi ne se termine donc jamais.
    await tryAutoResolveByes(conn, tournamentId, currentPhaseId);

    isDone = await isEliminationPhaseComplete(conn, tournamentId, currentPhaseId);

    if (isDone) {
      phaseFinalRanking = await rankEliminationPhase(
        conn,
        tournamentId,
        currentPhaseId,
        currentPhase.format as "SINGLE" | "DOUBLE",
        Boolean(currentPhase.has_third_place_match),
      );
    }
  }

  if (!isDone) {
    return; // Phase non terminée, rien à faire
  }

  // Phase terminée. Le classement vient du **moteur de la phase** (survie, ronde
  // suisse ou bracket) : surtout pas de l'ordre des standings en base, qui est
  // encore l'ordre de seeding tant que `savePhaseResults` n'a pas écrit les rangs.
  // S'y fier qualifierait les têtes de série, pas les équipes qui ont gagné.
  const standings = await loadPhaseStandings(conn, currentPhaseId);
  const ordered = [...phaseFinalRanking];
  const alreadyRanked = new Set(ordered);
  for (const standing of standings) {
    if (!alreadyRanked.has(standing.teamId)) ordered.push(standing.teamId);
  }

  const qualifiersCount = currentPhase.qualifiers ?? 1;
  const rankedStandings = ordered.map((teamId, index) => ({
    teamId,
    rank: index + 1,
    qualified: index < qualifiersCount,
  }));

  await savePhaseResults(conn, currentPhaseId, rankedStandings);
  await setPhaseState(conn, currentPhaseId, "FINISHED", "finished_at");

  const qualifiedTeamIds = rankedStandings.filter((r) => r.qualified).map((r) => r.teamId);
  const actualQualifiers = qualifiedTeamIds.length;

  // Re-résout le plan **restant** à partir du nombre réel de qualifiées : des
  // abandons en cours de phase peuvent rendre une phase suivante inutile, qui
  // devient alors SKIPPED à la volée. Les phases déjà jouées ne sont pas touchées.
  const remaining = phases.filter((p) => p.position > currentPhase.position);
  const phaseConfigs = remaining.map((p) => ({
    position: p.position,
    format: p.format,
    name: p.name,
    qualifierMode: p.qualifier_mode,
    qualifierValue: p.qualifier_value,
    hasThirdPlaceMatch: Boolean(p.has_third_place_match),
    swissTotalRounds: p.swiss_total_rounds,
    survivalRoundsBeforeFirstCut: p.survival_rounds_before_first_cut,
    survivalRoundsPerCut: p.survival_rounds_per_cut,
  }));

  const reresolved = resolvePhasePlan(actualQualifiers, phaseConfigs);

  for (let i = 0; i < remaining.length; i += 1) {
    const phaseRow = remaining[i];
    const resolved = reresolved[i];
    await updatePhaseResolution(conn, phaseRow.id, {
      entrants: resolved.entrants,
      qualifiers: resolved.qualifiers,
      maxRounds: resolved.maxRounds,
      state: resolved.skipped ? "SKIPPED" : "PENDING",
    });
  }

  const nextPhaseIdx = reresolved.findIndex((p) => !p.skipped);

  if (nextPhaseIdx >= 0 && actualQualifiers > 0) {
    const nextPhaseRow = remaining[nextPhaseIdx];

    // Les qualifiées entrent seedées par leur rang dans la phase écoulée
    // (seed 1 = meilleure), et non par leur classement de site initial.
    await insertPhaseTeams(
      conn,
      tournamentId,
      nextPhaseRow.id,
      qualifiedTeamIds.map((teamId, index) => ({ teamId, seed: index + 1 })),
    );

    await startPhase(tournamentId, nextPhaseRow.id, conn);
    // Une phase instantanément complète (un seul qualifié, que des byes) doit
    // enchaîner sans attendre une nouvelle saisie de score.
    await reconcilePhases(tournamentId, conn);
  } else {
    await finalizeMultiTournament(tournamentId, conn);
  }
}

/**
 * Finalise un tournoi multi-phase : écrit final_rank dans bg_tournament_registrations
 * pour TOUTES les équipes en fonction de la phase la plus avancée qu'elles ont atteinte.
 *
 * Ordre : équipes ordonnées par phase (plus avancée = plus petit rank), puis par rang
 * dans la phase (rang 1 = meilleur dans la phase). Les équipes éliminées en phase 1 sont
 * dernières.
 *
 * Utilise une seule UPDATE CASE WHEN ... THEN pour une performance optimale.
 */
export async function finalizeMultiTournament(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const phases = await loadPhases(conn, tournamentId);
  const registrations = await getRegistrationRows(conn, tournamentId);

  // Collecte tous les résultats de phases : pour chaque équipe, sa meilleure phase
  type TeamRanking = { teamId: number; phaseReached: number; phaseRank: number };
  const teamRankings: Map<number, TeamRanking> = new Map();

  // Initialise avec la phase la plus ancienne (rang bas)
  for (const reg of registrations) {
    teamRankings.set(Number(reg.team_id), {
      teamId: Number(reg.team_id),
      phaseReached: 0,
      phaseRank: 0,
    });
  }

  // Parcourt les phases de la dernière à la première
  for (let i = phases.length - 1; i >= 0; i--) {
    const phaseRow = phases[i];
    const standings = await loadPhaseStandings(conn, phaseRow.id);

    for (const standing of standings) {
      const existing = teamRankings.get(standing.teamId);
      if (!existing || phaseRow.position > existing.phaseReached) {
        teamRankings.set(standing.teamId, {
          teamId: standing.teamId,
          phaseReached: phaseRow.position,
          phaseRank: standing.rank ?? 999,
        });
      }
    }
  }

  // Trie par phase (desc) puis par rang (asc)
  const finalOrder = Array.from(teamRankings.values()).sort(
    (a, b) => b.phaseReached - a.phaseReached || a.phaseRank - b.phaseRank,
  );

  // Génère le CASE WHEN pour les ranks
  const caseStmt: string[] = [];
  const values: unknown[] = [];

  for (let i = 0; i < finalOrder.length; i++) {
    const ranking = finalOrder[i];
    caseStmt.push("WHEN ? THEN ?");
    values.push(ranking.teamId, i + 1);
  }

  if (caseStmt.length === 0) {
    // Aucune équipe : finalise vide
    await finishTournament(conn, tournamentId);
    return;
  }

  values.push(tournamentId);

  await conn.execute(
    `UPDATE bg_tournament_registrations
     SET final_rank = CASE team_id ${caseStmt.join(" ")} ELSE final_rank END
     WHERE tournament_id = ?`,
    values,
  );

  await finishTournament(conn, tournamentId);
}

/**
 * Charge les phases d'un tournoi (si MULTI) avec leurs standings actuels.
 * Retourne null si le tournoi n'est pas MULTI.
 */
export async function loadPhasesForDetail(
  conn: PoolConnection,
  tournamentId: number,
): Promise<{
  phases: ReturnType<typeof import("./_internal").mapPhase>[];
  currentPhaseId: number | null;
  phaseStandings: Record<number, TournamentPhaseStanding[]>;
} | null> {
  const tournament = await loadTournamentRow(conn, tournamentId);
  if (!tournament || tournament.format !== "MULTI") return null;

  const { mapPhase } = await import("./_internal");
  const phaseRows = await loadPhases(conn, tournamentId);
  const phaseStandings: Record<number, TournamentPhaseStanding[]> = {};

  for (const phaseRow of phaseRows) {
    const standings = await loadPhaseStandings(conn, phaseRow.id);
    phaseStandings[phaseRow.id] = standings;
  }

  return {
    phases: phaseRows.map(mapPhase),
    currentPhaseId: tournament.current_phase_id,
    phaseStandings,
  };
}
