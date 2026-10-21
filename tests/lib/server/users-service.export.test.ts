import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { exportOwnData } from "@/lib/server/users/data-export";
import { type SqlQuery, type SqlMock, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/content-reports", () => ({
  listReportsByAuthor: jest.fn(async () => []),
}));
jest.mock("@/lib/server/terms-acceptance", () =>
  jest.requireActual<typeof import("../../helpers/terms-acceptance-double")>("../../helpers/terms-acceptance-double").termsAcceptanceDouble(),
);
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/connection-logs", () => ({
  listOwnConnectionLogs: jest.fn(async () => [
    { event: "LOGIN_DISCORD", ip: "203.0.113.7", createdAt: "2026-09-01T00:00:00.000Z" },
  ]),
}));
jest.mock("@/lib/server/users/live-announcement-export", () => ({
  listOwnLiveAnnouncements: jest.fn(async () => [{ matchId: 5, tournamentId: 2, sentAt: "2026-10-20T18:00:00.000Z", refused: false }]),
}));
jest.mock("@/lib/server/match-map-entries", () => ({
  listOwnMapEntries: jest.fn(async () => [
    {
      matchId: 5,
      tournamentId: 2,
      source: "FINAL",
      mapNumber: 1,
      replayCode: "ABC123",
      team1Score: 2,
      team2Score: 0,
      submittedAt: "2026-10-06T10:00:00.000Z",
    },
  ]),
}));
jest.mock("@/lib/server/account-suspensions", () => ({
  getActiveSuspension: jest.fn(async () => null),
  listOwnSuspensions: jest.fn(async () => [
    {
      id: 7,
      reason: "Propos haineux répétés en match",
      ground: "BEHAVIOR",
      startsAt: "2026-09-01T10:00:00.000Z",
      endsAt: "2026-09-08T10:00:00.000Z",
      liftedAt: null,
    },
  ]),
}));
jest.mock("@/lib/server/push-subscriptions", () => ({
  exportPushData: jest.fn(async () => ({
    devices: [{ endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "k", auth: "a", createdAt: "2026-09-01T00:00:00.000Z", lastSuccessAt: null }],
    disabledTopics: ["MATCH_REMINDER"],
  })),
}));

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

function exportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    pseudo: "Player",
    avatar_url: "/api/uploads/avatars/x.webp",
    overwatch_battletag: "Player#1234",
    marvel_rivals_tag: null,
    discord_pseudo: "player#0001",
    discord_id: "123456789",
    google_sub: null,
    is_adult: 1,
    is_admin: 0,
    visible_avatar: 0,
    visible_overwatch: 0,
    visible_marvel: 0,
    visible_major: 0,
    visible_discord: 1,
    open_to_recruitment: 1,
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// getFullProfile (appelé en interne) réutilise une ligne bg_users au même format.
function fullProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    pseudo: "Player",
    avatar_url: "/api/uploads/avatars/x.webp",
    overwatch_battletag: "Player#1234",
    marvel_rivals_tag: null,
    discord_pseudo: "player#0001",
    is_adult: 1,
    visible_avatar: 0,
    visible_overwatch: 0,
    visible_marvel: 0,
    visible_major: 0,
    visible_discord: 1,
    open_to_recruitment: 1,
    is_admin: 0,
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("exportOwnData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("includes raw account identifiers reserved to the owner (discord, google, blizzard)", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[exportRow()]]) // identifiants bruts
      .mockResolvedValueOnce([[fullProfileRow()]]) // getFullProfile: user row
      .mockResolvedValueOnce([[]]) // timeline
      .mockResolvedValueOnce([[]]) // stats: appartenances (aucune)
      .mockResolvedValueOnce([[]]); // (inutilisé : le joueur n'a aucune équipe)
    await mockDb(execute);

    const data = await exportOwnData(42);

    // Les appareils abonnés aux notifications push font partie de ce que le
    // site détient : ils sont rendus, clés comprises, avec les sujets coupés.
    expect(data.pushNotifications.devices).toHaveLength(1);
    expect(data.pushNotifications.disabledTopics).toEqual(["MATCH_REMINDER"]);

    // Les suspensions conservées font partie du droit d'accès — sans leur
    // identifiant interne ni qui les a prononcées.
    expect(data.suspensions).toEqual([
      {
        reason: "Propos haineux répétés en match",
        ground: "BEHAVIOR",
        startsAt: "2026-09-01T10:00:00.000Z",
        endsAt: "2026-09-08T10:00:00.000Z",
        liftedAt: null,
      },
    ]);

    // Les maps saisies par le titulaire (codes de replay) font partie du droit d'accès.
    expect(data.liveAnnouncements).toEqual([{ matchId: 5, tournamentId: 2, sentAt: "2026-10-20T18:00:00.000Z", refused: false }]);
    expect(data.mapEntries).toEqual([
      expect.objectContaining({ matchId: 5, source: "FINAL", replayCode: "ABC123" }),
    ]);

    // Le journal des connexions (obligation légale) fait partie du droit d'accès.
    expect(data.connectionLogs).toEqual([
      { event: "LOGIN_DISCORD", ip: "203.0.113.7", createdAt: "2026-09-01T00:00:00.000Z" },
    ]);

    expect(data.account).toMatchObject({
      id: 42,
      discordId: "123456789",
      googleSub: null,
      isAdmin: false,
    });
    expect(data.profile.overwatchBattletag).toBe("Player#1234");
    // Le pseudo n'est plus un réglage de visibilité ; l'ouverture au
    // recrutement, elle, fait partie des données exportées.
    expect(data.profile.visibility).toEqual({
      avatar: false,
      overwatch: false,
      marvel: false,
      major: false,
      // Le réglage exporté est la valeur brute, choix du joueur compris.
      discord: true,
    });
    expect(data.profile.openToRecruitment).toBe(true);
    expect(data.exportedAt).toEqual(expect.any(String));
    // La requête d'identité exclut les comptes supprimés.
    const [selectSql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(selectSql).toMatch(/is_deleted = 0/);
    expect(params).toEqual([42]);
  });

  it("exporte le pseudo tel quel, tous réglages coupés", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[exportRow({ visible_avatar: 0, open_to_recruitment: 0 })]])
      .mockResolvedValueOnce([[fullProfileRow({ visible_avatar: 0, open_to_recruitment: 0 })]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const data = await exportOwnData(42);
    expect(data.account.pseudo).toBe("Player");
  });

  it("rend la langue du compte, français si la ligne n'en porte pas (lot 9-3)", async () => {
    const run = async (locale: unknown) => {
      const execute = jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[exportRow({ locale })]])
        .mockResolvedValueOnce([[fullProfileRow({ locale })]])
        .mockResolvedValue([[]]);
      await mockDb(execute);
      const data = await exportOwnData(42);
      expect(execute.mock.calls[0][0]).toMatch(/\blocale\b/);
      return data.account.locale;
    };
    expect(await run("en")).toBe("en");
    expect(await run("fr")).toBe("fr");
    expect(await run(null)).toBe("fr");
  });

  it("rend le « Ne plus afficher » de la modale du recrutement, non posé par défaut", async () => {
    const run = async (value: unknown) => {
      const execute = jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[exportRow({ recruitment_modal_off: value })]])
        .mockResolvedValueOnce([[fullProfileRow({})]])
        .mockResolvedValue([[]]);
      await mockDb(execute);
      const data = await exportOwnData(42);
      expect(execute.mock.calls[0][0]).toMatch(/\brecruitment_modal_off\b/);
      return [data.account.recruitmentModalOff, data.account.recruitmentModalBackOn];
    };
    expect(await run(1)).toEqual([true, false]);
    expect(await run(0)).toEqual([false, false]);
    expect(await run(null)).toEqual([false, false]);
    // Réaffichée depuis « Mon profil » : rendue aussi.
    expect(await run(2)).toEqual([false, true]);
  });

  it("rend la date du « Ne plus voir » de la fenêtre de certification Discord, null par défaut", async () => {
    const run = async (value: Date | null | undefined) => {
      const execute = jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[exportRow({ discord_certify_prompt_dismissed_at: value })]])
        .mockResolvedValueOnce([[fullProfileRow({})]])
        .mockResolvedValue([[]]);
      await mockDb(execute);
      const data = await exportOwnData(42);
      expect(execute.mock.calls[0][0]).toMatch(/\bdiscord_certify_prompt_dismissed_at\b/);
      return data.account.discordCertifyPromptDismissedAt;
    };
    expect(await run(new Date("2026-10-21T08:00:00.000Z"))).toBe("2026-10-21T08:00:00.000Z");
    expect(await run(null)).toBeNull();
    expect(await run(undefined)).toBeNull();
  });

  it("colonne recruitment_modal_off absente (ALTER échoué) : l'export est rendu quand même, drapeau au défaut", async () => {
    const unknownColumn = Object.assign(new Error("Unknown column 'recruitment_modal_off'"), { code: "ER_BAD_FIELD_ERROR" });
    const execute = jest
      .fn<SqlQuery>()
      .mockRejectedValueOnce(unknownColumn)
      .mockResolvedValueOnce([[exportRow({ recruitment_modal_off: undefined })]])
      .mockResolvedValueOnce([[fullProfileRow({})]])
      .mockResolvedValue([[]]);
    await mockDb(execute);
    const data = await exportOwnData(42);
    expect(data.account.recruitmentModalOff).toBe(false);
    expect(execute.mock.calls[0][0]).toMatch(/recruitment_modal_off/);
    expect(execute.mock.calls[1][0]).not.toMatch(/recruitment_modal_off/);
  });

  it("une autre panne de la lecture du compte n'est pas masquée par le repli", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValueOnce(new Error("down"));
    await mockDb(execute);
    await expect(exportOwnData(42)).rejects.toThrow("down");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("throws PROFILE_NOT_FOUND when the account does not exist or is deleted", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(exportOwnData(999)).rejects.toThrow("PROFILE_NOT_FOUND");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("exportOwnData — plus aucune adresse", () => {
  it("n'expose aucun champ `email` : la colonne n'existe plus", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[exportRow()]])
      .mockResolvedValueOnce([[fullProfileRow()]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const data = await exportOwnData(42);

    expect(Object.keys(data.account)).not.toContain("email");
  });

  it("ne la demande pas non plus en base", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[exportRow()]])
      .mockResolvedValueOnce([[fullProfileRow()]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await exportOwnData(42);

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).not.toContain("email");
  });
});
