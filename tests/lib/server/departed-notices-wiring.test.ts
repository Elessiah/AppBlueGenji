import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
// Seule la lecture des horaires tenus est simulée ; `withoutSettledLater` reste réel.
jest.mock("@/lib/server/tournaments/departed-notices", () => ({
  ...jest.requireActual<typeof import("@/lib/server/tournaments/departed-notices")>(
    "@/lib/server/tournaments/departed-notices",
  ),
  noteDepartedEntrants: jest.fn(),
  flushDepartedNotices: jest.fn(),
  discardDepartedNotices: jest.fn(),
}));
jest.mock("@/lib/server/tournaments/reminder-marks");

import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import {
  discardDepartedNotices,
  flushDepartedNotices,
  holdDepartures,
  noteDepartedEntrants,
} from "@/lib/server/tournaments/departed-notices";
import { forgetMatchReminders } from "@/lib/server/tournaments/reminder-marks";
import { pushTeamToTarget } from "@/lib/server/tournaments/target-slot";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

/**
 * Avis aux engagées retirées par une correction de score : notés là où une
 * engagée quitte une manche (`pushTeamToTarget`), envoyés ou jetés avec le
 * journal de la transaction (`flushBotLogs` / `discardBotLogs`).
 */
beforeEach(() => {
  jest.clearAllMocks();
});

function slotConnection(previous: { team1_id: number | null; team2_id: number | null }) {
  const mock = connectionMock();
  mock.execute.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT team1_id, team2_id")) return [[previous]];
    if (sql.startsWith("SELECT match_id, start_at")) return [[]];
    return [{ affectedRows: 1 }];
  });
  return fakeConnection(mock);
}

describe("pushTeamToTarget — engagée remplacée", () => {
  it("note l'avis de la sortante, avant d'effacer les marques de la manche", async () => {
    const connection = slotConnection({ team1_id: 7, team2_id: 10 });
    const order: string[] = [];
    jest.mocked(noteDepartedEntrants).mockImplementation(async () => {
      order.push("note");
    });
    jest.mocked(forgetMatchReminders).mockImplementation(async () => {
      order.push("forget");
    });

    await pushTeamToTarget(connection, 2, 1, 9);

    // L'adversaire de l'horaire reçu : l'autre place, lue avant le remplacement.
    expect(noteDepartedEntrants).toHaveBeenCalledWith(connection, [{ matchId: 2, teamId: 7, opponentId: 10 }]);
    expect(order).toEqual(["note", "forget"]);
    // La place se lit sous verrou : le remplacement se décide sur l'état actuel.
    const [sql] = jest.mocked(connection.execute).mock.calls[0] as unknown as [string];
    expect(sql).toMatch(/FOR UPDATE$/);
  });

  it("laisse les marques d'une manche qu'un retour en arrière réglera lui-même", async () => {
    const connection = slotConnection({ team1_id: 7, team2_id: 10 });
    await holdDepartures(connection, [2]);
    await pushTeamToTarget(connection, 2, 1, 9);
    expect(forgetMatchReminders).toHaveBeenCalledWith(connection, []);
  });

  it("ne note rien quand la place était vide, ou garde la même engagée", async () => {
    await pushTeamToTarget(slotConnection({ team1_id: null, team2_id: 10 }), 2, 1, 9);
    await pushTeamToTarget(slotConnection({ team1_id: 9, team2_id: 10 }), 2, 1, 9);
    expect(noteDepartedEntrants).not.toHaveBeenCalled();
  });
});

describe("flushBotLogs / discardBotLogs", () => {
  it("envoient ou jettent les avis notés par la même transaction", () => {
    const connection = fakeConnection({});
    flushBotLogs(connection);
    expect(flushDepartedNotices).toHaveBeenCalledWith(connection);
    discardBotLogs(connection);
    expect(discardDepartedNotices).toHaveBeenCalledWith(connection);
  });
});

describe("une seule implémentation de la pose en aval", () => {
  it("les exemptions passent par le même pushTeamToTarget que le report de score", () => {
    const byes = readFileSync(join(process.cwd(), "lib/server/tournaments/byes.ts"), "utf8");
    expect(byes).toContain('import { pushTeamToTarget } from "./target-slot";');
    expect(byes).not.toMatch(/function pushTeamToTarget\(/);
  });
});

describe("toute suppression de manches par le moteur note d'abord l'avis des engagées", () => {
  /**
   * Une manche supprimée (ronde réappariée, retour en arrière, arbre final
   * refait, plateau périmé) emporte les marques de ses joueurs : sans
   * `noteDeletedMatches` juste avant, une engagée qui tenait un horaire ne
   * saurait jamais qu'il ne vaut plus.
   */
  const FILES = [
    "lib/server/tournaments/swiss.ts",
    "lib/server/tournaments/survival.ts",
    "lib/server/tournaments/bg-survie/reconcile.ts",
    "lib/server/tournaments/bg-survie/playoffs.ts",
    "lib/server/tournaments/bg-survie/playoff-rounds.ts",
    "lib/server/tournaments/rollback.ts",
  ];

  it.each(FILES)("%s", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    const deletes = [...source.matchAll(/DELETE FROM bg_matches WHERE/g)];
    expect(deletes.length).toBeGreaterThan(0);
    for (const match of deletes) {
      const before = source.slice(Math.max(0, (match.index ?? 0) - 1200), match.index);
      expect(before).toContain("noteDeletedMatches(");
    }
  });

  it("le plateau périmé aussi (bracket-generator)", () => {
    const source = readFileSync(join(process.cwd(), "lib/server/tournaments/bracket-generator.ts"), "utf8");
    expect(source).toMatch(/noteDeletedMatches\(connection, "tournament_id = \? AND phase_id = \?"[^;]*;\s*await deletePhaseMatches/);
    expect(source).toMatch(/noteDeletedMatches\(connection, "tournament_id = \?"[^;]*;\s*await deleteAllMatches/);
  });

  it("aucun autre module du moteur ne supprime de manches", () => {
    const root = join(process.cwd(), "lib/server/tournaments");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
    const deleting = walk(root)
      .filter((path) => /DELETE FROM bg_matches WHERE/.test(readFileSync(path, "utf8")))
      .map((path) => relative(process.cwd(), path).split(sep).join("/"))
      .sort((a, b) => a.localeCompare(b));
    // `deletion.ts` supprime le tournoi entier ; `repository.ts` porte les
    // suppressions de plateau, appelées par `bracket-generator.ts`.
    expect(deleting).toEqual(
      [...FILES, "lib/server/tournaments/deletion.ts", "lib/server/tournaments/repository.ts"].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
  });
});
