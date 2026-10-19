import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/schedule-notices");

import { withConnection } from "@/lib/server/database";
import { setMatchStartAt } from "@/lib/server/tournaments/match-schedule";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { notifyMatchScheduleChange } from "@/lib/server/tournaments/schedule-notices";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

type Row = {
  id: number;
  tournament_id: number;
  status: string;
  team1_id: number | null;
  team2_id: number | null;
  start_at: Date | null;
  launched_at: Date | null;
  launch_pairing: string | null;
  team1_score: number | null;
  team2_score: number | null;
};

function matchRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 42,
    tournament_id: 7,
    status: "READY",
    team1_id: 1,
    team2_id: 2,
    start_at: null,
    launched_at: null,
    launch_pairing: "1:2",
    team1_score: null,
    team2_score: null,
    ...overrides,
  };
}

/** Lecture du tournoi, puis verrous du tournoi et de la manche, notés dans `order`. */
function lockReply(
  sql: string,
  params: unknown,
  {
    row,
    refereeScheduling,
    launchPhase,
    finished,
  }: { row: Row | null; refereeScheduling: boolean; launchPhase: boolean; finished?: boolean },
  order: string[],
): [unknown[]] | null {
  if (sql.startsWith("SELECT tournament_id FROM bg_matches")) {
    order.push("tournament_id");
    return [row ? [{ tournament_id: row.tournament_id }] : []];
  }
  if (sql.startsWith("SELECT referee_scheduling, match_launch_phase, state FROM bg_tournaments")) {
    order.push("lock_tournament");
    expect(sql).toContain("FOR UPDATE");
    expect(params).toEqual([7]);
    return [
      [
        {
          referee_scheduling: refereeScheduling ? 1 : 0,
          match_launch_phase: launchPhase ? 1 : 0,
          state: finished ? "FINISHED" : "RUNNING",
        },
      ],
    ];
  }
  if (sql.startsWith("SELECT id, tournament_id, status")) {
    order.push("lock_match");
    expect(sql).toContain("FOR UPDATE");
    return [row ? [row] : []];
  }
  return null;
}

/**
 * Base simulée : la ligne du match (sous verrou), l'option du tournoi, puis les
 * écritures. Les requêtes sont reconnues à leur texte, pas à leur rang.
 */
function world(
  options: {
    row?: Row | null;
    refereeScheduling?: boolean;
    /** Phase de lancement du tournoi (allumée par défaut). */
    launchPhase?: boolean;
    failReminders?: boolean;
    missingReminders?: boolean;
    announced?: boolean;
    toldStartAt?: Date | null;
    /** Horaire poussé aux arbitres (marque `STAFF`). */
    staffStartAt?: Date | null;
    /** Tournoi clos. */
    finished?: boolean;
  } = {},
) {
  const connection = connectionMock();
  connection.rollback.mockResolvedValue(undefined);
  const row = options.row === undefined ? matchRow() : options.row;
  const writes: { sql: string; params: unknown[] }[] = [];
  /** Ordre des lectures et verrous : tournoi avant manche. */
  const order: string[] = [];
  connection.execute.mockImplementation(async (raw: string, params?: unknown) => {
    const sql = raw.replace(/\s+/g, " ").trim();
    const locked = lockReply(
      sql,
      params,
      {
        row,
        refereeScheduling: options.refereeScheduling === true,
        launchPhase: options.launchPhase !== false,
        finished: options.finished === true,
      },
      order,
    );
    if (locked) return locked;
    if (options.missingReminders && sql.includes("bg_match_reminders")) {
      throw Object.assign(new Error("Table 'bg_match_reminders' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
    }
    if (sql.startsWith("SELECT offset_key, start_at FROM bg_match_reminders")) {
      expect(params).toEqual([42, "TOLD", "STAFF"]);
      const marks: object[] = [];
      if (options.announced) marks.push({ offset_key: "TOLD", start_at: options.toldStartAt ?? null });
      if (options.staffStartAt !== undefined) marks.push({ offset_key: "STAFF", start_at: options.staffStartAt });
      return [marks];
    }
    if (sql.startsWith("DELETE FROM bg_match_reminders") && options.failReminders) {
      throw new Error("base injoignable");
    }
    writes.push({ sql, params: (params as unknown[]) ?? [] });
    return [{ affectedRows: 1 }];
  });
  jest.mocked(withConnection).mockImplementation(async (run) => run(fakeConnection(connection)));
  return { connection, writes, order };
}

const FUTURE = "2099-08-29T18:30:00Z";

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(notifyMatchScheduleChange).mockResolvedValue(undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("setMatchStartAt", () => {
  it("enregistre une date normalisée, sous transaction, et réveille les pages ouvertes", async () => {
    const { connection, writes } = world();

    const result = await setMatchStartAt(42, "2026-08-29T18:30:00Z");

    expect(result).toBe("2026-08-29T18:30:00.000Z");
    const update = writes.find((w) => w.sql.startsWith("UPDATE bg_matches"));
    expect(update?.sql).toMatch(/SET start_at = \?/);
    expect(update?.params[0]).toBeInstanceOf(Date);
    expect((update?.params[0] as Date).toISOString()).toBe("2026-08-29T18:30:00.000Z");
    expect(update?.params[1]).toBe(42);
    expect(connection.beginTransaction).toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
  });

  it("verrouille le tournoi avant la manche, comme toute écriture du moteur", async () => {
    const { connection, order } = world();
    await setMatchStartAt(42, FUTURE);
    expect(order).toEqual(["tournament_id", "lock_tournament", "lock_match"]);
    // Le tournoi est lu avant la transaction : aucune lecture ordinaire n'y précède les verrous.
    const begin = connection.beginTransaction.mock.invocationCallOrder[0];
    const firstRead = connection.execute.mock.invocationCallOrder[0];
    expect(firstRead).toBeLessThan(begin);
  });

  it("retire les millisecondes, que la colonne arrondirait", async () => {
    const { writes } = world();
    expect(await setMatchStartAt(42, "2099-08-29T18:30:00.999Z")).toBe("2099-08-29T18:30:00.000Z");
    const update = writes.find((w) => w.sql.startsWith("UPDATE bg_matches"));
    expect((update?.params[0] as Date).toISOString()).toBe("2099-08-29T18:30:00.000Z");
    expect(notifyMatchScheduleChange).toHaveBeenCalledWith(
      expect.objectContaining({ startAt: "2099-08-29T18:30:00.000Z" }),
    );
  });

  it("rejoue l'écriture qu'un interblocage a annulée", async () => {
    const { connection, writes } = world();
    const base = connection.execute.getMockImplementation();
    let aborted = false;
    connection.execute.mockImplementation(async (sql: string, params?: unknown) => {
      if (!aborted && sql.startsWith("UPDATE bg_matches")) {
        aborted = true;
        throw Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK" });
      }
      return base!(sql, params);
    });

    expect(await setMatchStartAt(42, FUTURE)).toBe("2099-08-29T18:30:00.000Z");
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(writes.filter((w) => w.sql.startsWith("UPDATE bg_matches"))).toHaveLength(1);
  });

  it("accepte la valeur brute d'un champ datetime-local", async () => {
    world();
    const result = await setMatchStartAt(42, "2026-08-29T20:30");
    expect(result).toBe(new Date(2026, 7, 29, 20, 30).toISOString());
  });

  it("efface l'horaire sur null", async () => {
    const { writes } = world({ row: matchRow({ start_at: new Date("2026-08-29T18:30:00Z") }) });

    expect(await setMatchStartAt(42, null)).toBeNull();
    const update = writes.find((w) => w.sql.startsWith("UPDATE bg_matches"));
    expect(update?.params[0]).toBeNull();
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
  });

  it("traite une chaîne vide comme un effacement — le formulaire renvoie « »", async () => {
    const { writes } = world({ row: matchRow({ start_at: new Date("2026-08-29T18:30:00Z") }) });
    expect(await setMatchStartAt(42, "   ")).toBeNull();
    expect(writes.find((w) => w.sql.startsWith("UPDATE bg_matches"))?.params[0]).toBeNull();
  });

  it("efface les paliers quand la date change vraiment, et pose la marque d'observation dans le même geste", async () => {
    const { writes } = world({ row: matchRow({ start_at: new Date("2099-08-29T18:30:00Z") }) });

    await setMatchStartAt(42, "2099-08-30T18:30:00Z");

    // Les marques d'observation et d'horaire reçu survivent au ménage…
    const reminders = writes.find((w) => w.sql.startsWith("DELETE FROM bg_match_reminders"));
    // … comme celle de l'horaire poussé aux arbitres (`STAFF`), qui n'est pas aux joueurs.
    expect(reminders?.sql).toContain("offset_key NOT IN (?, ?, ?)");
    expect(reminders?.params).toEqual([42, "SEEN", "TOLD", "STAFF"]);
    // … et l'observation est posée dans le même geste : un balayage concurrent
    // ne peut plus prendre l'annonce pour lui. Posée **avant** le ménage : une
    // insertion après un `DELETE` qui a verrouillé l'intervalle d'index
    // interbloquerait deux programmations de manches voisines.
    // L'observation porte l'horaire qu'elle couvre (un ancien envoi en échec ne
    // rend que les marques du sien).
    const seen = writes.find((w) => w.sql.startsWith("INSERT INTO bg_match_reminders"));
    expect(seen?.sql).toContain("ON DUPLICATE KEY UPDATE start_at = ?");
    expect(seen?.params).toEqual([42, "SEEN", new Date("2099-08-30T18:30:00Z"), new Date("2099-08-30T18:30:00Z")]);
    expect(writes.indexOf(seen!)).toBeLessThan(writes.indexOf(reminders!));
  });

  it("rend l'horaire que les joueurs ont reçu en dernier", async () => {
    world({
      row: matchRow({ start_at: new Date("2099-08-28T18:30:00Z") }),
      announced: true,
      toldStartAt: new Date("2099-08-27T18:30:00Z"),
    });
    await setMatchStartAt(42, FUTURE);
    expect(notifyMatchScheduleChange).toHaveBeenCalledWith(
      expect.objectContaining({ alreadyAnnounced: true, toldStartAt: "2099-08-27T18:30:00.000Z" }),
    );
  });

  it("laisse les marques en place pour une date déjà passée, annoncée à personne", async () => {
    const { writes } = world({ row: matchRow({ start_at: new Date("2099-08-29T18:30:00Z") }), announced: true });
    await setMatchStartAt(42, "2026-01-01T18:30:00Z");
    expect(writes.some((w) => w.sql.includes("bg_match_reminders"))).toBe(false);
  });

  it("garde toutes les marques quand la date revient à l'horaire que les joueurs tiennent", async () => {
    const { writes } = world({
      row: matchRow({ start_at: new Date("2020-09-29T18:30:00Z") }),
      announced: true,
      toldStartAt: new Date(FUTURE),
    });
    await setMatchStartAt(42, FUTURE);
    // Ni ménage général ni marque reposée : le rappel déjà parti pour cet
    // horaire ne repart pas. Seul part un palier daté d'un **autre** horaire
    // (pris pour une date intermédiaire dont l'annonce n'a atteint personne),
    // sans quoi le rappel 24 h de l'horaire rendu sauterait pour de bon.
    const marks = writes.filter((w) => w.sql.includes("bg_match_reminders"));
    expect(marks).toHaveLength(2);
    // L'observation est redatée à l'horaire rendu : un échec tardif de l'avis
    // intermédiaire ne la rend pas.
    // Reposée si elle manque (match à jouer) : le balayage ne réannonce pas l'horaire tenu.
    expect(marks[0].sql).toMatch(/^INSERT INTO bg_match_reminders \(match_id, offset_key, start_at\) VALUES \(\?, \?, \?\)/);
    expect(marks[0].sql).toContain("ON DUPLICATE KEY UPDATE start_at = ?");
    expect(marks[0].params).toEqual([42, "SEEN", new Date(FUTURE), new Date(FUTURE)]);
    expect(marks[1].sql).toMatch(/^DELETE FROM bg_match_reminders/);
    expect(marks[1].sql).toContain("start_at IS NOT NULL AND start_at <> ?");
    expect(marks[1].params).toEqual([42, "SEEN", "TOLD", "STAFF", new Date(FUTURE)]);
  });

  it("garde la marque `TOLD` au ménage d'une date changée", async () => {
    const { writes } = world({ row: matchRow({ start_at: new Date("2099-08-29T18:30:00Z") }), announced: true });

    await setMatchStartAt(42, "2099-08-30T18:30:00Z");

    const cleanup = writes.find((w) => w.sql.startsWith("DELETE FROM bg_match_reminders"));
    expect(cleanup?.params).toContain("TOLD");
    expect(notifyMatchScheduleChange).toHaveBeenCalledWith(expect.objectContaining({ alreadyAnnounced: true }));
  });

  it("laisse le balayage annoncer une manche dont une engagée manque encore", async () => {
    const { writes } = world({ row: matchRow({ team2_id: null, start_at: new Date("2099-08-29T18:30:00Z") }) });

    await setMatchStartAt(42, "2099-08-30T18:30:00Z");

    const reminders = writes.find((w) => w.sql.startsWith("DELETE FROM bg_match_reminders"));
    expect(reminders?.sql).toContain("offset_key NOT IN (?, ?)");
    expect(reminders?.params).toEqual([42, "TOLD", "STAFF"]);
    expect(writes.some((w) => w.sql.startsWith("INSERT IGNORE"))).toBe(false);
  });

  it("laisse les rappels en place quand la date est réécrite à l'identique", async () => {
    const { writes } = world({ row: matchRow({ start_at: new Date("2026-08-29T18:30:00Z") }) });
    await setMatchStartAt(42, "2026-08-29T18:30:00Z");
    expect(writes.some((w) => w.sql.startsWith("DELETE"))).toBe(false);
  });

  it("annonce une première date avec son auteur, après le ménage des rappels", async () => {
    world();
    const actor = { id: 9, pseudo: "Arbitre" };

    await setMatchStartAt(42, FUTURE, actor);

    expect(notifyMatchScheduleChange).toHaveBeenCalledWith({
      matchId: 42,
      startAt: "2099-08-29T18:30:00.000Z",
      previousStartAt: null,
      alreadyAnnounced: false,
      toldStartAt: null,
      staffStartAt: null,
      refereeScheduling: false,
      entrantIds: [1, 2],
      actor,
    });
  });

  it("annonce un changement de date avec l'ancien horaire", async () => {
    world({ row: matchRow({ start_at: new Date("2099-08-28T18:30:00Z") }) });

    await setMatchStartAt(42, FUTURE);

    expect(notifyMatchScheduleChange).toHaveBeenCalledWith({
      matchId: 42,
      startAt: "2099-08-29T18:30:00.000Z",
      previousStartAt: "2099-08-28T18:30:00.000Z",
      alreadyAnnounced: false,
      toldStartAt: null,
      staffStartAt: null,
      refereeScheduling: false,
      entrantIds: [1, 2],
      actor: null,
    });
  });

  it("garde les marques d'une date effacée, et dit si les joueurs l'avaient reçue", async () => {
    const cleared = world({
      row: matchRow({ start_at: new Date("2099-08-28T18:30:00Z") }),
      announced: true,
      refereeScheduling: true,
    });
    await setMatchStartAt(42, null);
    // Seule la citation au programme d'arbitrage part : les arbitres ont reçu
    // le retrait, une date reposée à l'identique doit y reparaître.
    const deletes = cleared.writes.filter((w) => w.sql.startsWith("DELETE FROM bg_match_reminders"));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].sql).toBe("DELETE FROM bg_match_reminders WHERE match_id = ? AND offset_key = ?");
    expect(deletes[0].params).toEqual([42, "REFS"]);
    expect(notifyMatchScheduleChange).toHaveBeenLastCalledWith({
      matchId: 42,
      startAt: null,
      previousStartAt: "2099-08-28T18:30:00.000Z",
      alreadyAnnounced: true,
      toldStartAt: null,
      staffStartAt: null,
      refereeScheduling: true,
      entrantIds: [1, 2],
      actor: null,
    });

    const reset = world({ announced: true });
    await setMatchStartAt(42, FUTURE);
    expect(reset.writes.some((w) => w.sql.startsWith("DELETE FROM bg_match_reminders"))).toBe(true);
    expect(notifyMatchScheduleChange).toHaveBeenLastCalledWith({
      matchId: 42,
      startAt: "2099-08-29T18:30:00.000Z",
      previousStartAt: null,
      alreadyAnnounced: true,
      toldStartAt: null,
      staffStartAt: null,
      refereeScheduling: false,
      entrantIds: [1, 2],
      actor: null,
    });
  });

  it("rend la date même si l'annonce échoue", async () => {
    world();
    jest.mocked(notifyMatchScheduleChange).mockRejectedValue(new Error("bot éteint"));
    await expect(setMatchStartAt(42, FUTURE)).resolves.toBe("2099-08-29T18:30:00.000Z");
  });

  it("lance l'annonce (et sa trace pm2) avant de publier l'évènement, qui peut lever", async () => {
    world();
    jest.mocked(publishMatchUpdatedEvent).mockImplementationOnce(() => {
      throw new Error("publication impossible");
    });
    await expect(setMatchStartAt(42, FUTURE, { id: 9, pseudo: "ArbitreZelé" })).rejects.toThrow("publication impossible");
    expect(notifyMatchScheduleChange).toHaveBeenCalledWith(expect.objectContaining({ actor: { id: 9, pseudo: "ArbitreZelé" } }));
    expect(jest.mocked(notifyMatchScheduleChange).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(publishMatchUpdatedEvent).mock.invocationCallOrder[0],
    );
  });

  it("n'annonce rien pour un match introuvable", async () => {
    world({ row: null });
    await expect(setMatchStartAt(42, FUTURE)).rejects.toThrow("MATCH_NOT_FOUND");
    expect(notifyMatchScheduleChange).not.toHaveBeenCalled();
  });

  it("défait la date quand le ménage des rappels échoue, plutôt qu'un horaire dont personne n'est prévenu", async () => {
    const { connection } = world({ row: matchRow({ start_at: new Date("2099-08-29T18:30:00Z") }), failReminders: true });
    await expect(setMatchStartAt(42, "2099-08-30T18:30:00Z")).rejects.toThrow("base injoignable");
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
    expect(notifyMatchScheduleChange).not.toHaveBeenCalled();
  });

  it("tolère une table des rappels absente : rien à lire ni à effacer", async () => {
    const { connection } = world({ row: matchRow({ start_at: new Date("2026-08-29T18:30:00Z") }), missingReminders: true });
    await expect(setMatchStartAt(42, "2026-08-30T18:30:00Z")).resolves.toBe("2026-08-30T18:30:00.000Z");
    expect(connection.commit).toHaveBeenCalled();
    expect(notifyMatchScheduleChange).toHaveBeenCalledWith(expect.objectContaining({ alreadyAnnounced: false }));
  });

  it("remet les marques à jour avant le commit : un balayage ne voit jamais la nouvelle date avec les anciennes", async () => {
    const { connection } = world({ row: matchRow({ start_at: new Date("2026-08-29T18:30:00Z") }) });
    const order: string[] = [];
    const execute = connection.execute.getMockImplementation()!;
    connection.execute.mockImplementation(async (raw: string, params?: unknown) => {
      if (raw.includes("bg_match_reminders")) order.push("marks");
      return execute(raw, params);
    });
    connection.commit.mockImplementation(async () => {
      order.push("commit");
    });
    await setMatchStartAt(42, "2026-08-30T18:30:00Z");
    expect(order.indexOf("commit")).toBeGreaterThan(order.lastIndexOf("marks"));
  });

  it("refuse une date inexploitable avant même de lire le match", async () => {
    const { connection } = world();
    await expect(setMatchStartAt(42, "demain soir")).rejects.toThrow("INVALID_MATCH_START_AT");
    expect(connection.execute).not.toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse une date hors bornes", async () => {
    const { connection } = world();
    await expect(setMatchStartAt(42, "1970-01-01T00:00:00Z")).rejects.toThrow(
      "INVALID_MATCH_START_AT",
    );
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("signale un match introuvable sans rien écrire, ni ouvrir de transaction", async () => {
    const { connection, writes } = world({ row: null });

    await expect(setMatchStartAt(999, "2026-08-29T18:30:00Z")).rejects.toThrow("MATCH_NOT_FOUND");
    expect(writes).toHaveLength(0);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("rendue à l'horaire tenu sur un match au score saisi, repose aussi l'observation", async () => {
    const { writes } = world({
      row: matchRow({ status: "AWAITING_CONFIRMATION", start_at: new Date("2099-08-28T18:30:00Z") }),
      announced: true,
      toldStartAt: new Date(FUTURE),
    });
    await setMatchStartAt(42, FUTURE);
    // Un passage par un match joué l'a retirée : reposée, elle évite que le
    // balayage réannonce l'horaire tenu si la rencontre revient à jouer.
    const seen = writes.find((w) => w.sql.includes("bg_match_reminders") && w.params.includes("SEEN"));
    expect(seen?.sql).toMatch(/^INSERT INTO bg_match_reminders/);
    expect(seen?.params).toEqual([42, "SEEN", new Date(FUTURE), new Date(FUTURE)]);
  });

  it("ne pose pas d'observation sur un match au score saisi : s'il revient à jouer, le balayage l'annoncera", async () => {
    for (const status of ["AWAITING_CONFIRMATION", "COMPLETED"] as const) {
      const { writes } = world({ row: matchRow({ status, start_at: new Date("2099-08-28T18:30:00Z") }) });
      await setMatchStartAt(42, FUTURE);
      expect(writes.some((w) => w.sql.startsWith("INSERT INTO bg_match_reminders"))).toBe(false);
      const cleanup = writes.find((w) => w.sql.startsWith("DELETE FROM bg_match_reminders"));
      expect(cleanup?.sql).toContain("offset_key NOT IN (?, ?)");
      expect(cleanup?.params).toEqual([42, "TOLD", "STAFF"]);
    }
  });

  it("programme un match déjà joué — la date ne verrouille rien", async () => {
    world({ row: matchRow({ status: "COMPLETED" }) });
    await expect(setMatchStartAt(42, "2020-06-01T12:00:00Z")).resolves.toBe(
      "2020-06-01T12:00:00.000Z",
    );
  });

  describe("remise à zéro du lancement quand le match le quitte", () => {
    const resets = (writes: { sql: string }[]) =>
      writes.some((w) => w.sql.includes("lobby_opened_at = NULL"));

    it("date reportée dans le futur, match non lancé : ouverture et « Prêt » effacés", async () => {
      const { writes } = world();
      await setMatchStartAt(42, FUTURE);
      const update = writes.find((w) => w.sql.startsWith("UPDATE bg_matches"));
      expect(update?.sql).toContain("team1_ready_at = NULL");
      expect(update?.sql).toContain("caster_ready_at = NULL");
      expect(resets(writes)).toBe(true);
      // La notification de départ de ce lancement est réarmée pour la nouvelle heure.
      const notices = writes.find((w) => w.sql.startsWith("DELETE FROM bg_match_start_notices"));
      expect(notices?.params).toEqual([42]);
    });

    it("date effacée, option allumée : le match repasse à planifier, lancement défait", async () => {
      const { writes } = world({
        row: matchRow({ start_at: new Date("2020-01-01T10:00:00Z") }),
        refereeScheduling: true,
      });
      await setMatchStartAt(42, null);
      expect(resets(writes)).toBe(true);
    });

    it("date effacée, option éteinte : le match reste en lancement, rien n'est défait", async () => {
      const { writes } = world({ row: matchRow({ start_at: new Date("2020-01-01T10:00:00Z") }) });
      await setMatchStartAt(42, null);
      expect(resets(writes)).toBe(false);
    });

    it("date passée : le match entre ou reste en lancement, ses « Prêt » restent", async () => {
      const { writes } = world({ refereeScheduling: true });
      await setMatchStartAt(42, "2020-06-01T12:00:00Z");
      expect(resets(writes)).toBe(false);
      expect(writes.some((w) => w.sql.startsWith("DELETE FROM bg_match_start_notices"))).toBe(false);
    });

    it("match déjà lancé : jamais défait, même reporté", async () => {
      const { writes } = world({ row: matchRow({ launched_at: new Date("2026-01-01T10:00:00Z") }) });
      await setMatchStartAt(42, FUTURE);
      expect(resets(writes)).toBe(false);
    });

    it("sans phase de lancement, match lancé d'office puis reporté : lancement défait, score refermé", async () => {
      const { writes } = world({
        row: matchRow({ launched_at: new Date("2026-01-01T10:00:00Z") }),
        launchPhase: false,
      });
      await setMatchStartAt(42, FUTURE);
      const update = writes.find((w) => w.sql.startsWith("UPDATE bg_matches"));
      expect(update?.sql).toContain("launched_at = NULL");
      expect(resets(writes)).toBe(true);
      expect(writes.some((w) => w.sql.startsWith("DELETE FROM bg_match_start_notices"))).toBe(true);
    });

    it("sans phase de lancement, date effacée et option allumée : le match lancé repasse à planifier", async () => {
      const { writes } = world({
        row: matchRow({ start_at: new Date("2020-01-01T10:00:00Z"), launched_at: new Date("2020-01-01T10:00:00Z") }),
        refereeScheduling: true,
        launchPhase: false,
      });
      await setMatchStartAt(42, null);
      expect(resets(writes)).toBe(true);
    });

    it("sans phase de lancement, lancement forcé avant l'heure puis reporté : la nouvelle heure l'emporte", async () => {
      const { writes } = world({
        row: matchRow({ start_at: new Date("2099-08-28T21:00:00Z"), launched_at: new Date("2099-08-28T20:30:00Z") }),
        launchPhase: false,
      });
      await setMatchStartAt(42, FUTURE);
      expect(resets(writes)).toBe(true);
    });

    it("sans phase de lancement, heure déjà retouchée dans le passé puis reportée : lancement défait", async () => {
      // Lancé à 20:00, heure corrigée à 20:25 (toujours passée), puis reporté :
      // `launched_at` antérieur à l'heure d'avant ne le fait pas passer pour forcé.
      const { writes } = world({
        row: matchRow({ start_at: new Date("2026-01-01T20:25:00Z"), launched_at: new Date("2026-01-01T20:00:00Z") }),
        launchPhase: false,
      });
      await setMatchStartAt(42, FUTURE);
      expect(resets(writes)).toBe(true);
    });

    it("sans phase de lancement, même date réenregistrée : rien n'est défait", async () => {
      const { writes } = world({
        row: matchRow({ start_at: new Date(FUTURE), launched_at: new Date("2099-08-29T18:00:00Z") }),
        launchPhase: false,
      });
      await setMatchStartAt(42, FUTURE);
      expect(resets(writes)).toBe(false);
    });

    it("sans phase de lancement, match à planifier lancé de force puis daté à venir : en attente de départ", async () => {
      const { writes } = world({
        row: matchRow({ launched_at: new Date("2026-01-01T10:00:00Z") }),
        refereeScheduling: true,
        launchPhase: false,
      });
      await setMatchStartAt(42, FUTURE);
      expect(resets(writes)).toBe(true);
    });

    it("sans phase de lancement, date passée : le match lancé le reste", async () => {
      const { writes } = world({
        row: matchRow({ launched_at: new Date("2026-01-01T10:00:00Z") }),
        launchPhase: false,
      });
      await setMatchStartAt(42, "2020-06-01T12:00:00Z");
      expect(resets(writes)).toBe(false);
    });

    it("sans phase de lancement, score noté : le match lancé n'est jamais défait", async () => {
      const { writes } = world({
        row: matchRow({ launched_at: new Date("2026-01-01T10:00:00Z"), team1_score: 2, team2_score: 0 }),
        launchPhase: false,
      });
      await setMatchStartAt(42, FUTURE);
      expect(resets(writes)).toBe(false);
      const update = writes.find((w) => w.sql.startsWith("UPDATE bg_matches"));
      expect(update?.sql).not.toContain("launched_at");
    });

    it("lancement posé pour un autre appariement : il ne compte pas, le report le défait", async () => {
      const { writes } = world({
        row: matchRow({ launched_at: new Date("2026-01-01T10:00:00Z"), launch_pairing: "3:4" }),
      });
      await setMatchStartAt(42, FUTURE);
      expect(resets(writes)).toBe(true);
    });

    it("score déjà noté : le match est tenu pour lancé, jamais renvoyé en attente", async () => {
      const { writes } = world({ row: matchRow({ team1_score: 1, team2_score: 0 }) });
      await setMatchStartAt(42, FUTURE);
      const update = writes.find((w) => w.sql.startsWith("UPDATE bg_matches"));
      expect(update?.sql).toContain("launched_at = NOW()");
      expect(update?.sql).toContain("launch_pairing = CONCAT(team1_id, ':', team2_id)");
      expect(resets(writes)).toBe(false);
      expect(writes.some((w) => w.sql.startsWith("DELETE FROM bg_match_start_notices"))).toBe(false);
    });

    it("match sans ses deux engagées : rien à défaire", async () => {
      const { writes } = world({ row: matchRow({ status: "PENDING", team2_id: null }) });
      await setMatchStartAt(42, FUTURE);
      expect(resets(writes)).toBe(false);
    });
  });

  it("lit l'horaire poussé aux arbitres avec celui des joueurs, sous les verrous de l'écriture", async () => {
    world({ row: matchRow({ start_at: new Date("2099-08-28T18:30:00Z") }), staffStartAt: new Date("2099-08-28T18:30:00Z") });
    await setMatchStartAt(42, null);
    expect(jest.mocked(notifyMatchScheduleChange).mock.calls[0][0].staffStartAt).toBe("2099-08-28T18:30:00.000Z");
  });

  it("traite une manche d'un tournoi clos comme jouée : aucune observation posée, rien à rendre ensuite", async () => {
    const { writes } = world({ finished: true });
    await setMatchStartAt(42, FUTURE);
    expect(writes.some((w) => w.sql.startsWith("INSERT INTO bg_match_reminders"))).toBe(false);
    expect(writes.some((w) => w.sql.startsWith("DELETE FROM bg_match_reminders WHERE match_id = ? AND offset_key NOT IN (?, ?)"))).toBe(true);
  });
});
