import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import {
  applyCastSettings,
  applyCastTrigger,
  loadOwnCastSettings,
  setCasterLinkOrigin,
  setCasterStreamUrl,
} from "@/lib/server/tournaments/cast-settings";
import type { LaunchMatchRow } from "@/lib/server/tournaments/match-launch";
import { fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

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

    await expect(setCasterStreamUrl(fakeConnection({ execute }), 42, 5, null, 900, false)).rejects.toThrow("STREAM_URL_REQUIRED");
    // La seule lecture des streams : aucune écriture.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("setCasterStreamUrl_liveOnlyReplacesOrganisationLink_throwsCastStreamNotOwned", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/org", staff_owned: 0 }], []])
      .mockResolvedValueOnce([[{ link_user_id: null }], []]);

    await expect(setCasterStreamUrl(fakeConnection({ execute }), 42, 5, "https://twitch.tv/moi", 900, false)).rejects.toThrow(
      "CAST_STREAM_NOT_OWNED",
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("setCasterStreamUrl_staffReplacesOrganisationLink_writes", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/org", staff_owned: 0 }], []])
      .mockResolvedValue([{ affectedRows: 1 }, []]);

    await setCasterStreamUrl(fakeConnection({ execute }), 42, 5, "https://twitch.tv/neuf", 900, true);

    expect(execute.mock.calls[1]).toEqual([expect.stringContaining("SET live_url = ?"), ["https://twitch.tv/neuf", 900, 5]]);
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

  it("applyCastTrigger_designatedReferee_changesTriggerKeepingCasterOwner", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(12)).mockResolvedValue([{ affectedRows: 1 }, []]);
    const row = ownedRow();

    await applyCastTrigger(fakeConnection({ execute }), row, "AUTO", 9, { oversees: false, manages: true });

    // Hors des casters, il médie : le mode reste au caster qui l'a posé.
    expect(execute.mock.calls[1][1]).toEqual(["AUTO", 12, 42]);
    expect(row.live_trigger).toBe("AUTO");
  });

  it("applyCastTrigger_castingRefereeChangesCasterMode_keepsCasterOwner", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(12, 9)).mockResolvedValue([{ affectedRows: 1 }, []]);

    await applyCastTrigger(fakeConnection({ execute }), ownedRow(), "AUTO", 9, { oversees: false, manages: true });

    expect(execute.mock.calls[1][1]).toEqual(["AUTO", 12, 42]);
  });

  it("applyCastTrigger_refereeOnAwaitingConfirmation_refusedNotOwned", async () => {
    // Score déclaré : la médiation est close, comme sur la route du staff.
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(12));
    const row = Object.assign(ownedRow(), { status: "AWAITING_CONFIRMATION" });

    await expect(
      applyCastTrigger(fakeConnection({ execute }), row, null, 9, { oversees: false, manages: true }),
    ).rejects.toThrow("LIVE_TRIGGER_NOT_OWNED");
  });

  it("applyCastTrigger_ineligibleReferee_refused", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(12));
    const row = Object.assign(ownedRow(), { refereeEligible: false });

    await expect(
      applyCastTrigger(fakeConnection({ execute }), row, "AUTO", 9, { oversees: false, manages: true }),
    ).rejects.toThrow("LIVE_TRIGGER_NOT_OWNED");
  });
});

describe("applyCastTrigger — inscription et maître tu", () => {
  it("applyCastTrigger_shownCasterRemovesOwnerlessMode_throwsNotOwned", async () => {
    // Décision du 2026-11-09 : un mode sans maître ne se démarque que par l'arbitre ou le staff.
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(13));
    const row = { ...ownedRow(), live_trigger: "AUTO", live_trigger_user_id: null } as LaunchMatchRow;

    await expect(applyCastTrigger(fakeConnection({ execute }), row, null, 13)).rejects.toThrow("LIVE_TRIGGER_NOT_OWNED");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("applyCastTrigger_liveOnlyShownOnStaffModeWithLink_throwsStaffStreamForbidden", async () => {
    // Décision 1 du 2026-11-09 : le mode du staff qui porte le lien de l'organisation n'est pas à la seule `live`.
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(13)).mockResolvedValueOnce([[{ 1: 1 }], []]);
    const row = { ...ownedRow(), live_trigger: "AUTO", live_trigger_user_id: null } as LaunchMatchRow;

    await expect(applyCastTrigger(fakeConnection({ execute }), row, "MANUAL", 13)).rejects.toThrow("STAFF_STREAM_FORBIDDEN");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("applyCastTrigger_liveOnlyShownOnStaffModeWithLinkAndSkip_returnsFalse", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(13)).mockResolvedValueOnce([[{ 1: 1 }], []]);
    const row = { ...ownedRow(), live_trigger: "AUTO", live_trigger_user_id: null } as LaunchMatchRow;

    await expect(applyCastTrigger(fakeConnection({ execute }), row, "MANUAL", 13, undefined, true)).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("applyCastTrigger_notAllowedWithSkip_returnsFalseWithoutWrite", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(12, 13));
    const row = ownedRow();

    await expect(applyCastTrigger(fakeConnection({ execute }), row, "AUTO", 13, undefined, true)).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(row.live_trigger).toBe("MANUAL");
  });

  it("applyCastTrigger_unchangedTriggerOnNonCastableMatch_throwsMatchNotCastable", async () => {
    // Renvoyé tel quel sur un match joué : le lien qui l'accompagne est refusé avec lui.
    const execute = jest.fn<SqlQuery>();
    const row = Object.assign(ownedRow(), { status: "COMPLETED" });

    await expect(applyCastTrigger(fakeConnection({ execute }), row, "MANUAL", 12)).rejects.toThrow("MATCH_NOT_CASTABLE");
    expect(execute).not.toHaveBeenCalled();
  });

  it("applyCastTrigger_coCasterOnNonCastableMatch_throwsMatchNotCastable", async () => {
    // La vraie raison d'abord : le match ne se caste plus.
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(12, 13));
    const row = Object.assign(ownedRow(), { status: "COMPLETED" });

    await expect(applyCastTrigger(fakeConnection({ execute }), row, "AUTO", 13)).rejects.toThrow("MATCH_NOT_CASTABLE");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("applyCastTrigger_skipOnNonCastableMatch_returnsFalse", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(12, 13));
    const row = Object.assign(ownedRow(), { status: "COMPLETED" });

    await expect(applyCastTrigger(fakeConnection({ execute }), row, "AUTO", 13, undefined, true)).resolves.toBe(false);
  });

  it("applyCastTrigger_hiddenOwner_staffCasterTakesMode", async () => {
    // Le maître 12 n'est plus montré : le mode revient au staff, dont 13, qui le caste.
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows(13)).mockResolvedValue([{ affectedRows: 1 }, []]);
    const row = ownedRow();

    await expect(applyCastTrigger(fakeConnection({ execute }), row, "AUTO", 13, { oversees: false, manages: true })).resolves.toBe(true);
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
    // Caster montré, puis lecture des streams.
    execute.mockResolvedValueOnce(shownRows(900));
    execute.mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/a", staff_owned: 0 }], []]);
    // Attribution du lien en place : le sien.
    execute.mockResolvedValueOnce([[{ link_user_id: 900 }], []]);
    execute.mockResolvedValue([{ affectedRows: 1 }, []]);
    const row = { id: 42, casters: [{ matchId: 42, userId: 900, streamId: 5, readyAt: null }] } as unknown as LaunchMatchRow;

    await applyCastSettings(fakeConnection({ execute }), row, 900, 5, { liveUrl: "https://twitch.tv/b" });

    // La seule lecture des casters est celle des casters montrés.
    const statements = execute.mock.calls.map((call) => String(call[0]));
    expect(statements.filter((sql) => sql.includes("FROM bg_match_casters"))).toHaveLength(1);
  });

  it("applyCastSettings_hiddenCasterSetsLink_throwsNotMatchCaster", async () => {
    // Un caster tu ne réécrit pas le lien public d'un stream qu'il partage.
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(shownRows());
    const row = { ...ownedRow(), casters: [{ matchId: 42, userId: 900, streamId: 5, readyAt: null }] } as LaunchMatchRow;

    await expect(applyCastSettings(fakeConnection({ execute }), row, 900, 5, { liveUrl: "https://twitch.tv/b" })).rejects.toThrow(
      "NOT_MATCH_CASTER",
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

/** Le stream 5 du caster 900, avec son lien. */
const OWN_LINKED = { id: 5, match_id: 42, live_url: "https://twitch.tv/voix", staff_owned: 0 };

/** Lecture de l'attribution du lien (`link_user_id`) du stream 5. */
function heldBy(linkUserId: number | null) {
  return [[{ link_user_id: linkUserId }], []];
}

/** Streams verrouillés, attribution, puis écritures. */
function originDb(linkUserId: number | null) {
  return jest
    .fn<SqlQuery>()
    .mockResolvedValueOnce([[OWN_LINKED], []])
    .mockResolvedValueOnce(heldBy(linkUserId))
    .mockResolvedValue([{ affectedRows: 1 }, []]);
}

const CAST_ROW = { id: 42, casters: [{ matchId: 42, userId: 900, streamId: 5, readyAt: null }] } as unknown as LaunchMatchRow;

describe("setCasterLinkOrigin — l'origine du lien dite seule (décision du 2026-11-09)", () => {
  it("setCasterLinkOrigin_providerToOrganisation_clearsLinkUserId", async () => {
    const execute = originDb(900);

    await setCasterLinkOrigin(fakeConnection({ execute }), 42, 5, null, 900, true);

    expect(execute.mock.calls[2]).toEqual([expect.stringContaining("SET link_user_id = ?"), [null, 5]]);
  });

  it("setCasterLinkOrigin_coCasterToOrganisation_throwsCastStreamNotOwned", async () => {
    const execute = originDb(800);

    await expect(setCasterLinkOrigin(fakeConnection({ execute }), 42, 5, null, 900, true)).rejects.toThrow("CAST_STREAM_NOT_OWNED");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("setCasterLinkOrigin_liveOnlyClaimsOrganisationLink_throwsCastStreamNotOwned", async () => {
    const execute = originDb(null);

    await expect(setCasterLinkOrigin(fakeConnection({ execute }), 42, 5, 900, 900, false)).rejects.toThrow("CAST_STREAM_NOT_OWNED");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("setCasterLinkOrigin_staffReturnsOrganisationLink_attachesToCaller", async () => {
    const execute = originDb(null);

    await setCasterLinkOrigin(fakeConnection({ execute }), 42, 5, 900, 900, true);

    expect(execute.mock.calls[2]).toEqual([expect.stringContaining("SET link_user_id = ?"), [900, 5]]);
  });

  it("setCasterLinkOrigin_originAlreadyAsRequested_writesNothing", async () => {
    const execute = originDb(800);

    await setCasterLinkOrigin(fakeConnection({ execute }), 42, 5, 900, 900, false);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("setCasterLinkOrigin_staffStream_throwsCastStreamNotOwned", async () => {
    const execute = jest.fn<SqlQuery>();
    execute.mockResolvedValueOnce([[{ ...OWN_LINKED, staff_owned: 1 }], []]);

    await expect(setCasterLinkOrigin(fakeConnection({ execute }), 42, 5, null, 900, true)).rejects.toThrow("CAST_STREAM_NOT_OWNED");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("setCasterLinkOrigin_streamWithoutLink_throwsStreamUrlRequired", async () => {
    const execute = jest.fn<SqlQuery>();
    execute.mockResolvedValueOnce([[{ ...OWN_LINKED, live_url: null }], []]);

    await expect(setCasterLinkOrigin(fakeConnection({ execute }), 42, 5, null, 900, true)).rejects.toThrow("STREAM_URL_REQUIRED");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("setCasterLinkOrigin_unknownStream_throwsStreamNotFound", async () => {
    const execute = jest.fn<SqlQuery>();
    execute.mockResolvedValueOnce([[OWN_LINKED], []]);

    await expect(setCasterLinkOrigin(fakeConnection({ execute }), 42, 6, null, 900, true)).rejects.toThrow("STREAM_NOT_FOUND");
  });

  it("applyCastSettings_organisationAloneTrue_setsOriginWithoutRewritingUrl", async () => {
    const execute = originDb(900);

    await applyCastSettings(fakeConnection({ execute }), CAST_ROW, 900, 5, { asOrganisation: true }, { oversees: true, manages: true });

    const statements = execute.mock.calls.map((call) => String(call[0]));
    expect(statements.some((sql) => sql.includes("SET live_url"))).toBe(false);
    expect(execute.mock.calls[2]).toEqual([expect.stringContaining("SET link_user_id = ?"), [null, 5]]);
  });

  it("applyCastSettings_organisationAloneFalse_staffAttachesLinkToCaster", async () => {
    const execute = originDb(null);

    await applyCastSettings(fakeConnection({ execute }), CAST_ROW, 900, 5, { asOrganisation: false }, { oversees: true, manages: true });

    expect(execute.mock.calls[2]).toEqual([expect.stringContaining("SET link_user_id = ?"), [900, 5]]);
  });

  it("applyCastSettings_liveOnlyCoCasterOnOrganisationStream_throwsCastStreamNotOwned", async () => {
    // Un co-caster de la seule `live` ne s'attribue pas le lien de l'organisation.
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce(shownRows(900))
      .mockResolvedValueOnce([[OWN_LINKED], []])
      .mockResolvedValueOnce(heldBy(null));
    const row = { ...ownedRow(), casters: CAST_ROW.casters } as LaunchMatchRow;

    await expect(applyCastSettings(fakeConnection({ execute }), row, 900, 5, { asOrganisation: false })).rejects.toThrow(
      "CAST_STREAM_NOT_OWNED",
    );
  });
});

describe("loadOwnCastSettings — la case relue à l'ouverture", () => {
  const ownRow = { stream_id: 5, cast_battletag: null, live_url: "https://twitch.tv/voix", staff_owned: 0 };

  it("loadOwnCastSettings_linkWithoutOwner_organisationLinkTrue", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ ...ownRow, link_user_id: null }], []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(loadOwnCastSettings(42, 900)).resolves.toMatchObject({ organisationLink: true });
  });

  it("loadOwnCastSettings_linkOwned_organisationLinkFalse", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ ...ownRow, link_user_id: 900 }], []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(loadOwnCastSettings(42, 900)).resolves.toMatchObject({ organisationLink: false });
  });
});
