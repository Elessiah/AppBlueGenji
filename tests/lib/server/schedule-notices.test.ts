import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/tournaments/match-reminders");
// Seules les écritures de la marque `STAFF` sont simulées.
jest.mock("@/lib/server/tournaments/reminder-marks", () => ({
  ...jest.requireActual<typeof import("@/lib/server/tournaments/reminder-marks")>(
    "@/lib/server/tournaments/reminder-marks",
  ),
  markStaffPushed: jest.fn(),
  forgetStaffPush: jest.fn(),
}));

import { getDatabase } from "@/lib/server/database";
import { forgetStaffPush, markStaffPushed } from "@/lib/server/tournaments/reminder-marks";
import { notifyStaff } from "@/lib/server/notify";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { announceMatchSchedule, announceMatchScheduleCleared } from "@/lib/server/tournaments/match-reminders";
import {
  heldStartAt,
  clearedHeldStartAt,
  isAnnounceableSchedule,
  refereesWerePushed,
  notifyMatchScheduleChange,
  playerAnnouncement,
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
  start_at: new Date(NEW_START),
  team1_id: 101,
  team2_id: 102,
  team1_name: "Les Renards",
  team2_name: "Team Nova",
  status: "READY",
};

/** La manche relue après un retrait : plus d'horaire. */
const CLEARED_ROW = { ...ROW, start_at: null };

function change(overrides: Partial<MatchScheduleChange> = {}): MatchScheduleChange {
  return {
    matchId: 42,
    startAt: NEW_START,
    previousStartAt: null,
    alreadyAnnounced: false,
    toldStartAt: null,
    staffStartAt: null,
    refereeScheduling: true,
    entrantIds: [101, 102],
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

    expect(announceMatchSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), { rescheduled: false, previousStartAt: null });
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    expect(staffCall().topic).toBe("MATCH_SCHEDULED");
    expect(staffCall().excludeUserIds).toEqual([9]);
    // Pas de message privé au rôle arbitre : une ligne de journal suffit.
    expect(staffCall().discord).toBeUndefined();

    const fr = resolvePush(staffCall().push);
    expect(fr.title).toBe("Match programmé");
    expect(fr.body).toContain("Les Renards contre Team Nova · Coupe BlueGenji, Tableau perdants · manche 2");
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
    expect(line).toContain("Tableau perdants · manche 2 — Les Renards vs Team Nova (#42)");
    expect(line).toContain("(heure de Paris)");
    expect(line).toContain("par le staff");
    expect(line).not.toContain("au lieu du");
    expect(line).not.toContain(ACTOR.pseudo);
  });
});

describe("notifyMatchScheduleChange — ronde suisse", () => {
  it("dit « Ronde N » au journal et aux arbitres, \"Round N\" en anglais", async () => {
    const execute = mockMatch({ ...ROW, bracket: "UPPER", swiss_round: 1 });

    await notifyMatchScheduleChange(change());

    expect(String(execute.mock.calls[0][0])).toContain("AS swiss_round");
    expect(logLine()).toContain("Ronde 2 — Les Renards vs Team Nova (#42)");
    expect(resolvePush(staffCall().push).body).toContain("Coupe BlueGenji, Ronde 2");
    expect(resolvePush(staffCall().push, "en").body).toContain("Coupe BlueGenji, Round 2");
  });

  it("garde « Manche N » hors ronde suisse", async () => {
    mockMatch({ ...ROW, bracket: "UPPER", swiss_round: 0 });

    await notifyMatchScheduleChange(change());

    expect(logLine()).toContain("Manche 2 — Les Renards vs Team Nova (#42)");
  });
});

describe("notifyMatchScheduleChange — date changée", () => {
  it("dit « reprogrammé » partout et rappelle l'ancien horaire au journal", async () => {
    mockMatch();

    await notifyMatchScheduleChange(change({ previousStartAt: OLD_START, alreadyAnnounced: true, toldStartAt: OLD_START }));

    expect(announceMatchSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), { rescheduled: true, previousStartAt: OLD_START });
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

    expect(announceMatchSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), { rescheduled: false, previousStartAt: null });
    expect(resolvePush(staffCall().push).title).toBe("Match reprogrammé");
    expect(resolvePush(staffCall().push).body).toContain(", au lieu du ");
    expect(logLine()).toContain("au lieu du");
  });

  it("dit « reprogrammé » pour une date effacée puis reposée, sans ancienne date à citer", async () => {
    mockMatch();

    await notifyMatchScheduleChange(change({ alreadyAnnounced: true }));

    expect(announceMatchSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), { rescheduled: true, previousStartAt: null });
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

describe("notifyMatchScheduleChange — arbitre engagé dans le match", () => {
  it("ne laisse hors du push arbitre que l'auteur : un arbitre qui joue garde les deux versions", async () => {
    mockMatch();
    await notifyMatchScheduleChange(change());
    expect(staffCall().excludeUserIds).toEqual([ACTOR.id]);
  });
});

describe("notifyMatchScheduleChange — match déjà joué", () => {
  it("journalise une date posée sur un match joué ou au score saisi, sans prévenir les arbitres", async () => {
    for (const status of ["COMPLETED", "AWAITING_CONFIRMATION"]) {
      jest.mocked(publishStaffAction).mockClear();
      mockMatch({ ...ROW, status });
      await notifyMatchScheduleChange(change());
      expect(logLine()).toContain("Match programmé");
    }
    expect(notifyStaff).not.toHaveBeenCalled();
  });
});

describe("notifyMatchScheduleChange — horaire retiré, arbitres", () => {
  it("ne prévient pas les arbitres d'un horaire déjà passé ni d'un match joué", async () => {
    mockMatch(CLEARED_ROW);
    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: "2020-01-01T00:00:00.000Z", alreadyAnnounced: true, toldStartAt: "2020-01-01T00:00:00.000Z" }));
    mockMatch({ ...CLEARED_ROW, status: "COMPLETED" });
    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true, toldStartAt: OLD_START }));
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("ne nomme aucun joueur dans l'avis aux arbitres d'un tournoi individuel", async () => {
    mockMatch({ ...CLEARED_ROW, participant_type: "SOLO", team1_name: "Kiro", team2_name: "Nova" });
    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: OLD_START, staffStartAt: OLD_START }));
    for (const locale of ["fr", "en"] as const) {
      const { title, body } = resolvePush(staffCall().push, locale);
      expect(`${title} ${body}`).not.toMatch(/Kiro|Nova/);
    }
  });
});

describe("playerAnnouncement", () => {
  const now = new Date("2099-01-01T00:00:00Z");

  it("cite l'horaire que les joueurs ont reçu, pas une date intermédiaire jamais envoyée", () => {
    // 21:00 reçu ; 02:00 saisi de travers (passé, seulement journalisé) ; puis 22:00.
    const told = "2099-01-01T21:00:00.000Z";
    expect(
      playerAnnouncement(
        change({ startAt: "2099-01-01T22:00:00.000Z", previousStartAt: "2098-12-31T02:00:00.000Z", alreadyAnnounced: true, toldStartAt: told }),
        now,
      ),
    ).toEqual({ rescheduled: true, previousStartAt: told });
  });

  it("cite l'ancienne date reçue, encore devant", () => {
    expect(playerAnnouncement(change({ previousStartAt: OLD_START, alreadyAnnounced: true, toldStartAt: OLD_START }), now)).toEqual({
      rescheduled: true,
      previousStartAt: OLD_START,
    });
  });

  it("cite encore une date passée de peu : un match en retard qu'on décale", () => {
    const lateStart = "2098-12-31T20:00:00.000Z"; // quatre heures avant `now`
    expect(playerAnnouncement(change({ previousStartAt: lateStart, alreadyAnnounced: true, toldStartAt: lateStart }), now)).toEqual({
      rescheduled: true,
      previousStartAt: lateStart,
    });
  });

  it("ne cite pas une date d'avant passée depuis longtemps, que les joueurs n'ont jamais reçue", () => {
    expect(
      playerAnnouncement(change({ previousStartAt: "2020-01-01T00:00:00.000Z", alreadyAnnounced: true, toldStartAt: "2020-01-01T00:00:00.000Z" }), now),
    ).toEqual({ rescheduled: true, previousStartAt: null });
  });

  it("dit « programmé » quand rien n'avait été reçu", () => {
    expect(playerAnnouncement(change({ previousStartAt: OLD_START, alreadyAnnounced: false }), now)).toEqual({
      rescheduled: false,
      previousStartAt: null,
    });
  });
});

describe("notifyMatchScheduleChange — horaire rendu à celui que les joueurs tiennent", () => {
  it("ne réannonce rien aux joueurs, mais journalise et prévient les arbitres", async () => {
    mockMatch();
    // 20 h reçu ; mois saisi de travers (passé, journalisé) ; rendu à 20 h.
    await notifyMatchScheduleChange(
      change({ previousStartAt: "2020-09-10T18:00:00.000Z", alreadyAnnounced: true, toldStartAt: NEW_START }),
    );
    expect(announceMatchSchedule).not.toHaveBeenCalled();
    expect(logLine()).toContain("Match reprogrammé");
    expect(notifyStaff).toHaveBeenCalledTimes(1);
  });
});

describe("heldStartAt — après un retrait remis", () => {
  it("ne cite ni ne retire un horaire que les joueurs n'ont jamais reçu", () => {
    const now = new Date("2099-01-01T00:00:00Z");
    // Retrait remis (marque sans horaire), puis une date passée saisie de
    // travers (journalisée seulement), effacée à son tour.
    const mistyped = change({
      startAt: null,
      previousStartAt: "2098-12-31T22:00:00.000Z",
      alreadyAnnounced: true,
      toldStartAt: null,
    });
    expect(heldStartAt(mistyped, now)).toBeNull();
    expect(clearedHeldStartAt(mistyped, now)).toBeNull();
    expect(playerAnnouncement(change({ alreadyAnnounced: true, toldStartAt: null }), now)).toEqual({
      rescheduled: true,
      previousStartAt: null,
    });
  });
});

describe("clearedHeldStartAt", () => {
  const now = new Date("2099-01-01T00:00:00Z");

  it("annonce le retrait de l'horaire d'un match en retard (passé de peu)", () => {
    expect(
      clearedHeldStartAt(
        change({ startAt: null, previousStartAt: "2098-12-31T20:00:00.000Z", alreadyAnnounced: true, toldStartAt: "2098-12-31T20:00:00.000Z" }),
        now,
      ),
    ).toBe("2098-12-31T20:00:00.000Z");
  });

  it("retient un horaire reçu par les joueurs et encore devant", () => {
    expect(clearedHeldStartAt(change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true, toldStartAt: OLD_START }), now)).not.toBeNull();
  });

  it("écarte un horaire jamais reçu, déjà passé, absent, ou une date posée", () => {
    const cleared = { startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true, toldStartAt: OLD_START };
    expect(clearedHeldStartAt(change({ ...cleared, alreadyAnnounced: false }), now)).toBeNull();
    expect(clearedHeldStartAt(change({ ...cleared, previousStartAt: "2020-01-01T00:00:00.000Z", toldStartAt: "2020-01-01T00:00:00.000Z" }), now)).toBeNull();
    expect(clearedHeldStartAt(change({ ...cleared, previousStartAt: null }), now)).toBeNull();
    // Sans planification par l'arbitrage, un match sans horaire part en
    // lancement : aucun « nouvel horaire » ne viendra.
    expect(clearedHeldStartAt(change({ ...cleared, refereeScheduling: false }), now)).toBeNull();
    expect(clearedHeldStartAt(change({ previousStartAt: OLD_START, alreadyAnnounced: true, toldStartAt: OLD_START }), now)).toBeNull();
  });
});

describe("refereesWerePushed", () => {
  const now = new Date("2099-01-01T00:00:00Z");
  const late = "2098-12-31T20:00:00.000Z";

  it("tient pour poussé l'horaire que tient la marque STAFF, devant ou passé de peu", () => {
    expect(refereesWerePushed(change({ startAt: null, previousStartAt: OLD_START, staffStartAt: OLD_START }), now)).toBe(true);
    expect(refereesWerePushed(change({ startAt: null, previousStartAt: late, staffStartAt: late }), now)).toBe(true);
  });

  it("ne tient pas pour poussé un horaire seulement journalisé (match joué, tournoi clos, date passée), un autre, ni un trop ancien", () => {
    // Pas de marque : la date n'a été que journalisée — même encore devant.
    expect(refereesWerePushed(change({ startAt: null, previousStartAt: OLD_START, staffStartAt: null }), now)).toBe(false);
    // La marque tient un autre horaire.
    expect(refereesWerePushed(change({ startAt: null, previousStartAt: OLD_START, staffStartAt: late }), now)).toBe(false);
    const old = "2098-12-30T00:00:00.000Z";
    expect(refereesWerePushed(change({ startAt: null, previousStartAt: old, staffStartAt: old }), now)).toBe(false);
    expect(refereesWerePushed(change({ startAt: null, previousStartAt: null, staffStartAt: OLD_START }), now)).toBe(false);
    expect(refereesWerePushed(change({ startAt: null, previousStartAt: "pas une date", staffStartAt: OLD_START }), now)).toBe(false);
  });
});

describe("marque STAFF", () => {
  it("retient l'horaire poussé aux arbitres, seulement s'il a atteint un appareil", async () => {
    mockMatch();
    await notifyMatchScheduleChange(change());
    expect(markStaffPushed).toHaveBeenCalledWith(42, NEW_START);

    jest.mocked(markStaffPushed).mockClear();
    jest.mocked(notifyStaff).mockResolvedValue({ discord: null, pushed: 0 });
    await notifyMatchScheduleChange(change());
    expect(markStaffPushed).not.toHaveBeenCalled();
  });

  it("oublie l'horaire une fois son retrait poussé, et ne pousse pas le retrait d'un horaire jamais poussé", async () => {
    mockMatch(CLEARED_ROW);
    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: OLD_START, staffStartAt: OLD_START }));
    expect(forgetStaffPush).toHaveBeenCalledWith(42, OLD_START);

    jest.mocked(notifyStaff).mockClear();
    jest.mocked(forgetStaffPush).mockClear();
    mockMatch(CLEARED_ROW);
    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: OLD_START, staffStartAt: null }));
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(forgetStaffPush).not.toHaveBeenCalled();
  });
});

describe("tournoi clos", () => {
  it("lit ses manches comme jouées : journal seul, ni annonce ni push", async () => {
    const execute = mockMatch();
    await notifyMatchScheduleChange(change());
    const [sql] = execute.mock.calls[0] as unknown as [string];
    expect(sql).toMatch(/IF\(t\.state = 'FINISHED', 'COMPLETED', m\.status\) AS status/);
  });
});

describe("notifyMatchScheduleChange — une seule lecture de la manche", () => {
  it("lit la manche une fois pour le journal, les arbitres et les joueurs", async () => {
    const execute = mockMatch();

    await notifyMatchScheduleChange(change());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(announceMatchSchedule).toHaveBeenCalledWith(expect.objectContaining(ROW), expect.anything());
    expect(publishStaffAction).toHaveBeenCalledTimes(1);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
  });

  it("lit la manche une fois pour un horaire retiré", async () => {
    const execute = mockMatch(CLEARED_ROW);

    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true, toldStartAt: OLD_START }));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(announceMatchScheduleCleared).toHaveBeenCalledWith(expect.objectContaining(CLEARED_ROW), OLD_START);
  });

  it("ne lit rien pour une date réécrite à l'identique", async () => {
    const execute = mockMatch();
    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: null }));
    expect(execute).not.toHaveBeenCalled();
  });

  it("n'échoue jamais quand la manche ne peut être lue, et n'annonce rien", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("base injoignable"));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(notifyMatchScheduleChange(change())).resolves.toBeUndefined();

    expect(error).toHaveBeenCalled();
    expect(announceMatchSchedule).not.toHaveBeenCalled();
    expect(notifyStaff).not.toHaveBeenCalled();
    // L'observation posée avec la date est rendue : le balayage annoncera la manche.
    const [sql, params] = execute.mock.calls[1] as unknown as [string, unknown[]];
    expect(sql).toMatch(/^DELETE FROM bg_match_reminders\s+WHERE match_id = \? AND offset_key IN \(\?\) AND start_at <=> \?/);
    expect(params).toEqual([42, "SEEN", new Date(NEW_START)]);
    error.mockRestore();
  });

  it("ne rend pas l'observation d'une date rendue à l'horaire que les joueurs tiennent", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("base injoignable"));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    // `setMatchStartAt` a gardé les marques telles quelles : rien à rendre.
    await notifyMatchScheduleChange(change({ alreadyAnnounced: true, toldStartAt: NEW_START }));

    expect(execute).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("notifyMatchScheduleChange — engagées changées après l'écriture", () => {
  it("laisse l'annonce au balayage quand une place a été remplie entre-temps", async () => {
    mockMatch();
    // Sous le verrou, la seconde place était vide : aucune marque d'observation posée.
    await notifyMatchScheduleChange(change({ entrantIds: [101, null] }));
    expect(announceMatchSchedule).not.toHaveBeenCalled();
    // Journal et arbitres suivent : ils ne dépendent pas des marques.
    expect(publishStaffAction).toHaveBeenCalledTimes(1);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
  });

  it("ne prévient pas d'un retrait une engagée qui a remplacé celle qui l'avait reçu", async () => {
    mockMatch(CLEARED_ROW);
    await notifyMatchScheduleChange(
      change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true, toldStartAt: OLD_START, entrantIds: [101, 999] }),
    );
    expect(announceMatchScheduleCleared).not.toHaveBeenCalled();
    expect(logLine()).toContain("Horaire retiré");
  });
});

describe("notifyMatchScheduleChange — changement déjà remplacé", () => {
  it("laisse joueurs et arbitres au changement plus récent, mais journalise", async () => {
    // Relue, la manche porte déjà l'horaire d'une correction plus récente.
    mockMatch({ ...ROW, start_at: new Date("2099-09-11T18:00:00.000Z") });
    await notifyMatchScheduleChange(change());
    expect(announceMatchSchedule).not.toHaveBeenCalled();
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(logLine()).toContain("Match programmé");
  });

  it("ne prévient pas d'un retrait quand un horaire a été reposé depuis", async () => {
    mockMatch();
    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true, toldStartAt: OLD_START }));
    expect(announceMatchScheduleCleared).not.toHaveBeenCalled();
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(logLine()).toContain("Horaire retiré");
  });
});

describe("notifyMatchScheduleChange — horaire retiré", () => {
  it("prévient les joueurs qui l'avaient reçu, les arbitres sauf l'auteur, et journalise", async () => {
    mockMatch(CLEARED_ROW);

    await notifyMatchScheduleChange(
      change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true, toldStartAt: OLD_START, staffStartAt: OLD_START }),
    );

    expect(announceMatchScheduleCleared).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), OLD_START);
    expect(announceMatchSchedule).not.toHaveBeenCalled();
    expect(staffCall().topic).toBe("MATCH_SCHEDULED");
    expect(staffCall().excludeUserIds).toEqual([ACTOR.id]);
    const push = resolvePush(staffCall().push);
    expect(push.title).toBe("Horaire du match retiré");
    expect(push.body).toMatch(/^L'horaire du .+ \(heure de Paris\) est retiré\. Les Renards contre Team Nova · Coupe BlueGenji, Tableau perdants · manche 2\.$/);
    expect(push.tag).toBe("rencontre-42-schedule");
    expect(resolvePush(staffCall().push, "en").title).toBe("Match time removed");
    expect(publishStaffAction).toHaveBeenCalledWith(expect.any(String), ACTOR);
    const line = logLine();
    expect(line).toMatch(/^🗓️ Horaire retiré — « Coupe BlueGenji » \(#7\)/u);
    expect(line).toContain("Les Renards vs Team Nova (#42), l'horaire du ");
    expect(line).toContain("(heure de Paris) est retiré, par le staff.");
    expect(line).not.toContain(ACTOR.pseudo);
  });

  it("journalise sans prévenir les joueurs d'un horaire qu'ils n'avaient pas reçu", async () => {
    mockMatch(CLEARED_ROW);
    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: false }));
    expect(announceMatchScheduleCleared).not.toHaveBeenCalled();
    expect(logLine()).toContain("Horaire retiré");
  });

  it("ne journalise rien sans auteur, mais prévient les joueurs", async () => {
    mockMatch(CLEARED_ROW);
    await notifyMatchScheduleChange(
      change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true, toldStartAt: OLD_START, actor: null }),
    );
    expect(announceMatchScheduleCleared).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), OLD_START);
    expect(publishStaffAction).not.toHaveBeenCalled();
  });

  it("ne nomme aucun joueur au journal en tournoi individuel", async () => {
    mockMatch({ ...CLEARED_ROW, participant_type: "SOLO", team1_name: "Kiro", team2_name: "Nova" });
    await notifyMatchScheduleChange(change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true, toldStartAt: OLD_START }));
    expect(logLine()).toContain("un joueur vs un joueur");
    expect(logLine()).not.toMatch(/Kiro|Nova/);
  });

  it("n'échoue jamais, même si l'avis aux joueurs échoue", async () => {
    mockMatch(CLEARED_ROW);
    jest.mocked(announceMatchScheduleCleared).mockRejectedValue(new Error("bot éteint"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      notifyMatchScheduleChange(change({ startAt: null, previousStartAt: OLD_START, alreadyAnnounced: true, toldStartAt: OLD_START })),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
