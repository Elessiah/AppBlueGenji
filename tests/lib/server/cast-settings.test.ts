import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import {
  applyCastSettings,
  applyCastTrigger,
  loadOwnCastSettings,
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
/** Match lancé (ou joué) : tout caster inscrit est montré, sans relire sa condition. */
const LAUNCHED = { game: "OW", beforeLaunch: false } as const;
/** Avant le lancement : la condition du cast dit qui est montré. */
const BEFORE_LAUNCH = { game: "OW", beforeLaunch: true } as const;

describe("setCasterStreamUrl", () => {
  it("setCasterStreamUrl_nullUrlOnOwnStream_throwsStreamUrlRequired", async () => {
    const execute = jest.fn<SqlQuery>();
    execute.mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/voix", staff_owned: 0 }], []]);

    await expect(setCasterStreamUrl(fakeConnection({ execute }), 42, 5, null, 900, false, LAUNCHED)).rejects.toThrow("STREAM_URL_REQUIRED");
    // La seule lecture des streams : aucune écriture.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("setCasterStreamUrl_liveOnlyReplacesOrganisationLink_throwsCastStreamNotOwned", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/org", staff_owned: 0 }], []])
      .mockResolvedValueOnce([[{ link_user_id: null }], []]);

    await expect(setCasterStreamUrl(fakeConnection({ execute }), 42, 5, "https://twitch.tv/moi", 900, false, LAUNCHED)).rejects.toThrow(
      "CAST_STREAM_NOT_OWNED",
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("setCasterStreamUrl_liveOnlyReplacesCoCasterLinkStillOnStream_throwsCastStreamLinkHeld", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/autre", staff_owned: 0 }], []])
      .mockResolvedValueOnce([[{ link_user_id: 901, holder_casts: 1 }], []]);

    await expect(setCasterStreamUrl(fakeConnection({ execute }), 42, 5, "https://twitch.tv/moi", 900, false, LAUNCHED)).rejects.toThrow(
      "CAST_STREAM_LINK_HELD",
    );
    // Fournisseur du lien et sa présence sur le stream : une seule lecture.
    expect(execute.mock.calls[1]).toEqual([expect.stringContaining("EXISTS (SELECT 1 FROM bg_match_casters"), [42, 5]]);
    // Aucune écriture.
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("setCasterStreamUrl_coCasterHiddenBeforeLaunch_shownCasterReplacesLink", async () => {
    // Le fournisseur du lien, devenu inéligible (pas encore retiré), est tu : il ne garde pas son lien.
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/tu", staff_owned: 0 }], []])
      .mockResolvedValueOnce([[{ link_user_id: 901, holder_casts: 1 }], []])
      .mockResolvedValueOnce([[{ user_id: 901, is_deleted: 0, discord_verified_at: null }], []])
      .mockResolvedValue([{ affectedRows: 1 }, []]);

    await setCasterStreamUrl(fakeConnection({ execute }), 42, 5, "https://twitch.tv/moi", 900, false, BEFORE_LAUNCH);

    expect(execute.mock.calls[3]).toEqual([expect.stringContaining("SET live_url = ?"), ["https://twitch.tv/moi", 900, 5]]);
  });

  it("setCasterStreamUrl_coCasterShownBeforeLaunch_throwsCastStreamLinkHeld", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/autre", staff_owned: 0 }], []])
      .mockResolvedValueOnce([[{ link_user_id: 901, holder_casts: 1 }], []])
      .mockResolvedValueOnce([[{ user_id: 901, ...ELIGIBLE }], []]);

    await expect(
      setCasterStreamUrl(fakeConnection({ execute }), 42, 5, "https://twitch.tv/moi", 900, false, BEFORE_LAUNCH),
    ).rejects.toThrow("CAST_STREAM_LINK_HELD");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("setCasterStreamUrl_liveOnlyReplacesLinkOfDepartedCaster_writes", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/parti", staff_owned: 0 }], []])
      .mockResolvedValueOnce([[{ link_user_id: 901, holder_casts: 0 }], []])
      .mockResolvedValue([{ affectedRows: 1 }, []]);

    await setCasterStreamUrl(fakeConnection({ execute }), 42, 5, "https://twitch.tv/moi", 900, false, LAUNCHED);

    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[2]).toEqual([expect.stringContaining("SET live_url = ?"), ["https://twitch.tv/moi", 900, 5]]);
  });

  it("setCasterStreamUrl_liveOnlyReplacesOwnLink_writesWithoutCasterRead", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/ancien", staff_owned: 0 }], []])
      .mockResolvedValueOnce([[{ link_user_id: 900 }], []])
      .mockResolvedValue([{ affectedRows: 1 }, []]);

    await setCasterStreamUrl(fakeConnection({ execute }), 42, 5, "https://twitch.tv/neuf", 900, false, LAUNCHED);

    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[2]).toEqual([expect.stringContaining("SET live_url = ?"), ["https://twitch.tv/neuf", 900, 5]]);
  });

  it("setCasterStreamUrl_staffReplacesCoCasterLinkStillOnStream_throwsCastStreamLinkHeld", async () => {
    // Le staff qui co-caste ne réécrit pas, par la route du caster, la chaîne d'un autre caster.
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/autre", staff_owned: 0 }], []])
      .mockResolvedValueOnce([[{ link_user_id: 901, holder_casts: 1 }], []]);

    await expect(setCasterStreamUrl(fakeConnection({ execute }), 42, 5, "https://twitch.tv/neuf", 900, true, LAUNCHED)).rejects.toThrow(
      "CAST_STREAM_LINK_HELD",
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("setCasterStreamUrl_liveOnlyDressesStreamWithoutLink_writesWithoutHolderRead", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: null, staff_owned: 0 }], []])
      .mockResolvedValue([{ affectedRows: 1 }, []]);

    await setCasterStreamUrl(fakeConnection({ execute }), 42, 5, "https://twitch.tv/moi", 900, false, LAUNCHED);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("setCasterStreamUrl_staffReplacesOrganisationLink_writes", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/org", staff_owned: 0 }], []])
      .mockResolvedValueOnce([[{ link_user_id: null }], []])
      .mockResolvedValue([{ affectedRows: 1 }, []]);

    await setCasterStreamUrl(fakeConnection({ execute }), 42, 5, "https://twitch.tv/neuf", 900, true, LAUNCHED);

    expect(execute.mock.calls[2]).toEqual([expect.stringContaining("SET live_url = ?"), ["https://twitch.tv/neuf", 900, 5]]);
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

    // La seule lecture des casters est celle des casters montrés (la sonde du
    // fournisseur du lien ne relit que lui, dans la lecture du stream).
    const statements = execute.mock.calls.map((call) => String(call[0]));
    expect(statements.filter((sql) => sql.includes("FROM bg_match_casters") && !sql.includes("holder_casts"))).toHaveLength(1);
  });

  it("applyCastSettings_triggerAndLink_judgesShownCasterOnce", async () => {
    // Mode puis lien : le même caster, une seule lecture de sa condition sous le verrou du match.
    const execute = jest.fn<SqlQuery>(async (sql) => {
      const text = String(sql);
      if (text.includes("FROM bg_match_casters mc LEFT JOIN bg_users")) return shownRows(900);
      if (text.startsWith("SELECT 1 FROM bg_match_streams")) return [[], []];
      if (text.includes("FROM bg_match_streams")) return [[{ id: 5, match_id: 42, live_url: null, staff_owned: 0 }], []];
      if (text.startsWith("SELECT")) return [[], []];
      return [{ affectedRows: 1 }, []];
    });
    const row = Object.assign(ownedRow(), {
      live_trigger: null,
      live_trigger_user_id: null,
      casters: [{ matchId: 42, userId: 900, streamId: 5, readyAt: null }],
    });

    await applyCastSettings(fakeConnection({ execute }), row, 900, 5, { trigger: "AUTO", liveUrl: "https://twitch.tv/b" });

    const shownReads = execute.mock.calls.filter(([sql]) => String(sql).includes("FROM bg_match_casters mc LEFT JOIN bg_users"));
    expect(shownReads).toHaveLength(1);
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

describe("loadOwnCastSettings — ce que la fenêtre relit à l'ouverture", () => {
  const ownRow = { stream_id: 5, cast_battletag: null, live_url: "https://twitch.tv/voix", staff_owned: 0 };

  it("loadOwnCastSettings_ownStream_neverReportsOrganisationLink", async () => {
    // Décision D7 du 2026-11-09 : un caster ne dit plus l'origine de son lien, la fenêtre ne la relit plus.
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[ownRow], []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const cast = await loadOwnCastSettings(42, 900);

    expect(cast).toEqual({ streamId: 5, liveUrl: "https://twitch.tv/voix", staffStream: false, battletag: null });
    expect(String(execute.mock.calls[0][0])).not.toContain("link_user_id");
  });

  it("loadOwnCastSettings_notCaster_throwsNotMatchCaster", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(loadOwnCastSettings(42, 900)).rejects.toThrow("NOT_MATCH_CASTER");
  });
});
