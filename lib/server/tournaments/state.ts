import type { PoolConnection } from "mysql2/promise";
import type { TournamentState } from "@/lib/shared/types";
import { computeTournamentState as sharedComputeTournamentState } from "@/lib/shared/tournament-state";
import { TournamentRow } from "./_internal";
import { queueBotLog } from "./bot-logs";
import {
  loadTournamentRow,
  updateTournamentState,
} from "./repository";

/**
 * État réel du tournoi d'après ses dates, à partir d'une ligne SQL.
 *
 * Simple adaptation de {@link sharedComputeTournamentState} (`lib/shared`) au
 * nommage `snake_case` des lignes : le calcul lui-même est partagé avec le
 * client, qui s'en sert pour faire basculer l'affichage à l'heure dite sans
 * requête.
 */
export function computeTournamentState(
  row: Pick<
    TournamentRow,
    "state" | "finished_at" | "registration_open_at" | "registration_close_at" | "start_at"
  >,
): TournamentState {
  return sharedComputeTournamentState({
    state: row.state,
    finishedAt: row.finished_at,
    registrationOpenAt: row.registration_open_at,
    registrationCloseAt: row.registration_close_at,
    startAt: row.start_at,
  });
}

export async function syncTournamentState(
  connection: PoolConnection,
  tournamentId: number,
): Promise<{ row: TournamentRow | null; stateChanged: boolean }> {
  const tournament = await loadTournamentRow(connection, tournamentId);
  if (!tournament) return { row: null, stateChanged: false };

  // Retenu pour la comparaison finale : l'entretien qui suit peut clore le
  // tournoi de son côté, et ses appelants s'appuient sur `stateChanged` pour
  // rafraîchir la liste publique.
  const stateAtEntry = tournament.state;
  const computed = computeTournamentState(tournament);
  let stateChanged = false;

  // Coup d'envoi d'un plateau vide ou réduit à une seule engagée : le tournoi
  // saute « en cours » et passe directement à « terminé ».
  //
  // Le contrôle précède toute initialisation de format — aucun moteur n'a ainsi
  // à semer un classement ou des phases pour un tournoi qui n'aura jamais de
  // match, et surtout aucun ne le laisse coincé en `RUNNING`, faute d'un match
  // dont la fin le clôturerait. Il porte sur l'état *calculé*, et non sur la
  // seule bascule depuis les inscriptions : entre la clôture des inscriptions
  // et l'heure de début, un tournoi repasse par `UPCOMING`, et un tournoi déjà
  // `RUNNING` (état hérité d'avant cette règle, ou écrit à la main) doit être
  // rattrapé de la même façon. Une inscription ne se retirant jamais, en
  // compter moins de deux ici signifie toujours que rien n'a pu commencer.
  if (computed === "RUNNING") {
    const { finalizeUnderfilledTournament } = await import("./finalization");
    if (await finalizeUnderfilledTournament(connection, tournamentId)) {
      return { row: await loadTournamentRow(connection, tournamentId), stateChanged: true };
    }
  }

  if (computed !== tournament.state) {
    // Le coup d'envoi se reconnaît à l'état **d'arrivée**, et non au couple
    // `REGISTRATION → RUNNING`. On est déjà à l'intérieur de `computed !==
    // state` : `computed === "RUNNING"` implique donc que l'état de départ est
    // `UPCOMING` ou `REGISTRATION`, jamais `RUNNING` ni `FINISHED` (un tournoi
    // fini reste calculé fini). Les deux départs comptent, et le second n'est
    // même pas le plus courant : entre la clôture des inscriptions et l'heure de
    // début, un tournoi **repasse par `UPCOMING`** — c'est de là qu'il part le
    // plus souvent, comme le note déjà le journal quelques lignes plus bas.
    // Exiger `REGISTRATION` privait donc la ronde suisse, la survie, la BG
    // Survie et le multi-phases de leur initialisation dès que la clôture et le
    // début n'étaient pas simultanés : classement jamais semé, aucune manche
    // générée, et un tournoi « en cours » qui n'a rien à jouer. Les formats à
    // plateau y échappaient seuls, `createBracketIfMissing` les rattrapant dans
    // l'entretien ci-dessous.
    const isStarting = computed === "RUNNING";

    const isSwissStart = isStarting && tournament.format === "SWISS";
    if (isSwissStart) {
      const { initializeSwissTournament, generateSwissRound } = await import("./swiss");
      await initializeSwissTournament(tournamentId, connection);
      await generateSwissRound(tournamentId, connection);
    }

    const isSurvivalStart = isStarting && tournament.format === "SURVIVAL";
    if (isSurvivalStart) {
      const { initializeSurvivalTournament, generateSurvivalRound } = await import("./survival");
      await initializeSurvivalTournament(tournamentId, connection);
      await generateSurvivalRound(tournamentId, connection);
    }

    const isEnduranceStart = isStarting && tournament.format === "BG_SURVIE";
    if (isEnduranceStart) {
      const { initializeEnduranceTournament, generateEnduranceRound } = await import("./bg-survie");
      await initializeEnduranceTournament(tournamentId, connection);
      await generateEnduranceRound(tournamentId, connection);
    }

    const isMultiStart = isStarting && tournament.format === "MULTI";
    if (isMultiStart) {
      const { initializeMultiTournament } = await import("./phases");
      await initializeMultiTournament(tournamentId, connection);
    }

    await updateTournamentState(connection, tournamentId, computed);
    tournament.state = computed;
    stateChanged = true;

    // Coup d'envoi : la seule bascule d'état qui vaille une ligne de journal.
    // La condition ne porte pas sur `isStarting` mais sur l'état d'arrivée : un
    // tournoi repasse par `UPCOMING` entre la clôture des inscriptions et son
    // heure de début, et c'est donc de là qu'il part « en cours » le plus
    // souvent.
    // L'ouverture des inscriptions se lit sur la page et se déduit des dates
    // annoncées ; le passage « en cours », lui, est le moment où le staff a
    // quelque chose à surveiller. La clôture est journalisée par
    // `finishTournament`, quel que soit le format qui la décide.
    if (computed === "RUNNING") {
      queueBotLog(connection, { kind: "tournament_started", tournamentId });
    }

    // Après passage en RUNNING : clôture immédiate si départ à ≤ 1 équipe.
    if (isSurvivalStart) {
      const { reconcileSurvival } = await import("./survival");
      await reconcileSurvival(tournamentId, connection);
    }
    if (isSwissStart) {
      const { reconcileSwiss } = await import("./swiss");
      await reconcileSwiss(tournamentId, connection);
    }

    if (isEnduranceStart) {
      const { reconcileEndurance } = await import("./bg-survie");
      await reconcileEndurance(tournamentId, connection);
    }

    if (isMultiStart) {
      const { reconcilePhases } = await import("./phases");
      await reconcilePhases(tournamentId, connection);
    }
  }

  // Entretien passif d'un tournoi en cours. Ce bloc existait avant le découpage
  // du service en modules et avait disparu au passage : sans lui, un tournoi à
  // élimination n'obtient jamais son plateau (`bracket_size` reste NULL, aucun
  // match), les byes ne se résolvent pas et un report de score dont le délai a
  // expiré n'est jamais tranché — alors que `getTournamentDetail` déclenche
  // justement cette synchronisation pour ces trois raisons.
  if (tournament.state === "RUNNING") {
    // Réservé aux formats à plateau : la survie, la ronde suisse et le
    // multi-phases construisent leurs matchs par leur propre orchestration.
    if (tournament.format === "SINGLE" || tournament.format === "DOUBLE") {
      const { createBracketIfMissing } = await import("./bracket-generator");
      await createBracketIfMissing(connection, tournament);
    }

    const { resolveExpiredScoreReports, finalizeTournamentIfDone } = await import("./finalization");
    const { tryAutoResolveByes } = await import("./byes");

    await resolveExpiredScoreReports(connection, tournamentId);
    await tryAutoResolveByes(connection, tournamentId);
    await finalizeTournamentIfDone(connection, tournamentId);

    // `finalizeTournamentIfDone` a pu passer le tournoi à `FINISHED` : le
    // drapeau posé plus haut ne le sait pas. Sans cette comparaison, un tournoi
    // clos par un bye résolu à la lecture resterait annoncé « En cours » dans la
    // liste en cache — et le reclassement client ne rattrape pas ce cas-là, une
    // clôture ne se déduisant d'aucune date.
    const refreshed = await loadTournamentRow(connection, tournamentId);
    return {
      row: refreshed,
      stateChanged: stateChanged || (refreshed !== null && refreshed.state !== stateAtEntry),
    };
  }

  return { row: tournament, stateChanged };
}

export async function hasPendingStateTransition(row: TournamentRow): Promise<boolean> {
  const currentState = computeTournamentState(row);
  return currentState !== row.state;
}
