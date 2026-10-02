/**
 * BlueGenji Survie — `reconcileEndurance` **rejoue** tout depuis l'historique,
 * persiste le classement, puis enchaîne la manche suivante ou bascule en
 * play-offs (`docs/features/BG_SURVIE_MODE.md`).
 */

import type { PoolConnection } from "mysql2/promise";
import { qualificationComplete } from "@/lib/shared/bg-survie/qualification";
import { replayEndurance } from "@/lib/shared/bg-survie/replay";
import { assignRanks } from "@/lib/shared/bg-survie/standings";
import { reopenTournament } from "../repository";
import { finalizeEndurance } from "./finalization";
import { finalizePlayoffsIfDone, repairPlayoffBracket, startEndurancePlayoffs } from "./playoffs";
import { generateEnduranceRound } from "./qualification";
import { loadForfeits, loadPenalties, loadQualificationOutcomes } from "./replay-inputs";
import { roundHasScoreInput, roundIsComplete, roundPairingsAreStale } from "./round-progress";
import { loadEnduranceStandings, persistStandings } from "./standings-store";
import { configOf, loadTournament, matchFormatOf } from "./tournament-row";

/**
 * Rejoue la phase qualificative, persiste le classement, puis :
 * - enchaîne la manche suivante si la précédente est complète ;
 * - bascule en play-offs dès que l'effectif atteint la cible.
 *
 * Idempotent : appelable après chaque saisie de score.
 */
export async function reconcileEndurance(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId);
  if (tournament?.format !== "BG_SURVIE") return;
  // Un tournoi terminé n'est **pas** hors de portée : corriger le score de la
  // finale d'une archive doit se voir au palmarès, et `adminResolveMatch` le
  // permet exprès (`finishTournament` prévoit d'ailleurs le rejeu de sa
  // finalisation). Sortir ici laissait `final_rank` et le podium sur l'ancienne
  // championne, que la page — qui rejoue toujours — contredisait ensuite.
  //
  // Ce qu'un tournoi clos ne fait pas, en revanche, c'est **rouvrir** : le rejeu
  // et la finalisation sont rejoués, la pose d'une manche ou d'un arbre ne l'est
  // pas. Voir `docs/features/FINISHED_TOURNAMENT_RECONCILIATION.md`.
  const finished = tournament.state === "FINISHED";

  const config = configOf(tournament);
  const stored = await loadEnduranceStandings(conn, tournamentId);
  if (stored.length === 0) return;

  const replayed = replayEndurance({
    teams: stored.map((standing) => ({ teamId: standing.teamId, seed: standing.seed })),
    matches: await loadQualificationOutcomes(conn, tournamentId),
    forfeits: await loadForfeits(conn, tournamentId),
    penalties: await loadPenalties(conn, tournamentId),
    config,
    lastRound: Number(tournament.endurance_current_round),
    matchFormat: matchFormatOf(tournament),
  });

  await persistStandings(conn, tournamentId, assignRanks(replayed));

  if (Number(tournament.endurance_playoffs_started) === 1) {
    // L'arbre se relit avant de s'enchaîner : une correction de score en amont
    // (un quart de finale, voire une manche qualificative) a pu périmer un tour
    // déjà posé, et rien d'autre ne le regarde.
    const rewritten = await repairPlayoffBracket(conn, tournamentId, assignRanks(replayed), config);
    // Un tour réécrit dans un tournoi **clos** : ce ne peut être qu'un tour
    // d'exemptions né d'un double forfait (un tour joué porte une saisie, et
    // n'est jamais réécrit). Corriger ce double forfait remet une vraie
    // rencontre en jeu — le tournoi doit repartir avec elle, sinon il resterait
    // « terminé » sur un arbre que plus personne ne peut jouer. Il se reclôt
    // par le chemin ordinaire une fois la finale jouée.
    if (rewritten && finished) await reopenTournament(conn, tournamentId);
    await finalizePlayoffsIfDone(conn, tournamentId);
    return;
  }

  // Clos sans arbre — la qualification n'a pas rendu deux qualifiées, et
  // `startEndurancePlayoffs` a fini le tournoi sur place. Son classement se
  // réécrit de la même façon qu'il a été écrit, et rien d'autre ne se rejoue :
  // reprendre la qualification ici reposerait une manche à un tournoi terminé.
  if (finished) {
    await finalizeEndurance(conn, tournamentId, assignRanks(replayed));
    return;
  }

  const active = replayed.filter((standing) => standing.status === "ACTIVE");
  const currentRound = Number(tournament.endurance_current_round);

  // Une correction de score en amont réécrit le classement : la manche courante,
  // si elle est déjà posée mais pas entamée, décrit alors des appariements
  // périmés (voire une équipe éliminée entre-temps). On la défait pour la
  // reformer depuis le classement rejoué — c'est ce que font déjà la Survie et
  // la Ronde suisse.
  //
  // Une manche défaite n'est pas « une manche en cours » : elle n'a jamais été
  // jouée. On repart donc de la précédente, et la décision qui suit est la même
  // que si l'on venait d'en terminer une. La défaire puis **sortir** laissait le
  // tournoi sans manche et sans arbre dès que la correction achevait la
  // qualification — `generateEnduranceRound` sort alors sur
  // `qualificationComplete` sans rien créer, et plus rien n'aurait repris le
  // tournoi, faute d'un match sur lequel reporter un score.
  let effectiveRound = currentRound;
  if (currentRound > 0 && !(await roundHasScoreInput(conn, tournamentId, currentRound))) {
    if (await roundPairingsAreStale(conn, tournamentId, currentRound, replayed)) {
      await conn.execute(
        `DELETE FROM bg_matches WHERE tournament_id = ? AND phase_id = 0 AND round_number = ?`,
        [tournamentId, currentRound],
      );
      await conn.execute(`UPDATE bg_tournaments SET endurance_current_round = ? WHERE id = ?`, [
        currentRound - 1,
        tournamentId,
      ]);
      effectiveRound = currentRound - 1;
    }
  }

  // Rien ne se décide **au milieu d'une manche**. Un seul score reporté peut
  // faire tomber l'effectif actif sur la cible des play-offs alors que les
  // autres rencontres de la manche sont encore `READY` : bascule immédiate, et
  // ces matchs restaient ouverts à jamais — `reconcileEndurance` repartant
  // ensuite par la branche `playoffsStarted`, plus rien ne les regardait. La
  // manche entière est donc jouée avant qu'on lise son classement, que ce soit
  // pour clore la qualification ou pour apparier la suivante.
  if (!(await roundIsComplete(conn, tournamentId, effectiveRound))) return;

  // Le plafond de manches n'a pas de branche à lui : le rejeu écarte lui-même
  // les non-qualifiées à la dernière manche, si bien que l'effectif retombe à
  // `playoffSize` et que la bascule ci-dessous se déclenche comme d'habitude.
  if (qualificationComplete(active.length, config)) {
    await startEndurancePlayoffs(tournamentId, conn);
    return;
  }

  await generateEnduranceRound(tournamentId, conn);
}
