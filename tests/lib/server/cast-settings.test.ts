import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { applyCastSettings, applyCastTrigger, setCasterStreamUrl } from "@/lib/server/tournaments/cast-settings";
import type { LaunchMatchRow } from "@/lib/server/tournaments/match-launch";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * Lien du stream d'un caster (`lib/server/tournaments/cast-settings.ts`,
 * `docs/features/CAST_SETTINGS.md`) : un lien ne s'efface pas, sans quoi le
 * stream du caster deviendrait le premier stream sans lien, que le staff
 * prendrait pour le sien.
 */
describe("setCasterStreamUrl", () => {
  it("setCasterStreamUrl_nullUrlOnOwnStream_throwsStreamUrlRequired", async () => {
    const execute = jest.fn<SqlQuery>();
    execute.mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/voix", staff_owned: 0 }], []]);

    await expect(setCasterStreamUrl(fakeConnection({ execute }), 42, 5, null, 900)).rejects.toThrow("STREAM_URL_REQUIRED");
    // La seule lecture des streams : aucune écriture.
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

/** Match casté en MANUAL par le caster 12, arbitre désigné 9 (éligible). */
function ownedRow() {
  return {
    id: 42,
    tournament_game: "OW",
    launched_at: null,
    status: "READY",
    start_at: null,
    live_trigger: "MANUAL",
    live_trigger_user_id: 12,
    live_started_at: null,
    referee_user_id: 9,
    refereeEligible: true,
    casters: [],
  } as unknown as LaunchMatchRow;
}

/** Compte qui remplit la condition du cast (admin, identités certifiées). */
const ELIGIBLE = {
  discord_verified_at: new Date("2026-01-01T00:00:00Z"),
  discord_pseudo: "voix",
  blizzard_sub: "bnet",
  overwatch_battletag: "Voix#1234",
  overwatch_battletag_typed: 0,
  is_deleted: 0,
  is_admin: 1,
  platform_roles_json: null,
};

/** Lecture des casters montrés : `ids` y castent, éligibles. */
function shownRows(...ids: number[]) {
  return [ids.map((id) => ({ user_id: id, ...ELIGIBLE })), []];
}

describe("applyCastTrigger", () => {
  it("applyCastTrigger_coCaster_throwsNotOwnedWithoutWrite", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(12, 13));

    await expect(applyCastTrigger(fakeConnection({ execute }), ownedRow(), "AUTO", 13)).rejects.toThrow("LIVE_TRIGGER_NOT_OWNED");
    // La seule lecture des casters montrés : aucune écriture.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("applyCastTrigger_designatedReferee_changesTriggerOwnerlessForNonCaster", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(12)).mockResolvedValue([{ affectedRows: 1 }, []]);
    const row = ownedRow();

    await applyCastTrigger(fakeConnection({ execute }), row, "AUTO", 9, { isAdmin: false, manages: true });

    // Hors des casters, il pose le mode sans le tenir.
    expect(execute.mock.calls[1][1]).toEqual(["AUTO", null, 42]);
    expect(row.live_trigger).toBe("AUTO");
  });

  it("applyCastTrigger_refereeOnAwaitingConfirmation_refusedNotOwned", async () => {
    // Score déclaré : la médiation est close, comme sur la route du staff.
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(12));
    const row = Object.assign(ownedRow(), { status: "AWAITING_CONFIRMATION" });

    await expect(
      applyCastTrigger(fakeConnection({ execute }), row, null, 9, { isAdmin: false, manages: true }),
    ).rejects.toThrow("LIVE_TRIGGER_NOT_OWNED");
  });

  it("applyCastTrigger_ineligibleReferee_refused", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(12));
    const row = Object.assign(ownedRow(), { refereeEligible: false });

    await expect(
      applyCastTrigger(fakeConnection({ execute }), row, "AUTO", 9, { isAdmin: false, manages: true }),
    ).rejects.toThrow("LIVE_TRIGGER_NOT_OWNED");
  });
});

describe("applyCastTrigger — inscription et maître tu", () => {
  it("applyCastTrigger_notAllowedWithSkip_returnsFalseWithoutWrite", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(12, 13));
    const row = ownedRow();

    await expect(applyCastTrigger(fakeConnection({ execute }), row, "AUTO", 13, undefined, true)).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(row.live_trigger).toBe("MANUAL");
  });

  it("applyCastTrigger_hiddenOwner_staffCasterTakesMode", async () => {
    // Le maître 12 n'est plus montré : le mode revient au staff, dont 13, qui le caste.
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(13)).mockResolvedValue([{ affectedRows: 1 }, []]);
    const row = ownedRow();

    await expect(applyCastTrigger(fakeConnection({ execute }), row, "AUTO", 13, { isAdmin: false, manages: true })).resolves.toBe(true);
    expect(execute.mock.calls[1][1]).toEqual(["AUTO", 13, 42]);
  });

  it("applyCastSettings_skipLockedTrigger_reportsTriggerSkipped", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(12, 13));

    const outcome = await applyCastSettings(fakeConnection({ execute }), ownedRow(), 13, 5, {
      trigger: "AUTO",
      skipLockedTrigger: true,
    });

    expect(outcome).toEqual({ triggerSkipped: true });
  });
});

describe("applyCastSettings", () => {
  it("applyCastSettings_newLink_doesNotReReadCastersUnderLock", async () => {
    const execute = jest.fn<SqlQuery>();
    // Lecture des streams, puis l'écriture du lien, puis (aucun orphelin) rien d'autre.
    execute.mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/a", staff_owned: 0 }], []]);
    execute.mockResolvedValue([{ affectedRows: 1 }, []]);
    const row = { id: 42, casters: [{ matchId: 42, userId: 900, streamId: 5, readyAt: null }] } as unknown as LaunchMatchRow;

    await applyCastSettings(fakeConnection({ execute }), row, 900, 5, { liveUrl: "https://twitch.tv/b" });

    const statements = execute.mock.calls.map((call) => String(call[0]));
    expect(statements.some((sql) => sql.includes("FROM bg_match_casters"))).toBe(false);
  });
});
