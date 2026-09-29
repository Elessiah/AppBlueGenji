import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import path from "node:path";

jest.mock("node:fs/promises", () => ({
  rename: jest.fn(async () => undefined),
  copyFile: jest.fn(async () => undefined),
  unlink: jest.fn(async () => undefined),
  mkdir: jest.fn(async () => undefined),
}));
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/avatar-rotation");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://site.test" }));

import { copyFile, rename, unlink } from "node:fs/promises";
import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { rotateHiddenAvatarFile } from "@/lib/server/avatar-rotation";
import {
  avatarFileLocations,
  avatarQuarantineDirectory,
  deleteTeamLogoForReport,
  deleteUserAvatarForReport,
  hideTeamLogo,
  hideUserAvatarForReport,
  logoFileLocations,
  notifyTeamLogoRemoved,
  notifyUserAvatarRemoved,
  purgeDueQuarantines,
  purgeQuarantinedLogo,
  quarantineDirectory,
  quarantinedLogoFile,
  restoreReportedImage,
} from "@/lib/server/logo-quarantine";
import { logoQuarantinePurgeDate } from "@/lib/shared/logo-quarantine";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

type Route = [RegExp, (params: unknown) => unknown];

function routed(routes: Route[]): jest.Mock<SqlQuery> {
  return jest.fn<SqlQuery>(async (sql, params) => {
    const route = routes.find(([pattern]) => pattern.test(sql));
    if (!route) throw new Error(`requête inattendue : ${sql}`);
    return route[1](params);
  });
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const actor = { userId: 1, pseudo: "Admin" };
const LOGO = "/api/uploads/teams/4-abc.webp";
const LIVE = path.join(process.cwd(), "public", "uploads", "teams", "4-abc.webp");
const HIDDEN = path.join(quarantineDirectory(), "team-4-4-abc.webp");
const AVATAR = "/api/uploads/avatars/9-abc.webp";
const LIVE_AVATAR = path.join(process.cwd(), "public", "uploads", "avatars", "9-abc.webp");
const HIDDEN_AVATAR = path.join(avatarQuarantineDirectory(), "user-9-9-abc.webp");

let pool: { execute: jest.Mock<SqlQuery>; getConnection: () => Promise<unknown> };
let connection: ReturnType<typeof connectionMock>;

const reportCategory: Route = [/SELECT category FROM bg_reports WHERE id = \? LIMIT 1/, () => [[{ category: "COPYRIGHT" }]]];

function install(poolRoutes: Route[], connectionRoutes: Route[] = []) {
  connection = connectionMock();
  connection.execute = routed(connectionRoutes);
  // Le fondement d'une décision se relit sur la catégorie du signalement.
  pool = { execute: routed([...poolRoutes, reportCategory]), getConnection: async () => fakeConnection(connection) };
  jest.mocked(getDatabase).mockResolvedValue(fakePool(pool));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);
  jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(undefined);
});

describe("logoFileLocations", () => {
  it("situe un logo téléversé en ligne et en quarantaine", () => {
    expect(logoFileLocations(LOGO, 4)).toEqual({ live: LIVE, quarantined: HIDDEN });
    // Deux équipes qui partagent un fichier ne se disputent pas la copie.
    expect(logoFileLocations(LOGO, 5)?.quarantined).not.toBe(HIDDEN);
    expect(HIDDEN).toContain(path.join("data", "quarantine", "teams"));
  });

  it.each([
    "https://cdn.exemple.test/x.webp",
    "/api/uploads/avatars/4-abc.webp",
    "/api/uploads/teams/../../.env",
    "/api/uploads/teams/sous/dossier.webp",
    "/api/uploads/teams/4-abc.png",
  ])("refuse ce qui n'est pas un logo d'équipe du site : %s", (url) => {
    expect(logoFileLocations(url, 4)).toBeNull();
  });
});

describe("avatarFileLocations", () => {
  it("situe un avatar téléversé en ligne et en quarantaine", () => {
    expect(avatarFileLocations(AVATAR, 9)).toEqual({ live: LIVE_AVATAR, quarantined: HIDDEN_AVATAR });
    expect(HIDDEN_AVATAR).toContain(path.join("data", "quarantine", "players"));
  });

  it.each([
    "https://cdn.exemple.test/x.webp",
    "/api/uploads/teams/9-abc.webp",
    "/api/uploads/avatars/../../.env",
    "/api/uploads/avatars/sous/dossier.webp",
    "/api/uploads/avatars/9-abc.png",
  ])("refuse ce qui n'est pas un avatar du site : %s", (url) => {
    expect(avatarFileLocations(url, 9)).toBeNull();
  });
});

describe("deleteTeamLogoForReport", () => {
  const reportTargets: Route = [/JOIN bg_report_targets t ON t.report_id = r.id AND t.target_type = \?/, () => [[{ category: "COPYRIGHT" }]]];
  const members: Route = [
    /FROM bg_team_members tm\s+JOIN bg_users u/,
    () => [[{ pseudo: "Capitaine", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]],
  ];
  const locked = (logoUrl: string | null): Route => [
    /SELECT name, logo_url FROM bg_teams WHERE id = \? AND solo_user_id IS NULL FOR UPDATE/,
    () => [[{ name: "Alpha", logo_url: logoUrl }]],
  ];
  const sharing = (total: number): Route => [/COUNT\(\*\) AS total FROM bg_teams WHERE logo_url = \?/, () => [[{ total }]]];

  it("vide la colonne, trace la décision close sur-le-champ, efface le fichier et prévient l'équipe", async () => {
    install(
      [reportTargets, members],
      [
        locked(LOGO),
        [/UPDATE bg_teams SET logo_url = NULL/, () => [{}]],
        sharing(0),
        [/INSERT INTO bg_logo_quarantines/, () => [{ insertId: 33 }]],
      ],
    );

    const view = await deleteTeamLogoForReport(12, 4, actor);
    await flush();

    expect(connection.commit).toHaveBeenCalled();
    const insert = connection.execute.mock.calls.find(([sql]) => /INSERT INTO bg_logo_quarantines/.test(sql));
    expect(insert?.[0]).toContain("'PURGED'");
    const [teamId, reportId, logoUrl, hiddenBy, hiddenAt, purgeAfter, closedAt] = insert?.[1] as unknown[];
    expect([teamId, reportId, logoUrl, hiddenBy]).toEqual([4, 12, LOGO, 1]);
    // Ouverte et close au même instant ; l'échéance est celle de la contestation.
    expect(closedAt).toBe(hiddenAt);
    expect((purgeAfter as Date).getTime()).toBe(logoQuarantinePurgeDate(hiddenAt as Date).getTime());

    expect(unlink).toHaveBeenCalledWith(LIVE);
    expect(rename).not.toHaveBeenCalled();
    expect(view).toEqual(expect.objectContaining({ id: 33, status: "PURGED", reportId: 12, closedAt: view.hiddenAt }));

    const [message, recipients, context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(context).toBe("logo-removed");
    expect(message).toContain("« Alpha »");
    expect(message).toContain("https://site.test/signalements/12");
    expect(recipients).toHaveLength(1);
    expect(publishStaffAction).toHaveBeenCalledWith(expect.stringContaining("sans délai"), { id: 1, pseudo: "Admin" });
  });

  it("garde le fichier que d'autres équipes désignent encore", async () => {
    install(
      [reportTargets, members],
      [
        locked(LOGO),
        [/UPDATE bg_teams SET logo_url = NULL/, () => [{}]],
        sharing(1),
        [/INSERT INTO bg_logo_quarantines/, () => [{ insertId: 34 }]],
      ],
    );
    await deleteTeamLogoForReport(12, 4, actor);
    expect(unlink).not.toHaveBeenCalled();
  });

  it("refuse une équipe sans logo, sans rien écrire", async () => {
    install([reportTargets], [locked(null)]);
    await expect(deleteTeamLogoForReport(12, 4, actor)).rejects.toThrow("TEAM_HAS_NO_LOGO");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => /INSERT|UPDATE bg_teams/.test(sql))).toBe(false);
    expect(unlink).not.toHaveBeenCalled();
  });

  it("refuse une équipe que le signalement ne vise pas", async () => {
    install([
      [/JOIN bg_report_targets/, () => [[]]],
      [/SELECT id FROM bg_reports WHERE id = \?/, () => [[{ id: 12 }]]],
    ]);
    await expect(deleteTeamLogoForReport(12, 4, actor)).rejects.toThrow("TEAM_NOT_TARGETED");
    expect(connection.execute).not.toHaveBeenCalled();
  });
});

describe("deleteUserAvatarForReport", () => {
  const reportTargets: Route = [/JOIN bg_report_targets t ON t.report_id = r.id AND t.target_type = \?/, () => [[{ category: "COPYRIGHT" }]]];
  const locked = (avatarUrl: string | null): Route => [
    /SELECT pseudo, avatar_url FROM bg_users WHERE id = \? AND is_deleted = 0 FOR UPDATE/,
    () => [[{ pseudo: "Nova", avatar_url: avatarUrl }]],
  ];

  it("vide la colonne, resynchronise l'entrée solo, efface le fichier et prévient le joueur", async () => {
    install(
      [
        reportTargets,
        [/FROM bg_users\s+WHERE id = \? AND is_deleted = 0/, () => [[{ pseudo: "Nova", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]]],
      ],
      [locked(AVATAR), [/UPDATE bg_users SET avatar_url = NULL/, () => [{}]], [/INSERT INTO bg_logo_quarantines/, () => [{ insertId: 40 }]]],
    );

    const view = await deleteUserAvatarForReport(12, 9, actor);
    await flush();

    expect(connection.commit).toHaveBeenCalled();
    expect(syncSoloEntryIdentityOn).toHaveBeenCalledWith(expect.anything(), 9);
    const insert = connection.execute.mock.calls.find(([sql]) => /INSERT INTO bg_logo_quarantines/.test(sql));
    const [userId, reportId, avatarUrl, hiddenBy, hiddenAt, purgeAfter] = insert?.[1] as unknown[];
    expect([userId, reportId, avatarUrl, hiddenBy]).toEqual([9, 12, AVATAR, 1]);
    expect((purgeAfter as Date).getTime()).toBe(logoQuarantinePurgeDate(hiddenAt as Date).getTime());

    expect(unlink).toHaveBeenCalledWith(LIVE_AVATAR);
    expect(view).toEqual(
      expect.objectContaining({ id: 40, targetType: "USER", targetId: 9, targetName: "Nova", status: "PURGED" }),
    );
    const [message, , context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(context).toBe("avatar-removed");
    expect(message).toContain("Ton avatar");
    // Jamais le pseudo du joueur sur Discord (lib/shared/log-privacy.ts).
    const [staffLine] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(staffLine).toContain("un joueur");
    expect(staffLine).toContain("sans délai");
    expect(staffLine).not.toContain("Nova");
  });

  it("refuse un joueur sans avatar, sans rien écrire", async () => {
    install([reportTargets], [locked(null)]);
    await expect(deleteUserAvatarForReport(12, 9, actor)).rejects.toThrow("USER_HAS_NO_AVATAR");
    expect(connection.rollback).toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it("refuse un joueur que le signalement ne vise pas", async () => {
    install([
      [/JOIN bg_report_targets/, () => [[]]],
      [/SELECT id FROM bg_reports WHERE id = \?/, () => [[{ id: 12 }]]],
    ]);
    await expect(deleteUserAvatarForReport(12, 9, actor)).rejects.toThrow("USER_NOT_TARGETED");
    expect(connection.execute).not.toHaveBeenCalled();
  });
});

describe("notifyTeamLogoRemoved", () => {
  it("prévient l'équipe sans lien quand le retrait ne découle d'aucun signalement", async () => {
    install([
      [
        /FROM bg_team_members tm\s+JOIN bg_users u/,
        () => [[{ pseudo: "Capitaine", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]],
      ],
    ]);
    notifyTeamLogoRemoved(4, "Alpha", null);
    await flush();
    const [message] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toContain("« Alpha »");
    expect(message).not.toContain("/signalements/");
    expect(message).toContain("Faits retenus : constat de la modération");
    expect(message).toContain("https://site.test/conditions-utilisation#contenus");
  });
});

describe("notifyUserAvatarRemoved", () => {
  it("prévient le joueur sans lien quand le retrait ne découle d'aucun signalement", async () => {
    install([
      [
        /FROM bg_users\s+WHERE id = \? AND is_deleted = 0/,
        () => [[{ pseudo: "Nova", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]],
      ],
    ]);
    notifyUserAvatarRemoved(9, null);
    await flush();
    const [message] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toContain("Ton avatar");
    expect(message).not.toContain("/signalements/");
    expect(message).toContain("Faits retenus : constat de la modération");
    expect(message).toContain("https://site.test/conditions-utilisation#contenus");
  });
});

describe("hideTeamLogo", () => {
  const reportTargets: Route = [/JOIN bg_report_targets t ON t.report_id = r.id AND t.target_type = \?/, () => [[{ category: "COPYRIGHT" }]]];
  const team: Route = [/SELECT name, logo_url FROM bg_teams/, () => [[{ name: "Alpha", logo_url: LOGO }]]];
  const notShared: Route = [/COUNT\(\*\) AS total FROM bg_teams WHERE logo_url = \? AND id <> \?/, () => [[{ total: 0 }]]];
  const shared: Route = [/COUNT\(\*\) AS total FROM bg_teams WHERE logo_url = \? AND id <> \?/, () => [[{ total: 2 }]]];
  const members: Route = [
    /FROM bg_team_members tm\s+JOIN bg_users u/,
    () => [
      [
        { pseudo: "Capitaine", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null },
        { pseudo: "SansDiscord", discord_id: null, discord_pseudo: "tagsaisi", discord_verified_at: null },
      ],
    ],
  ];

  it("déplace le fichier hors ligne, vide la colonne, date l'échéance et prévient l'équipe", async () => {
    install(
      [reportTargets, team, notShared, members],
      [
        [/SELECT logo_url FROM bg_teams WHERE id = \? FOR UPDATE/, () => [[{ logo_url: LOGO }]]],
        [/UPDATE bg_teams SET logo_url = NULL/, () => [{}]],
        [/INSERT INTO bg_logo_quarantines/, () => [{ insertId: 30 }]],
      ],
    );

    const view = await hideTeamLogo(12, 4, actor);
    await flush();

    expect(rename).toHaveBeenCalledWith(LIVE, HIDDEN);
    expect(connection.commit).toHaveBeenCalled();
    expect(view).toEqual(
      expect.objectContaining({ id: 30, targetType: "TEAM", targetId: 4, targetName: "Alpha", reportId: 12, status: "HIDDEN" }),
    );
    expect(view.purgeAfter).toBe(logoQuarantinePurgeDate(new Date(view.hiddenAt)).toISOString());

    expect(publishStaffAction).toHaveBeenCalledWith(expect.stringContaining("« Alpha » masqué"), { id: 1, pseudo: "Admin" });
    const [message, recipients, context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(context).toBe("logo-hidden");
    expect(message).toContain("https://site.test/signalements/12");
    // Le motif suit la catégorie du signalement lue en vérifiant la cible.
    expect(message).toContain("Motif : atteinte présumée au droit d'auteur");
    expect(message).toContain("https://site.test/conditions-utilisation#contenus");
    // Seul le membre joignable par un moyen prouvé est prévenu.
    expect(recipients).toEqual([{ discordId: "900000000000000005", handle: null, label: "Capitaine" }]);
  });

  it("efface le fichier, sans le republier, si l'équipe a changé de logo pendant le geste", async () => {
    install(
      [reportTargets, team, notShared],
      [[/SELECT logo_url FROM bg_teams WHERE id = \? FOR UPDATE/, () => [[{ logo_url: "/api/uploads/teams/4-new.webp" }]]]],
    );
    await expect(hideTeamLogo(12, 4, actor)).rejects.toThrow("LOGO_CHANGED");
    expect(connection.rollback).toHaveBeenCalled();
    // Plus rien ne le désigne : le remettre en ligne republierait le logo
    // signalé sous son ancienne adresse, que l'envoi du nouveau n'a pas trouvé.
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith(LIVE, HIDDEN);
    expect(unlink).toHaveBeenCalledWith(HIDDEN);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("remet le fichier en ligne si l'écriture échoue sur un logo toujours désigné", async () => {
    install(
      [reportTargets, team, notShared],
      [
        [/SELECT logo_url FROM bg_teams WHERE id = \? FOR UPDATE/, () => [[{ logo_url: LOGO }]]],
        [/UPDATE bg_teams SET logo_url = NULL/, () => [{}]],
        [
          /INSERT INTO bg_logo_quarantines/,
          () => {
            throw new Error("ER_LOCK_DEADLOCK");
          },
        ],
      ],
    );
    await expect(hideTeamLogo(12, 4, actor)).rejects.toThrow("ER_LOCK_DEADLOCK");
    expect(rename).toHaveBeenNthCalledWith(1, LIVE, HIDDEN);
    expect(rename).toHaveBeenNthCalledWith(2, HIDDEN, LIVE);
    expect(unlink).not.toHaveBeenCalled();
  });

  it("déplace d'un disque à l'autre quand un renommage n'y suffit pas", async () => {
    jest.mocked(rename).mockRejectedValueOnce(Object.assign(new Error("cross-device"), { code: "EXDEV" }));
    install(
      [reportTargets, team, notShared, members],
      [
        [/FOR UPDATE/, () => [[{ logo_url: LOGO }]]],
        [/UPDATE bg_teams/, () => [{}]],
        [/INSERT INTO bg_logo_quarantines/, () => [{ insertId: 31 }]],
      ],
    );
    await hideTeamLogo(12, 4, actor);
    expect(copyFile).toHaveBeenCalledWith(LIVE, HIDDEN);
    expect(unlink).toHaveBeenCalledWith(LIVE);
  });

  it("copie un fichier que d'autres équipes désignent, sans le retirer d'elles", async () => {
    install(
      [reportTargets, team, shared, members],
      [
        [/FOR UPDATE/, () => [[{ logo_url: LOGO }]]],
        [/UPDATE bg_teams/, () => [{}]],
        [/INSERT INTO bg_logo_quarantines/, () => [{ insertId: 32 }]],
      ],
    );
    await hideTeamLogo(12, 4, actor);
    expect(copyFile).toHaveBeenCalledWith(LIVE, HIDDEN);
    expect(rename).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalledWith(LIVE);
  });

  it("n'efface que la copie si l'écriture échoue sur un fichier partagé", async () => {
    install([reportTargets, team, shared], [[/FOR UPDATE/, () => [[{ logo_url: "/api/uploads/teams/autre.webp" }]]]]);
    await expect(hideTeamLogo(12, 4, actor)).rejects.toThrow("LOGO_CHANGED");
    expect(unlink).toHaveBeenCalledWith(HIDDEN);
    expect(rename).not.toHaveBeenCalled();
  });

  it("refuse clairement un logo dont le fichier n'existe plus, sans rien écrire", async () => {
    jest.mocked(rename).mockRejectedValueOnce(Object.assign(new Error("absent"), { code: "ENOENT" }));
    install([reportTargets, team, notShared], []);
    await expect(hideTeamLogo(12, 4, actor)).rejects.toThrow("LOGO_FILE_MISSING");
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("refuse une équipe que le signalement ne vise pas, et un signalement inconnu", async () => {
    install([
      [/JOIN bg_report_targets/, () => [[]]],
      [/SELECT id FROM bg_reports WHERE id = \?/, () => [[{ id: 12 }]]],
    ]);
    await expect(hideTeamLogo(12, 4, actor)).rejects.toThrow("TEAM_NOT_TARGETED");

    install([
      [/JOIN bg_report_targets/, () => [[]]],
      [/SELECT id FROM bg_reports WHERE id = \?/, () => [[]]],
    ]);
    await expect(hideTeamLogo(12, 4, actor)).rejects.toThrow("REPORT_NOT_FOUND");
    expect(rename).not.toHaveBeenCalled();
  });

  it("refuse une équipe sans logo, ou dont le logo n'est pas un fichier du site", async () => {
    install([reportTargets, [/SELECT name, logo_url FROM bg_teams/, () => [[{ name: "Alpha", logo_url: null }]]]]);
    await expect(hideTeamLogo(12, 4, actor)).rejects.toThrow("TEAM_HAS_NO_LOGO");

    install([reportTargets, [/SELECT name, logo_url FROM bg_teams/, () => [[{ name: "Alpha", logo_url: "https://x.test/a.webp" }]]]]);
    await expect(hideTeamLogo(12, 4, actor)).rejects.toThrow("LOGO_NOT_MOVABLE");
    expect(rename).not.toHaveBeenCalled();
  });
});

describe("hideUserAvatarForReport", () => {
  const reportTargets: Route = [/JOIN bg_report_targets t ON t.report_id = r.id AND t.target_type = \?/, () => [[{ category: "COPYRIGHT" }]]];
  const user: Route = [/SELECT pseudo, avatar_url FROM bg_users WHERE id = \? AND is_deleted = 0 LIMIT 1/, () => [[{ pseudo: "Nova", avatar_url: AVATAR }]]];
  const recipient: Route = [
    /FROM bg_users\s+WHERE id = \? AND is_deleted = 0/,
    () => [[{ pseudo: "Nova", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]],
  ];

  it("déplace le fichier hors ligne, vide la colonne, resynchronise l'entrée solo et prévient le joueur", async () => {
    install(
      [reportTargets, user, recipient],
      [
        [/SELECT avatar_url FROM bg_users WHERE id = \? AND is_deleted = 0 FOR UPDATE/, () => [[{ avatar_url: AVATAR }]]],
        [/UPDATE bg_users SET avatar_url = NULL/, () => [{}]],
        [/INSERT INTO bg_logo_quarantines/, () => [{ insertId: 50 }]],
      ],
    );

    const view = await hideUserAvatarForReport(12, 9, actor);
    await flush();

    expect(rename).toHaveBeenCalledWith(LIVE_AVATAR, HIDDEN_AVATAR);
    expect(connection.commit).toHaveBeenCalled();
    expect(syncSoloEntryIdentityOn).toHaveBeenCalledWith(expect.anything(), 9);
    expect(view).toEqual(
      expect.objectContaining({ id: 50, targetType: "USER", targetId: 9, targetName: "Nova", status: "HIDDEN" }),
    );
    const [message, , context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(context).toBe("avatar-hidden");
    expect(message).toContain("Ton avatar");
    // Jamais le pseudo du joueur sur Discord (lib/shared/log-privacy.ts).
    const [staffLine] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(staffLine).toContain("un joueur");
    expect(staffLine).not.toContain("Nova");
  });

  it("efface le fichier, sans le republier, si le joueur a changé d'avatar pendant le geste", async () => {
    install(
      [reportTargets, user],
      [[/SELECT avatar_url FROM bg_users WHERE id = \? AND is_deleted = 0 FOR UPDATE/, () => [[{ avatar_url: "/api/uploads/avatars/9-new.webp" }]]]],
    );
    await expect(hideUserAvatarForReport(12, 9, actor)).rejects.toThrow("AVATAR_CHANGED");
    expect(connection.rollback).toHaveBeenCalled();
    expect(rename).toHaveBeenCalledWith(LIVE_AVATAR, HIDDEN_AVATAR);
    expect(unlink).toHaveBeenCalledWith(HIDDEN_AVATAR);
  });

  it("refuse un joueur que le signalement ne vise pas", async () => {
    install([
      [/JOIN bg_report_targets/, () => [[]]],
      [/SELECT id FROM bg_reports WHERE id = \?/, () => [[{ id: 12 }]]],
    ]);
    await expect(hideUserAvatarForReport(12, 9, actor)).rejects.toThrow("USER_NOT_TARGETED");
  });

  it("refuse un joueur sans avatar, ou dont l'avatar n'est pas un fichier du site", async () => {
    install([reportTargets, [/SELECT pseudo, avatar_url FROM bg_users/, () => [[{ pseudo: "Nova", avatar_url: null }]]]]);
    await expect(hideUserAvatarForReport(12, 9, actor)).rejects.toThrow("USER_HAS_NO_AVATAR");

    install([reportTargets, [/SELECT pseudo, avatar_url FROM bg_users/, () => [[{ pseudo: "Nova", avatar_url: "https://x.test/a.webp" }]]]]);
    await expect(hideUserAvatarForReport(12, 9, actor)).rejects.toThrow("AVATAR_NOT_MOVABLE");
    expect(rename).not.toHaveBeenCalled();
  });

  it("refuse clairement un avatar dont le fichier n'existe plus, sans rien écrire", async () => {
    jest.mocked(rename).mockRejectedValueOnce(Object.assign(new Error("absent"), { code: "ENOENT" }));
    install([reportTargets, user], []);
    await expect(hideUserAvatarForReport(12, 9, actor)).rejects.toThrow("AVATAR_FILE_MISSING");
    expect(connection.execute).not.toHaveBeenCalled();
  });
});

const quarantineRow = (overrides: Record<string, unknown> = {}) => ({
  id: 30,
  target_type: "TEAM",
  target_id: 4,
  target_name: "Alpha",
  report_id: 12,
  logo_url: LOGO,
  status: "HIDDEN",
  hidden_at: new Date("2026-01-01T00:00:00Z"),
  purge_after: new Date("2026-06-30T00:00:00Z"),
  closed_at: null,
  ...overrides,
});

describe("restoreReportedImage", () => {
  it("remet le logo à la même adresse et prévient l'équipe", async () => {
    install(
      [[/FROM bg_team_members tm/, () => [[{ pseudo: "Capitaine", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]]]],
      [
        [/FROM bg_logo_quarantines q[\s\S]*FOR UPDATE/, () => [[quarantineRow()]]],
        [/SELECT logo_url AS image_url FROM bg_teams WHERE id = \? FOR UPDATE/, () => [[{ image_url: null }]]],
        [/UPDATE bg_teams SET logo_url = \?/, () => [{}]],
        [/SET status = 'RESTORED'/, () => [{}]],
      ],
    );
    await restoreReportedImage(30, actor);
    await flush();
    expect(rename).toHaveBeenCalledWith(HIDDEN, LIVE);
    expect(connection.execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bg_teams SET logo_url = \?/), [LOGO, 4]);
    expect(connection.commit).toHaveBeenCalled();
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls[0][2]).toBe("logo-restored");
  });

  it("remet l'avatar à la même adresse, resynchronise l'entrée solo et prévient le joueur", async () => {
    install(
      [[/FROM bg_users\s+WHERE id = \? AND is_deleted = 0/, () => [[{ pseudo: "Nova", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]]]],
      [
        [/FROM bg_logo_quarantines q[\s\S]*FOR UPDATE/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SELECT avatar_url AS image_url FROM bg_users WHERE id = \? AND is_deleted = 0 FOR UPDATE/, () => [[{ image_url: null }]]],
        [/UPDATE bg_users SET avatar_url = \?/, () => [{}]],
        [/SET status = 'RESTORED'/, () => [{}]],
      ],
    );
    await restoreReportedImage(30, actor);
    await flush();
    expect(rename).toHaveBeenCalledWith(HIDDEN_AVATAR, LIVE_AVATAR);
    expect(connection.execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bg_users SET avatar_url = \?/), [AVATAR, 9]);
    expect(syncSoloEntryIdentityOn).toHaveBeenCalledWith(expect.anything(), 9);
    // Masqué pendant la quarantaine, il ne doit pas revenir à son adresse publique.
    expect(rotateHiddenAvatarFile).toHaveBeenCalledWith(9);
    expect(connection.commit).toHaveBeenCalled();
    const [, recipients, context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(context).toBe("avatar-restored");
    expect(recipients).toHaveLength(1);
    // Jamais le pseudo du joueur sur Discord (lib/shared/log-privacy.ts).
    const [staffLine] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(staffLine).toContain("un joueur");
    expect(staffLine).not.toContain("Nova");
  });

  it("n'écrase pas une image envoyée depuis", async () => {
    install(
      [],
      [
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow()]]],
        [/SELECT logo_url AS image_url FROM bg_teams/, () => [[{ image_url: "/api/uploads/teams/4-new.webp" }]]],
      ],
    );
    await expect(restoreReportedImage(30, actor)).rejects.toThrow("TEAM_HAS_NEW_LOGO");
    expect(rename).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("n'écrase pas un avatar envoyé depuis", async () => {
    install(
      [],
      [
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SELECT avatar_url AS image_url FROM bg_users/, () => [[{ image_url: "/api/uploads/avatars/9-new.webp" }]]],
      ],
    );
    await expect(restoreReportedImage(30, actor)).rejects.toThrow("USER_HAS_NEW_AVATAR");
    expect(rename).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("refuse une quarantaine déjà close ou inconnue", async () => {
    install([], [[/FROM bg_logo_quarantines q/, () => [[quarantineRow({ status: "PURGED" })]]]]);
    await expect(restoreReportedImage(30, actor)).rejects.toThrow("QUARANTINE_CLOSED");
    install([], [[/FROM bg_logo_quarantines q/, () => [[]]]]);
    await expect(restoreReportedImage(30, actor)).rejects.toThrow("QUARANTINE_NOT_FOUND");
  });

  it("renvoie le fichier en quarantaine si l'écriture échoue", async () => {
    install(
      [],
      [
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow()]]],
        [/SELECT logo_url AS image_url FROM bg_teams/, () => [[{ image_url: null }]]],
        [
          /UPDATE bg_teams SET logo_url = \?/,
          () => {
            throw new Error("ER_LOCK_DEADLOCK");
          },
        ],
      ],
    );
    await expect(restoreReportedImage(30, actor)).rejects.toThrow("ER_LOCK_DEADLOCK");
    expect(rename).toHaveBeenNthCalledWith(1, HIDDEN, LIVE);
    expect(rename).toHaveBeenNthCalledWith(2, LIVE, HIDDEN);
  });

  it("renvoie le fichier en quarantaine si l'écriture d'un avatar échoue", async () => {
    install(
      [],
      [
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SELECT avatar_url AS image_url FROM bg_users/, () => [[{ image_url: null }]]],
        [
          /UPDATE bg_users SET avatar_url = \?/,
          () => {
            throw new Error("ER_LOCK_DEADLOCK");
          },
        ],
      ],
    );
    await expect(restoreReportedImage(30, actor)).rejects.toThrow("ER_LOCK_DEADLOCK");
    expect(rename).toHaveBeenNthCalledWith(1, HIDDEN_AVATAR, LIVE_AVATAR);
    expect(rename).toHaveBeenNthCalledWith(2, LIVE_AVATAR, HIDDEN_AVATAR);
    // L'échec survient avant la resynchronisation de l'entrée solo.
    expect(syncSoloEntryIdentityOn).not.toHaveBeenCalled();
  });
});

describe("purgeQuarantinedLogo / purgeDueQuarantines", () => {
  const members: Route = [
    /FROM bg_team_members tm\s+JOIN bg_users u/,
    () => [[{ pseudo: "Capitaine", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]],
  ];

  it("clôt la quarantaine puis efface le fichier, après le commit", async () => {
    install([members], [[/FROM bg_logo_quarantines q/, () => [[quarantineRow()]]], [/SET status = 'PURGED'/, () => [{}]]]);
    await purgeQuarantinedLogo(30, actor);
    expect(unlink).toHaveBeenCalledWith(HIDDEN);
    expect(jest.mocked(connection.commit).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(unlink).mock.invocationCallOrder[0],
    );
    expect(publishStaffAction).toHaveBeenCalledWith(expect.stringContaining("supprimé définitivement par le staff"), {
      id: 1,
      pseudo: "Admin",
    });
  });

  it("prévient l'équipe d'une suppression décidée avant l'échéance, lien du signalement compris", async () => {
    install([members], [[/FROM bg_logo_quarantines q/, () => [[quarantineRow()]]], [/SET status = 'PURGED'/, () => [{}]]]);
    await purgeQuarantinedLogo(30, actor);
    await flush();
    const [message, recipients, context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(context).toBe("logo-removed");
    expect(message).toContain("https://site.test/signalements/12");
    expect(recipients).toHaveLength(1);
  });

  it("clôt puis efface un avatar en quarantaine, et prévient le joueur", async () => {
    const recipient: Route = [
      /FROM bg_users\s+WHERE id = \? AND is_deleted = 0/,
      () => [[{ pseudo: "Nova", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]],
    ];
    install(
      [recipient],
      [
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SET status = 'PURGED'/, () => [{}]],
      ],
    );
    await purgeQuarantinedLogo(30, actor);
    await flush();
    expect(unlink).toHaveBeenCalledWith(HIDDEN_AVATAR);
    const [message, , context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(context).toBe("avatar-removed");
    expect(message).toContain("Ton avatar");
    // Jamais le pseudo du joueur sur Discord (lib/shared/log-privacy.ts).
    const [staffLine] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(staffLine).toContain("un joueur");
    expect(staffLine).not.toContain("Nova");
  });

  it("supprime d'office ce qui est échu et non contesté, et garde ce qui attend une décision", async () => {
    install(
      [
        [
          /FROM bg_logo_quarantines q\s+LEFT JOIN bg_reports r/,
          () => [
            [
              { id: 30, purge_after: new Date("2026-06-30T00:00:00Z"), report_id: 12, report_status: "OPEN", contested: 0 },
              { id: 31, purge_after: new Date("2026-06-30T00:00:00Z"), report_id: 13, report_status: "OPEN", contested: 1 },
              { id: 32, purge_after: new Date("2026-06-30T00:00:00Z"), report_id: null, report_status: null, contested: 0 },
            ],
          ],
        ],
      ],
      [[/FROM bg_logo_quarantines q/, (params) => [[quarantineRow({ id: (params as number[])[0] })]]], [/SET status = 'PURGED'/, () => [{}]]],
    );
    await expect(purgeDueQuarantines(new Date("2026-07-01T00:00:00Z"))).resolves.toBe(2);
    const purged = connection.execute.mock.calls.filter(([sql]) => /SET status = 'PURGED'/.test(sql)).map(([, p]) => p);
    expect(purged).toEqual([[30], [32]]);
    expect(publishStaffAction).not.toHaveBeenCalled();
    // À l'échéance, le message du masquage a déjà annoncé la date.
    await flush();
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("ne compte pas la contestation de l'auteur du signalement : elle ne défend pas l'image", async () => {
    install([[/FROM bg_logo_quarantines q\s+LEFT JOIN bg_reports r/, () => [[]]]]);
    await purgeDueQuarantines(new Date("2026-07-01T00:00:00Z"));
    const [sql] = pool.execute.mock.calls[0];
    // Qui conteste est lu tel qu'écrit à la contestation, jamais redéduit de
    // l'appartenance du jour ; une contestation d'avant la colonne compte.
    expect(sql).toMatch(/c\.contest_role IS NULL OR c\.contest_role = 'TARGET'/);
    expect(sql).not.toMatch(/bg_team_members/);
  });
});

describe("quarantinedLogoFile", () => {
  it("ne sert que l'aperçu d'un logo encore masqué", async () => {
    install([
      [/SELECT logo_url, team_id, user_id, status FROM bg_logo_quarantines/, () => [[{ logo_url: LOGO, team_id: 4, user_id: null, status: "HIDDEN" }]]],
    ]);
    await expect(quarantinedLogoFile(30)).resolves.toBe(HIDDEN);
    install([
      [/SELECT logo_url, team_id, user_id, status FROM bg_logo_quarantines/, () => [[{ logo_url: LOGO, team_id: 4, user_id: null, status: "RESTORED" }]]],
    ]);
    await expect(quarantinedLogoFile(30)).resolves.toBeNull();
  });

  it("sert aussi l'aperçu d'un avatar encore masqué", async () => {
    install([
      [/SELECT logo_url, team_id, user_id, status FROM bg_logo_quarantines/, () => [[{ logo_url: AVATAR, team_id: null, user_id: 9, status: "HIDDEN" }]]],
    ]);
    await expect(quarantinedLogoFile(30)).resolves.toBe(HIDDEN_AVATAR);
  });
});
