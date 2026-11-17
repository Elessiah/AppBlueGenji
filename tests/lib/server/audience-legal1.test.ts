import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/transaction");

import { dailySalt, resetAudienceState, runMaintenance } from "@/lib/server/audience-service";
import { getDatabase } from "@/lib/server/database";
import { BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import {
  AUDIENCE_MAX_ENGAGED_MS,
  AUDIENCE_RAW_RETENTION_MONTHS,
  audienceBeaconPath,
  audiencePageKey,
  type AudienceBeaconEntry,
} from "@/lib/shared/audience";
import { AudienceTracker } from "@/lib/shared/audience-tracker";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { fakePool, type SqlMock, type SqlQuery } from "../../helpers/sql-double";

/**
 * Cycle juridique 1 de `feature/stats-page` : le navigateur n'envoie que
 * l'adresse type du gabarit, les pages du personnel ne sont pas mesurées, le
 * sel d'un jour clos est effacé même si le repli échoue ou si une lecture
 * lente l'écrit après l'entretien, et l'entrée de l'historique suit les
 * constantes (`docs/features/AUDIENCE_MEASUREMENT.md`).
 */

const NOW = new Date("2026-11-16T12:00:00Z");
const SALT = Buffer.alloc(32, 7);
const ENTRY_ID = "2026-11-statistiques-frequentation-detaillees";

/** Une adresse réelle (avec identifiant) de chaque gabarit, et le gabarit attendu. */
const REAL_PATHS: readonly [string, string][] = [
  ["/", "home"],
  ["/regles", "rules"],
  ["/regles/overwatch", "rulesMode"],
  ["/classement", "ranking"],
  ["/tournois", "tournaments"],
  ["/tournois/42", "tournament"],
  ["/tournois/42/matchs/7", "match"],
  ["/tournois/42/inscrits", "tournamentOther"],
  ["/suivre/tournois/42", "follow"],
  ["/equipes", "teams"],
  ["/equipes/17", "team"],
  ["/joueurs", "players"],
  ["/joueurs/pseudo", "player"],
  ["/profil", "profile"],
  ["/connexion", "login"],
  ["/bot/docs", "bot"],
  ["/association", "association"],
  ["/benevoles", "volunteers"],
  ["/recrutement", "recruitment"],
  ["/mentions-legales", "legal"],
  ["/une-page-inconnue", "other"],
];

function mockDb(execute: SqlMock) {
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

/** Base vide ; `failOn` fait échouer les requêtes qui contiennent ce texte. */
function database(failOn: string | null = null): SqlMock {
  return jest.fn<SqlQuery>(async (sql: string) => {
    if (failOn !== null && sql.includes(failOn)) throw new Error("db down");
    if (sql.includes("SELECT salt")) return [[{ salt: SALT }]];
    if (sql.startsWith("DELETE") || sql.startsWith("INSERT IGNORE")) return [{ affectedRows: 0 }];
    return [[]];
  });
}

function calls(execute: SqlMock, prefix: string) {
  return execute.mock.calls.filter(([sql]) => sql.startsWith(prefix));
}

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  resetAudienceState();
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  resetAudienceState();
  jest.restoreAllMocks();
});

describe("audienceBeaconPath", () => {
  it("audienceBeaconPath_playerPage_returnsTemplateWithoutPseudo", () => {
    expect(audienceBeaconPath("/joueurs/Pseudo-Secret")).toBe("/joueurs/0");
  });

  it("audienceBeaconPath_englishTeamPage_keepsLocalePrefix", () => {
    expect(audienceBeaconPath("/en/equipes/12")).toBe("/en/equipes/0");
    expect(audienceBeaconPath("/en")).toBe("/en");
  });

  it.each(REAL_PATHS)("audienceBeaconPath_frenchPage_%s_keepsTemplate_%s", (path, key) => {
    expect(audiencePageKey(audienceBeaconPath(path))).toEqual({ key, locale: "fr" });
  });

  it.each(REAL_PATHS)("audienceBeaconPath_englishPage_%s_keepsTemplate_%s", (path, key) => {
    expect(audiencePageKey(audienceBeaconPath(path === "/" ? "/en" : `/en${path}`))).toEqual({ key, locale: "en" });
  });

  it("audienceBeaconPath_unmeasuredPage_returnsNull", () => {
    expect(audienceBeaconPath("/admin")).toBeNull();
    expect(audienceBeaconPath("/frequentation")).toBeNull();
  });
});

describe("audiencePageKey — pages du personnel", () => {
  it("audiencePageKey_tournamentCreateAndEdit_unmeasured", () => {
    expect(audiencePageKey("/tournois/creer")).toBeNull();
    expect(audiencePageKey("/tournois/12/modifier")).toBeNull();
    expect(audiencePageKey("/en/tournois/12/modifier")).toBeNull();
  });

  it("audiencePageKey_tournamentPage_stillMeasured", () => {
    expect(audiencePageKey("/tournois/12")).toEqual({ key: "tournament", locale: "fr" });
  });
});

describe("AudienceTracker — adresse envoyée", () => {
  let clock = 0;
  let send: jest.Mock<(entries: AudienceBeaconEntry[]) => void>;

  function tracker() {
    return new AudienceTracker({
      now: () => clock,
      isVisible: () => true,
      device: () => "mobile",
      referrerHost: () => null,
      send,
    });
  }

  beforeEach(() => {
    clock = 0;
    send = jest.fn<(entries: AudienceBeaconEntry[]) => void>();
  });

  it("navigate_playerPage_sendsTemplatePathOnly", () => {
    const t = tracker();
    t.navigate("/joueurs/Pseudo-Secret");
    clock = 5000;
    t.leave();

    const sent = send.mock.calls.flatMap(([entries]) => entries);
    expect(sent.map((entry) => entry.p)).toEqual(["/joueurs/0", "/joueurs/0"]);
    expect(JSON.stringify(sent)).not.toContain("Pseudo-Secret");
  });

  it("navigate_staffTournamentEdit_sendsNothing", () => {
    const t = tracker();
    t.navigate("/tournois/12/modifier");
    clock = 5000;
    t.leave();

    expect(send).not.toHaveBeenCalled();
  });
});

describe("runMaintenance — sel et purge sans dépendre du repli", () => {
  it("runMaintenance_rollupFails_stillForgetsSaltsAndPurgesThenRejects", async () => {
    const execute = database("DATE_FORMAT(day");
    mockDb(execute);

    await expect(runMaintenance(NOW)).rejects.toThrow("db down");

    expect(calls(execute, "DELETE FROM bg_audience_salts")[0]?.[1]).toEqual(["2026-11-15"]);
    expect(calls(execute, "DELETE FROM bg_audience_views")).toHaveLength(1);
  });

  it("runMaintenance_purgeFails_rejectsAfterForgettingSalts", async () => {
    const execute = database("DELETE FROM bg_audience_views");
    mockDb(execute);

    await expect(runMaintenance(NOW)).rejects.toThrow("db down");

    expect(calls(execute, "DELETE FROM bg_audience_salts")).toHaveLength(1);
  });
});

describe("dailySalt — lecture finie après la clôture du jour", () => {
  it("dailySalt_readFinishesAfterDayClosed_deletesThatSalt", async () => {
    // Lecture commencée à 23 h à Paris le 1er janvier (jour ouvert), finie trois
    // heures plus tard (le 1er est clos) : le sel tout juste écrit est effacé.
    jest.useFakeTimers({ now: new Date("2026-01-01T22:00:00Z"), doNotFake: ["setImmediate"] });
    const base = database();
    const execute = jest.fn<SqlQuery>(async (sql: string, params?: unknown) => {
      if (sql.startsWith("INSERT IGNORE")) jest.setSystemTime(new Date("2026-01-02T01:00:00Z"));
      return base(sql, params);
    });
    mockDb(execute);

    await dailySalt("2026-01-01", new Date("2026-01-01T22:00:00Z"));
    await flushPromises();

    expect(calls(execute, "INSERT IGNORE INTO bg_audience_salts")).toHaveLength(1);
    expect(calls(execute, "DELETE FROM bg_audience_salts WHERE day <= ?").map(([, params]) => params)).toEqual([["2026-01-01"]]);
    jest.useRealTimers();
  });

  it("dailySalt_openDay_neverDeletesSalt", async () => {
    const execute = database();
    mockDb(execute);

    await dailySalt("2026-11-16", NOW);
    await flushPromises();

    expect(calls(execute, "DELETE FROM bg_audience_salts")).toHaveLength(0);
  });
});

describe("historique — l'entrée suit les constantes", () => {
  it("statsEntry_fr_interpolatesCurrentConstants", () => {
    const details = PRIVACY_CHANGES.find((change) => change.id === ENTRY_ID)?.details.join(" ") ?? "";

    expect(details).toContain(`chacune plafonnée à ${AUDIENCE_MAX_ENGAGED_MS / 60_000} minutes`);
    expect(details).toContain(`${BACKUP_RETENTION_DAYS} jours au plus`);
    expect(details).toContain(`au bout de ${AUDIENCE_RAW_RETENTION_MONTHS} mois`);
    expect(details).not.toContain("par page");
  });

  it("statsEntry_en_interpolatesCurrentConstants", () => {
    const details = PRIVACY_CHANGES_EN[ENTRY_ID]?.details.join(" ") ?? "";

    expect(details).toContain(`each capped at ${AUDIENCE_MAX_ENGAGED_MS / 60_000} minutes`);
    expect(details).toContain(`${BACKUP_RETENTION_DAYS} days at most`);
    expect(details).toContain(`after ${AUDIENCE_RAW_RETENTION_MONTHS} months`);
    expect(details).not.toContain("per page");
  });
});
