import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/named-lock", () =>
  jest.requireActual<typeof import("../../helpers/named-lock-passthrough")>("../../helpers/named-lock-passthrough").namedLockPassThrough(),
);
jest.mock("@/lib/server/tournaments/transaction");

import {
  MAINTENANCE_INTERVAL_MS,
  dailySalt,
  recordAudienceViews,
  resetAudienceState,
  runMaintenance,
  startAudienceMaintenanceClock,
} from "@/lib/server/audience-service";
import { getDatabase } from "@/lib/server/database";
import { AUDIENCE_MAX_ENGAGED_MINUTES, fillTemplate, type AudienceView } from "@/lib/shared/audience";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register";
import enAudience from "@/messages/en/audience.json";
import frAudience from "@/messages/fr/audience.json";
import { readSource } from "../../helpers/read-source";
import { fakePool, type SqlMock, type SqlQuery } from "../../helpers/sql-double";

/**
 * Cycle juridique 2 de `feature/stats-page` : l'envoi ne porte pas l'adresse
 * affichée en `Referer`, aucun sel neuf n'est tiré pour un jour clos, chaque
 * échec du nettoyage se journalise, l'entretien tourne aussi sans trafic, et
 * les textes suivent les constantes et les pages non mesurées
 * (`docs/features/AUDIENCE_MEASUREMENT.md`).
 */

const SALT = Buffer.alloc(32, 7);
const ENTRY_ID = "2026-11-statistiques-frequentation-detaillees";
const MINUTES = AUDIENCE_MAX_ENGAGED_MINUTES;

function view(overrides: Partial<AudienceView> = {}): AudienceView {
  const ageMs = overrides.ageMs ?? 0;
  return { pageKey: "home", locale: "fr", device: "mobile", source: "direct", isView: true, engagedMs: 4000, ageMs, openedAgeMs: ageMs, ...overrides };
}

function mockDb(execute: SqlMock) {
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

/** Base vide dont le sel stocké vaut `salt` (`null` : aucun sel en base) ; `failOn` fait échouer les requêtes qui le contiennent. */
function database(salt: Buffer | null = SALT, failOn: readonly string[] = []): SqlMock {
  return jest.fn<SqlQuery>(async (sql: string) => {
    if (failOn.some((part) => sql.includes(part))) throw new Error("db down");
    if (sql.includes("SELECT salt")) return [salt ? [{ salt }] : []];
    if (sql.startsWith("DELETE") || sql.startsWith("INSERT")) return [{ affectedRows: 0 }];
    return [[]];
  });
}

function calls(execute: SqlMock, prefix: string) {
  return execute.mock.calls.filter(([sql]) => sql.startsWith(prefix));
}

beforeEach(() => {
  resetAudienceState();
  jest.clearAllMocks();
});

afterEach(() => {
  resetAudienceState();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("AudienceBeacon — envoi", () => {
  it("send_entries_fetchWithOriginOnlyReferrer", () => {
    const source = readSource("components/audience-beacon.tsx");

    expect(source).toMatch(/fetch\("\/api\/audience", \{[\s\S]*?referrerPolicy: "strict-origin",\s*\}\)/);
    // `no-referrer` ferait partir `Origin: null`, refusé par la garde de provenance.
    expect(source).not.toContain('referrerPolicy: "no-referrer"');
  });
});

describe("dailySalt — jour clos", () => {
  it("dailySalt_dayClosedAtCall_neverInsertsNewSalt", async () => {
    const execute = database();
    mockDb(execute);

    // 2 h à Paris le 17 : le 16 est clos.
    await expect(dailySalt("2026-11-16", new Date("2026-11-17T01:00:00Z"))).resolves.toEqual(SALT);

    expect(calls(execute, "INSERT IGNORE INTO bg_audience_salts")).toHaveLength(0);
  });

  it("dailySalt_dayClosedAndNoStoredSalt_rejects", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(database(null));

    await expect(dailySalt("2026-11-16", new Date("2026-11-17T01:00:00Z"))).rejects.toThrow("audience salt unreadable");
  });
});

describe("runMaintenance — repli raté", () => {
  it("runMaintenance_rollupFails_lateRecordingWithoutSaltDropped", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.useFakeTimers({ now: new Date("2026-11-16T00:20:00Z"), doNotFake: ["setImmediate", "nextTick"] });
    // Sel du 15 effacé par l'entretien raté : la base n'en a plus.
    const execute = database(null, ["GROUP BY day"]);
    const pool = fakePool({ execute });
    mockDb(execute);
    await expect(runMaintenance(new Date("2026-11-16T00:20:00Z"))).rejects.toThrow("db down");
    // Signalement commencé à 1 h 14 à Paris (le 15 ouvert ; page de 23 h 54 le 15), dont la base ne répond qu'à 1 h 21.
    jest.setSystemTime(new Date("2026-11-16T00:14:00Z"));
    jest.mocked(getDatabase).mockImplementation(async () => {
      jest.setSystemTime(new Date("2026-11-16T00:21:00Z"));
      return pool;
    });

    const kept = await recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: [view({ ageMs: 80 * 60_000 })], now: new Date("2026-11-16T00:14:00Z") });

    expect(kept).toBe(0);
    expect(calls(execute, "INSERT IGNORE INTO bg_audience_salts")).toHaveLength(0);
  });

  it("runMaintenance_rollupAndSaltDeleteFail_logsSaltFailure", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(database(SALT, ["GROUP BY day", "DELETE FROM bg_audience_salts"]));

    await expect(runMaintenance(new Date("2026-11-16T12:00:00Z"))).rejects.toThrow("db down");

    expect(errorSpy).toHaveBeenCalledWith("[audience] Sels jusqu'au 2026-11-15 non effacés.", expect.anything());
  });

  it("runMaintenance_purgeFails_logsAndRejects", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(database(SALT, ["DELETE FROM bg_audience_views"]));

    await expect(runMaintenance(new Date("2026-11-16T12:00:00Z"))).rejects.toThrow("db down");

    expect(errorSpy).toHaveBeenCalledWith("[audience] Purge du détail impossible.", expect.anything());
  });
});

describe("startAudienceMaintenanceClock", () => {
  it("startAudienceMaintenanceClock_noTraffic_forgetsClosedSaltAfterInterval", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-17T00:20:00Z") });
    const execute = database();
    mockDb(execute);

    startAudienceMaintenanceClock();
    await jest.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS);

    expect(calls(execute, "DELETE FROM bg_audience_salts")[0]?.[1]).toEqual(["2026-11-16"]);
  });

  it("startAudienceMaintenanceClock_calledTwice_singleInterval", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-17T00:20:00Z") });
    const execute = database();
    mockDb(execute);

    startAudienceMaintenanceClock();
    startAudienceMaintenanceClock();
    await jest.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS);

    expect(calls(execute, "DELETE FROM bg_audience_salts")).toHaveLength(1);
  });
});

describe("instrumentation", () => {
  it("register_nodeRuntime_startsAudienceClock", () => {
    const source = readSource("instrumentation.ts");

    expect(source.indexOf('if (process.env.NEXT_RUNTIME === "nodejs") {')).toBeGreaterThan(-1);
    expect(source.indexOf('if (process.env.NEXT_RUNTIME === "nodejs") {')).toBeLessThan(source.indexOf("startAudienceMaintenanceClock();"));
  });
});

describe("textes — constantes et pages non mesurées", () => {
  it("methodItems_fr_renderMinutesFromConstant", () => {
    const item = fillTemplate(frAudience.method.items[2], { minutes: MINUTES });

    expect(item).toContain(`chacune plafonnée à ${MINUTES} minutes.`);
  });

  it("methodItems_en_renderMinutesFromConstant", () => {
    const item = fillTemplate(enAudience.method.items[2], { minutes: MINUTES });

    expect(item).toContain(`each capped at ${MINUTES} minutes.`);
  });

  it("legalTexts_fr_mentionTournamentCreateEditUnmeasured", () => {
    const entry = PRIVACY_CHANGES.find((change) => change.id === ENTRY_ID)?.details.join(" ") ?? "";

    expect(entry).toContain("dont la création et la modification d'un tournoi");
    expect(readSource("app/rgpd/page.tsx")).toMatch(/dont la création et la\s+modification d&apos;un tournoi/);
    expect(JSON.stringify(PROCESSING_ACTIVITIES)).toContain("dont la création et la modification d'un tournoi");
  });

  it("legalTexts_en_mentionTournamentCreateEditUnmeasured", () => {
    const entry = PRIVACY_CHANGES_EN[ENTRY_ID]?.details.join(" ") ?? "";

    expect(entry).toContain("including creating and editing a tournament");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("(including creating and editing a tournament)");
    expect(JSON.stringify(PROCESSING_ACTIVITIES_EN)).toContain("including creating and editing a tournament");
  });
});
