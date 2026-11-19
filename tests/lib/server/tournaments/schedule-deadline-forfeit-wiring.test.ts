import { describe, expect, it } from "@jest/globals";
import { readSource } from "../../../helpers/read-source";

/**
 * Double forfait d'une date butoir passée (`SCHEDULE_DEADLINE.md` § Échéance) :
 * aucune règle neuve par format. Le forfait passe par la chaîne d'un forfait
 * d'arbitrage (`adminResolveMatch`, `doubleForfeit`), dont chaque moteur est
 * testé (`admin-double-forfeit.test.ts`, `DOUBLE_FORFEIT.md`) ; ce qui se
 * vérifie ici, c'est que le chemin y mène bien, réconciliations comprises.
 */

const index = readSource("lib/server/tournaments/index.ts");
const service = readSource("lib/server/tournaments/schedule-deadline.ts");

function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\nexport ", start + signature.length);
  return source.slice(start, next === -1 ? undefined : next);
}

describe("forfeitMissedScheduleDeadlinePublic", () => {
  it("forfeitMissedScheduleDeadlinePublic_wrapper_runsResolvedPlayerMatchWriteUnderDeadlockRetry", () => {
    const wrapper = body(index, "export async function forfeitMissedScheduleDeadlinePublic(");

    expect(wrapper).toContain("retryOnDeadlock(");
    expect(wrapper).toContain("runPlayerMatchWrite(");
    expect(wrapper).toContain("forfeitMissedScheduleDeadline(connection, tournamentId, matchId, deadlineAt, now)");
    expect(wrapper).toContain('"resolved"');
  });

  it("runPlayerMatchWrite_afterWrite_reconcilesEveryRankedFormatAndFinalizes", () => {
    const write = body(index, "async function runPlayerMatchWrite(");

    expect(write).toContain("reconcileSurvival(tournamentId, connection)");
    expect(write).toContain("reconcileSwiss(tournamentId, connection)");
    // BG_SURVIE : la qualification rejouée depuis l'historique des matchs.
    expect(write).toContain("reconcileEndurance(tournamentId, connection)");
    expect(write).toContain("reconcileMultiPhases(tournamentId, connection)");
    expect(write).toContain("finalizeTournamentIfDone(connection, tournamentId)");
  });

  it("forfeitMissedScheduleDeadlinePublic_preCheckRefuses_noWriteChain", () => {
    const wrapper = body(index, "export async function forfeitMissedScheduleDeadlinePublic(");

    // Contrôle sans verrou avant la chaîne : refusé, ni réconciliations ni clôture.
    expect(wrapper).toContain("if (!(await scheduleDeadlineForfeitDue(tournamentId, matchId, deadlineAt, now))) return false;");
    expect(wrapper.indexOf("scheduleDeadlineForfeitDue(tournamentId")).toBeLessThan(wrapper.indexOf("runPlayerMatchWrite("));
  });

  it("forfeitMissedScheduleDeadline_decision_marksDeadlineForfeitAfterResolve", () => {
    const decision = body(service, "export async function forfeitMissedScheduleDeadline(");

    expect(decision.indexOf("adminResolveMatch(")).toBeLessThan(decision.indexOf("markDeadlineForfeit(connection, matchId)"));
  });

  it("rollback_clearedMatches_pastDeadlineAndNoticesCleared", () => {
    const rollback = readSource("lib/server/tournaments/rollback.ts");
    const clear = body(rollback, "export async function clearPastScheduleDeadlines(");
    const results = body(rollback, "async function clearMatchResults(");

    // Avant l'effacement du résultat : `double_forfeit` désigne encore la rencontre close par la date butoir.
    expect(results.indexOf("await clearPastScheduleDeadlines(connection, ids, now);")).toBeGreaterThan(-1);
    expect(results.indexOf("await clearPastScheduleDeadlines(connection, ids, now);")).toBeLessThan(results.indexOf("double_forfeit = 0"));
    expect(clear).toContain("double_forfeit = 1");
    expect(clear).toContain("schedule_deadline_at <= ?");
    expect(clear).toContain("UPDATE bg_matches SET schedule_deadline_at = NULL");
    expect(clear).toContain("DELETE FROM bg_schedule_deadline_notices");
  });

  it("forfeitMissedScheduleDeadline_decision_usesAdminDoubleForfeit", () => {
    expect(body(service, "export async function forfeitMissedScheduleDeadline(")).toContain(
      "adminResolveMatch(connection, matchId, { doubleForfeit: true })",
    );
  });
});

describe("markDeadlineForfeit", () => {
  const logs = readSource("lib/server/tournaments/bot-logs.ts");

  it("flushBotLogs_markedDeadlineForfeit_entryCarriesFlagToTheLine", () => {
    const flush = body(logs, "export function flushBotLogs(");

    expect(flush).toContain("deadlineForfeitMatches.take(connection)");
    expect(flush).toContain("deadlineForfeit: true");
    expect(logs).toContain("deadlineForfeit: entry.deadlineForfeit === true");
  });

  it("discardBotLogs_failedTransaction_dropsDeadlineForfeitMarks", () => {
    expect(body(logs, "export function discardBotLogs(")).toContain("deadlineForfeitMatches.discard(connection)");
  });
});
