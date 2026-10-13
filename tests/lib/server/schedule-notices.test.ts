import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/tournaments/match-reminders");

import { getDatabase } from "@/lib/server/database";
import { notifyStaff } from "@/lib/server/notify";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { announceMatchSchedule, announceMatchScheduleCleared } from "@/lib/server/tournaments/match-reminders";
import {
  isAnnounceableClearing,
  isAnnounceableSchedule,
  notifyMatchScheduleChange,
  type MatchScheduleChange,
} from "@/lib/server/tournaments/schedule-notices";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";
import { resolvePush } from "../../helpers/push";

const ACTOR = { id: 9, pseudo: "ArbitreZelé" };
const NEW_START = "2099-09-10T18:00:00.000Z";
const OLD_START = "2099-09-09T18:00:00.000Z";

const ROW = {
  id: 42,
  tournament_id: 7,
  tournament_name: "Coupe BlueGenji",
  participant_type: "TEAM",
  bracket: "LOWER",
  round_number: 2,
  team1_name: "Les Renards",
  team2_name: "Team Nova",
  status: "READY",
};

function change(overrides: Partial<MatchScheduleChange> = {}): MatchScheduleChange {
  return {
    matchId: 42,
    startAt: NEW_START,
    previousStartAt: null,
    alreadyAnnounced: false,
    refereeScheduling: true,
    actor: ACTOR,
    ...overrides,
  };
}

function mockMatch(row: object | null = ROW) {
  const execute = jest.fn<SqlQuery>().mockResolvedValue([row ? [row] : []]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

function staffCall() {
  return jest.mocked(notifyStaff).mock.calls[0][0];
}

function logLine(): string {
  return jest.mocked(publishStaffAction).mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(announceMatchSchedule).mockResolvedValue(2);
  jest.mocked(announceMatchScheduleCleared).mockResolvedValue(2);
  jest.mocked(notifyStaff).mockResolvedValue({ discord: null, pushed: 1 });
});

describe("isAnnounceableSchedule", () => {
  const now = new Date("2099-01-01T00:00:00Z");

  it("retient une première date et un changement, encore devant", () => {
    expect(isAnnounceableSchedule(change(), now)).toBe(true);
    expect(isAnnounceableSchedule(change({ previousStartAt: OLD_START }), now)).toBe(true);
  });

  it("écarte une date inchangée, effacée ou déjà passée", () => {
    expect(isAnnounceableSchedule(change({ previousStartAt: NEW_START }), now)).toBe(false);
    expect(isAnnounceableSchedule(change({ startAt: null, previousStartAt: OLD_START }), now)).toBe(false);
    expect(isAnnounceableSchedule(change({ startAt: "2020-01-01T00:00:00.000Z" }), now)).toBe(false);
  });
});

describe("notifyMatchScheduleChange — première date", () => {
  it("annonce aux joueurs, prévient les arbitres sauf l'auteur, et journalise", async () => {
    mockMatch();

    await notifyMatchScheduleChange(change());

    expect(announceMatchSchedule).toHaveBeenCalledWith(42, { rescheduled: false, previousStartAt: null });
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    expect(staffCall().topic).toBe("MATCH_SCHEDULED");
    expect(staffCall().excludeUserIds).toEqual([9]);
    // Pas de message privé au rôle arbitre : une ligne de journal suffit.
    expect(staffCall().discord).toBeUndefined();

    const fr = resolvePush(staffCall().push);
    expect(fr.title).toBe("Match programmé");
    expect(fr.body).toContain("Les Renards contre Team Nova · Coupe BlueGenji, Loser bracket · manche 2");
    expect(fr.url).toBe("/tournois/7#match-42");
    const en = resolvePush(staffCall().push, "en");
    expect(en.title).toBe("Match scheduled");
    expect(en.body).toContain("Lower bracket · round 2");
    expect(en.url).toBe("/en/tournois/7#match-42");
  });

  it("écrit une ligne de journal anonyme sur Discord, nommée dans pm2 par son auteur", async () => {
    mockMatch();

    await notifyMatchScheduleChange(change());

    expect(publishStaffAction).toHaveBeenCalledWith(expect.any(String), ACTOR);
    const line = logLine();
    expect(line).toContain("🗓️ Match programmé — « Coupe BlueGenji » (#7)");
    expect(line).toContain("Loser bracket · manche 2 — Les Renards vs Team Nova (#42)");
    expect(line).toContain("(heure de Paris)");
    expect(line).toContain("par le staff");
    expect(line).not.toContain("au lieu du");
    expect(line).not.toContain(ACTOR.pseudo);
  });
});

describe("notifyMatchScheduleChange — date changée", () => {
  it("dit « reprogrammé » partout et rappelle l'ancien horaire au journal", async () => {
    mockMatch();

    await notifyMatchScheduleChange(change({ previousStartAt: OLD_START, alreadyAnnounced: true }));

    expect(announceMatchSchedule).toHaveBeenCalledWith(42, { rescheduled: true, previousStartAt: OLD_START });
    expect(resolvePush(staffCall().push).title).toBe("Match reprogrammé");
    expect(resolvePush(staffCall().push).body).toContain(", au lieu du ");
    expect(resolvePush(staffCall().push, "en").title).toBe("Match rescheduled");
    expect(resolvePush(staffCall().push, "en").body).toContain(", instead of ");
    expect(logLine()).toContain("🗓️ Match reprogrammé");
    expect(logLine()).toContain("au lieu du");
  });

  it("ne cite pas aux joueurs une date qu'ils n'ont jamais reçue, mais la rappelle aux arbitres", async () => {
    mockMatch();

    // Date posée quand une place était encore vide : aucune annonce n'est partie.
    await notifyMatchScheduleChange(change({ previousStartAt: OLD_START, alreadyAnnounced: false }));

    expect(announceMatchSchedule).toHaveBeenCalledWith(42, { rescheduled: false, previousStartAt: null });
    expect(resolvePush(staffCall().push).title).toBe("Match reprogrammé");
    expect(resolvePush(staffCall().push).body).toContain(", au lieu du ");
    expect(logLine()).toContain("au lieu du");
  });

  it("dit « reprogrammé » pour une date effacée puis reposée, sans ancienne date à citer", async () => {
    mockMatch();

    await notifyMatchScheduleChange(change({ alreadyAnnounced: true }));

    expect(announceMatchSchedule).toHaveBeenCalledWith(42, { rescheduled: true, previousStartAt: null });
    expect(resolvePush(staffCall().push).title).toBe("Match reprogrammé");
    expect(resolvePush(staffCall().push).body).not.toContain("au lieu du");
    expect(logLine()).toContain("🗓️ Match reprogrammé");
    expect(logLine()).not.toContain("au lieu du");
  });
});

describe("notifyMatchScheduleChange — rien à annoncer", () => {
  it("se tait pour une date réécrite à l'identique", async () => {
    mockMatch();
    await notifyMatchScheduleChange(change({ previousStartAt: NEW_START }));
    expect(announceMatchSchedule).not.toHaveBeenCalled();
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(publishStaffAction).not.toHaveBeenCalled();
  });

  it("ne fait que journaliser une date posée déjà passée (correction d'archive)", async () => {
    mockMatch();
    await notifyMatchScheduleChange(change({ startAt: "2020-01-01T00:00:00.000Z" }));
    expect(announceMatchSchedule).not.toHaveBeenCalled();
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(logLine()).toContain("🗓️ Match programmé");
  });

  it("se tait pour un effacement sans date d'avant", async () => {
    mockMatch();
    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: null, alreadyAnnounced: true }));
    expect(announceMatchScheduleCleared).not.toHaveBeenCalled();
    expect(publishStaffAction).not.toHaveBeenCalled();
  });

  it("ne prévient pas les arbitres d'une manche disparue", async () => {
    mockMatch(null);
    await notifyMatchScheduleChange(change());
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(publishStaffAction).not.toHaveBeenCalled();
  });
});

describe("notifyMatchScheduleChange — vie privée et cas limites", () => {
  it("ne nomme aucun joueur d'un tournoi individuel, ni sur Discord ni dans le push", async () => {
    mockMatch({ ...ROW, participant_type: "SOLO", team1_name: "Kiro", team2_name: "Nova" });

    await notifyMatchScheduleChange(change());

    expect(logLine()).toContain("un joueur vs un joueur");
    expect(logLine()).not.toMatch(/Kiro|Nova/);
    for (const locale of ["fr", "en"] as const) {
      const { title, body } = resolvePush(staffCall().push, locale);
      expect(`${title} ${body}`).not.toMatch(/Kiro|Nova/);
    }
  });

  it("neutralise un nom d'équipe piégé dans la ligne Discord", async () => {
    mockMatch({ ...ROW, team1_name: "@everyone" });
    await notifyMatchScheduleChange(change());
    expect(logLine()).not.toContain("@everyone vs");
  });

  it("annonce une manche aux places encore vides", async () => {
    mockMatch({ ...ROW, team2_name: null });
    await notifyMatchScheduleChange(change());
    expect(logLine()).toContain("Les Renards vs TBD");
    expect(resolvePush(staffCall().push).body).toContain("Les Renards contre TBD");
  });

  it("ne journalise rien sans auteur, mais prévient tous les arbitres", async () => {
    mockMatch();
    await notifyMatchScheduleChange(change({ actor: null }));
    expect(publishStaffAction).not.toHaveBeenCalled();
    expect(staffCall().excludeUserIds).toEqual([]);
  });

  it("prévient les arbitres même si l'annonce aux joueurs échoue, sans jamais lever", async () => {
    mockMatch();
    jest.mocked(announceMatchSchedule).mockRejectedValue(new Error("bot éteint"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(notifyMatchScheduleChange(change())).resolves.toBeUndefined();

    expect(notifyStaff).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("notifyMatchScheduleChange — match déjà joué", () => {
  it("journalise une date posée sur un match joué, sans prévenir les arbitres", async () => {
    mockMatch({ ...ROW, status: "COMPLETED" });
    await notifyMatchScheduleChange(change());
    expect(logLine()).toContain("Match programmé");
    expect(notifyStaff).not.toHaveBeenCalled();
  });
});

describe("isAnnounceableClearing", () => {
  const now = new Date("2099-01-01T00:00:00Z");

  it("retient un horaire reçu par les joueurs et encore devant", () => {
    expect(isAnnounceableClearing(change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true }), now)).toBe(
      true,
    );
  });

  it("écarte un horaire jamais reçu, déjà passé, absent, ou une date posée", () => {
    const cleared = { startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true };
    expect(isAnnounceableClearing(change({ ...cleared, alreadyAnnounced: false }), now)).toBe(false);
    expect(isAnnounceableClearing(change({ ...cleared, previousStartAt: "2020-01-01T00:00:00.000Z" }), now)).toBe(false);
    expect(isAnnounceableClearing(change({ ...cleared, previousStartAt: null }), now)).toBe(false);
    // Sans planification par l'arbitrage, un match sans horaire part en
    // lancement : aucun « nouvel horaire » ne viendra.
    expect(isAnnounceableClearing(change({ ...cleared, refereeScheduling: false }), now)).toBe(false);
    expect(isAnnounceableClearing(change({ previousStartAt: OLD_START, alreadyAnnounced: true }), now)).toBe(false);
  });
});

describe("notifyMatchScheduleChange — horaire retiré", () => {
  it("prévient les joueurs qui l'avaient reçu et journalise, sans pousser aux arbitres", async () => {
    mockMatch();

    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true }));

    expect(announceMatchScheduleCleared).toHaveBeenCalledWith(42, OLD_START);
    expect(announceMatchSchedule).not.toHaveBeenCalled();
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(publishStaffAction).toHaveBeenCalledWith(expect.any(String), ACTOR);
    const line = logLine();
    expect(line).toMatch(/^🗓️ Horaire retiré — « Coupe BlueGenji » \(#7\)/u);
    expect(line).toContain("Les Renards vs Team Nova (#42), l'horaire du ");
    expect(line).toContain("(heure de Paris) est retiré, par le staff.");
    expect(line).not.toContain(ACTOR.pseudo);
  });

  it("journalise sans prévenir les joueurs d'un horaire qu'ils n'avaient pas reçu", async () => {
    mockMatch();
    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: false }));
    expect(announceMatchScheduleCleared).not.toHaveBeenCalled();
    expect(logLine()).toContain("Horaire retiré");
  });

  it("ne journalise rien sans auteur, mais prévient les joueurs", async () => {
    mockMatch();
    await notifyMatchScheduleChange(
      change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true, actor: null }),
    );
    expect(announceMatchScheduleCleared).toHaveBeenCalledWith(42, OLD_START);
    expect(publishStaffAction).not.toHaveBeenCalled();
  });

  it("ne nomme aucun joueur au journal en tournoi individuel", async () => {
    mockMatch({ ...ROW, participant_type: "SOLO", team1_name: "Kiro", team2_name: "Nova" });
    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true }));
    expect(logLine()).toContain("un joueur vs un joueur");
    expect(logLine()).not.toMatch(/Kiro|Nova/);
  });

  it("n'échoue jamais, même si l'avis aux joueurs échoue", async () => {
    mockMatch();
    jest.mocked(announceMatchScheduleCleared).mockRejectedValue(new Error("bot éteint"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      notifyMatchScheduleChange(change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true })),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
