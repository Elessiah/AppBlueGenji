import { describe, expect, it } from "@jest/globals";
import {
  canToggleRefereeScheduling,
  LAUNCH_PHASE_LABELS,
  matchesToPlan,
  REFEREE_SCHEDULING_DESCRIPTION,
  refereeSchedulingErrorMessage,
  toPlanCountLabel,
} from "@/lib/shared/match-planning";
import { bracketMatch } from "../../helpers/bracket-match";

describe("canToggleRefereeScheduling", () => {
  it("se modifie à tout moment avant la clôture, tournoi en cours compris", () => {
    expect(canToggleRefereeScheduling("UPCOMING")).toBe(true);
    expect(canToggleRefereeScheduling("REGISTRATION")).toBe(true);
    expect(canToggleRefereeScheduling("RUNNING")).toBe(true);
  });

  it("se fige une fois le tournoi terminé", () => {
    expect(canToggleRefereeScheduling("FINISHED")).toBe(false);
  });
});

describe("matchesToPlan", () => {
  const toPlan = bracketMatch({ id: 1, status: "READY", team1Id: 1, team2Id: 2, startAt: null });
  const scheduled = bracketMatch({
    id: 2,
    status: "READY",
    team1Id: 3,
    team2Id: 4,
    startAt: "2099-01-01T10:00:00.000Z",
  });
  const launched = bracketMatch({
    id: 3,
    status: "READY",
    team1Id: 5,
    team2Id: 6,
    startAt: null,
    launchedAt: "2026-01-01T10:00:00.000Z",
  });
  const pending = bracketMatch({ id: 4, status: "PENDING", team1Id: 7, team2Id: null, startAt: null });
  const done = bracketMatch({ id: 5, status: "COMPLETED", team1Id: 1, team2Id: 3, startAt: null });
  const board = [toPlan, scheduled, launched, pending, done];

  it("ne retient que les matchs jouables, sans date et non lancés, dans l'ordre du plateau", () => {
    expect(matchesToPlan(board, true).map((m) => m.id)).toEqual([1]);
  });

  it("est vide quand l'option est éteinte", () => {
    expect(matchesToPlan(board, false)).toEqual([]);
  });

  it("rend les objets reçus, pour que l'appelant ouvre le bon match", () => {
    expect(matchesToPlan(board, true)[0]).toBe(toPlan);
  });
});

describe("libellés", () => {
  it("nomme chaque phase affichée, et tait `NONE`", () => {
    expect(LAUNCH_PHASE_LABELS.TO_PLAN).toBe("À planifier");
    expect(LAUNCH_PHASE_LABELS.SCHEDULED).toBe("En attente de départ");
    expect(LAUNCH_PHASE_LABELS.LOBBY).toBe("Lancement");
    expect(LAUNCH_PHASE_LABELS.LAUNCHED).toBe("Lancé");
    expect(LAUNCH_PHASE_LABELS.NONE).toBeNull();
  });

  it("accorde le décompte", () => {
    expect(toPlanCountLabel(1)).toBe("1 match à planifier");
    expect(toPlanCountLabel(0)).toBe("0 matchs à planifier");
    expect(toPlanCountLabel(4)).toBe("4 matchs à planifier");
  });

  it("décrit les trois étapes de l'option", () => {
    expect(REFEREE_SCHEDULING_DESCRIPTION).toMatch(/À planifier/);
    expect(REFEREE_SCHEDULING_DESCRIPTION).toMatch(/En attente de départ/);
    expect(REFEREE_SCHEDULING_DESCRIPTION).toMatch(/lancement/);
  });
});

describe("refereeSchedulingErrorMessage", () => {
  it("traduit les refus connus", () => {
    expect(refereeSchedulingErrorMessage("TOURNAMENT_FINISHED")).toMatch(/terminé/);
    expect(refereeSchedulingErrorMessage("TOURNAMENT_NOT_FOUND")).toMatch(/introuvable/);
    expect(refereeSchedulingErrorMessage("INVALID_REFEREE_SCHEDULING")).toMatch(/invalide/);
  });

  it("retombe sur une phrase neutre pour le reste, sans relayer le code", () => {
    expect(refereeSchedulingErrorMessage("ER_LOCK_DEADLOCK")).not.toMatch(/ER_/);
    expect(refereeSchedulingErrorMessage(null)).toMatch(/Réessaie/);
    expect(refereeSchedulingErrorMessage("constructor")).toMatch(/Réessaie/);
  });
});
