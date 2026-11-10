import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import path from "node:path";

jest.mock("node:fs/promises", () => ({
  rename: jest.fn(async () => undefined),
  copyFile: jest.fn(async () => undefined),
  unlink: jest.fn(async () => undefined),
  mkdir: jest.fn(async () => undefined),
}));
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/blocked-images");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/avatar-rotation");
jest.mock("@/lib/server/stored-upload-cleanup");
// Vrais caches (le dernier bloc les lit), espionnés pour compter les appels.
jest.mock("@/lib/server/ranking-cache", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/ranking-cache")>("@/lib/server/ranking-cache");
  return { ...actual, invalidateTeamIdentityViews: jest.fn(actual.invalidateTeamIdentityViews) };
});
jest.mock("@/lib/server/landing-cache", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/landing-cache")>("@/lib/server/landing-cache");
  return { ...actual, invalidateLandingTeamViews: jest.fn(actual.invalidateLandingTeamViews) };
});
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://site.test" }));

import { copyFile, rename, unlink } from "node:fs/promises";
import { getDatabase } from "@/lib/server/database";
import { blockImageHashOn, blockImageHashesSafely, readImageSha256, unblockImageHashOn } from "@/lib/server/blocked-images";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { rotateHeldAvatarFile, rotateHiddenAvatarFile } from "@/lib/server/avatar-rotation";
import { deleteUnreferencedUpload, isUploadReferenced, storedUploadAbsolutePath } from "@/lib/server/stored-upload-cleanup";
import { invalidateTeamIdentityViews } from "@/lib/server/ranking-cache";
import { invalidateLandingTeamViews } from "@/lib/server/landing-cache";
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
  removeModeratedAvatarFile,
  purgeQuarantinedLogo,
  quarantineDirectory,
  targetContestPending,
  quarantinedLogoFile,
  recordContestOutcome,
  restoreReportedImage,
} from "@/lib/server/logo-quarantine";
import { logoQuarantinePurgeDate } from "@/lib/shared/logo-quarantine";
import { clearCache } from "@/lib/server/cache";
import { LANDING_TTL_MS, cachedLanding } from "@/lib/server/landing-cache";
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
// Le compte visé, lu sur la connexion avant la transaction : par défaut, aucun (logo d'équipe).
const quarantineOwner: Route = [/SELECT user_id FROM bg_logo_quarantines WHERE id = \? LIMIT 1/, () => [[]]];

function install(poolRoutes: Route[], connectionRoutes: Route[] = []) {
  connection = connectionMock();
  connection.execute = routed([...connectionRoutes, quarantineOwner]);
  // Le fondement d'une décision se relit sur la catégorie du signalement.
  pool = { execute: routed([...poolRoutes, reportCategory]), getConnection: async () => fakeConnection(connection) };
  jest.mocked(getDatabase).mockResolvedValue(fakePool(pool));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);
  jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
  // Le chemin d'un téléversement reste la vraie règle ; aucun autre usage par défaut.
  jest.mocked(storedUploadAbsolutePath).mockImplementation(
    jest.requireActual<typeof import("@/lib/server/stored-upload-cleanup")>("@/lib/server/stored-upload-cleanup")
      .storedUploadAbsolutePath,
  );
  jest.mocked(isUploadReferenced).mockResolvedValue(false);
  // Chaque fichier a son empreinte, dérivée de son nom.
  jest.mocked(readImageSha256).mockImplementation(async (file) => sha(file));
});

/** L'empreinte simulée d'un fichier. */
function sha(file: string): string {
  return `sha:${path.basename(file)}`;
}

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
    expect(publishStaffAction).toHaveBeenCalledWith(expect.stringContaining("sans délai"), { id: 1, pseudo: "Admin" }, { category: "moderation" });
    // Logo lu par le podium, les cartes d'aperçu et la vitrine : tous oubliés.
    expect(invalidateTeamIdentityViews).toHaveBeenCalledTimes(1);
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

/** Ligne du joueur relue sous verrou (`readModeratableAvatar`). */
const lockedUser = (avatarUrl: string | null, isDeleted: 0 | 1 = 0): Route => [
  /SELECT pseudo, avatar_url, is_deleted FROM bg_users WHERE id = \? FOR UPDATE/,
  () => [[{ pseudo: "Nova", avatar_url: avatarUrl, is_deleted: isDeleted }]],
];

describe("deleteUserAvatarForReport", () => {
  const reportTargets: Route = [/JOIN bg_report_targets t ON t.report_id = r.id AND t.target_type = \?/, () => [[{ category: "COPYRIGHT" }]]];
  const locked = lockedUser;
  const held = (avatarUrl: string | null): Route => [
    /SELECT pseudo, avatar_url FROM bg_account_deletion_holds WHERE user_id = \? LIMIT 1 FOR UPDATE/,
    () => [[{ pseudo: "Nova", avatar_url: avatarUrl }]],
  ];
  const userTarget: Route = [
    /FROM bg_users\s+WHERE id = \? AND is_deleted = 0/,
    () => [[{ pseudo: "Nova", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]],
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
    // L'avatar est le logo de l'entrée solo, que nomment les vues de la vitrine.
    expect(invalidateLandingTeamViews).toHaveBeenCalledTimes(1);
    expect(invalidateTeamIdentityViews).not.toHaveBeenCalled();
    expect(syncSoloEntryIdentityOn).toHaveBeenCalledWith(expect.anything(), 9);
    const insert = connection.execute.mock.calls.find(([sql]) => /INSERT INTO bg_logo_quarantines/.test(sql));
    const [userId, reportId, avatarUrl, hiddenBy, hiddenAt, purgeAfter] = insert?.[1] as unknown[];
    expect([userId, reportId, avatarUrl, hiddenBy]).toEqual([9, 12, AVATAR, 1]);
    expect((purgeAfter as Date).getTime()).toBe(logoQuarantinePurgeDate(hiddenAt as Date).getTime());

    // D6 : supprimé par la modération, l'avatar est bloqué avant que le fichier ne parte
    // — et le fichier ne part que si plus rien ne le désigne.
    // Bloqué dans la transaction de la décision, empreinte gardée sur la ligne (D18).
    expect(blockImageHashOn).toHaveBeenCalledWith(expect.anything(), sha(LIVE_AVATAR));
    expect((insert?.[1] as unknown[])[7]).toBe(sha(LIVE_AVATAR));
    expect(jest.mocked(blockImageHashOn).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(connection.commit).mock.invocationCallOrder[0],
    );
    expect(blockImageHashesSafely).not.toHaveBeenCalled();
    expect(deleteUnreferencedUpload).toHaveBeenCalledWith(AVATAR, "avatars");
    expect(jest.mocked(blockImageHashOn).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(deleteUnreferencedUpload).mock.invocationCallOrder[0],
    );
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
    expect(deleteUnreferencedUpload).not.toHaveBeenCalled();
  });

  // Revue sécurité #571, cycle 3 (D6) : demander la suppression ne met pas
  // l'avatar hors d'atteinte — il est retiré du masque, bloqué, effacé.
  it("deleteUserAvatarForReport_pendingAccount_takesHeldAvatarSkipsUserUpdateAndSoloSync", async () => {
    install(
      [reportTargets, userTarget],
      [
        locked(null, 1),
        held(AVATAR),
        [/UPDATE bg_account_deletion_holds SET avatar_url = \? WHERE user_id = \?/, () => [{}]],
        [/INSERT INTO bg_logo_quarantines/, () => [{ insertId: 41 }]],
      ],
    );

    const view = await deleteUserAvatarForReport(12, 9, actor);

    expect(view).toEqual(expect.objectContaining({ id: 41, status: "PURGED" }));
    expect(connection.execute.mock.calls.some(([sql]) => /UPDATE bg_users SET avatar_url/.test(sql))).toBe(false);
    expect(connection.execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bg_account_deletion_holds SET avatar_url = \?/), [null, 9]);
    expect(syncSoloEntryIdentityOn).not.toHaveBeenCalled();
    expect(blockImageHashOn).toHaveBeenCalledWith(expect.anything(), sha(LIVE_AVATAR));
    expect(deleteUnreferencedUpload).toHaveBeenCalledWith(AVATAR, "avatars");
  });

  it("deleteUserAvatarForReport_pendingWithoutHeldAvatar_throwsUserHasNoAvatar", async () => {
    install([reportTargets], [locked(null, 1), held(null)]);

    await expect(deleteUserAvatarForReport(12, 9, actor)).rejects.toThrow("USER_HAS_NO_AVATAR");

    expect(connection.rollback).toHaveBeenCalled();
    expect(blockImageHashOn).not.toHaveBeenCalled();
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

  it("prévient quand même si le fondement ne se relit pas : les règles du site, jamais le silence", async () => {
    install([
      [/SELECT category FROM bg_reports WHERE id = \? LIMIT 1/, () => Promise.reject(new Error("ECONNRESET"))],
      [
        /FROM bg_users\s+WHERE id = \? AND is_deleted = 0/,
        () => [[{ pseudo: "Nova", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]],
      ],
    ]);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    notifyUserAvatarRemoved(9, 12);
    await flush();
    const [message] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toContain("https://site.test/signalements/12");
    expect(message).toContain("Motif : image jugée contraire aux conditions d'utilisation");
    error.mockRestore();
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
    expect(invalidateTeamIdentityViews).toHaveBeenCalledTimes(1);
    expect(view).toEqual(
      expect.objectContaining({ id: 30, targetType: "TEAM", targetId: 4, targetName: "Alpha", reportId: 12, status: "HIDDEN" }),
    );
    expect(view.purgeAfter).toBe(logoQuarantinePurgeDate(new Date(view.hiddenAt)).toISOString());

    expect(publishStaffAction).toHaveBeenCalledWith(expect.stringContaining("« Alpha » masqué"), { id: 1, pseudo: "Admin" }, { category: "moderation" });
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
  const user: Route = [/SELECT pseudo, avatar_url, is_deleted FROM bg_users WHERE id = \? LIMIT 1/, () => [[{ pseudo: "Nova", avatar_url: AVATAR, is_deleted: 0 }]]];
  const recipient: Route = [
    /FROM bg_users\s+WHERE id = \? AND is_deleted = 0/,
    () => [[{ pseudo: "Nova", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]],
  ];

  it("déplace le fichier hors ligne, vide la colonne, resynchronise l'entrée solo et prévient le joueur", async () => {
    install(
      [reportTargets, user, recipient],
      [
        lockedUser(AVATAR),
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
      [lockedUser("/api/uploads/avatars/9-new.webp")],
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
    install([reportTargets, [/SELECT pseudo, avatar_url, is_deleted FROM bg_users/, () => [[{ pseudo: "Nova", avatar_url: null, is_deleted: 0 }]]]]);
    await expect(hideUserAvatarForReport(12, 9, actor)).rejects.toThrow("USER_HAS_NO_AVATAR");

    install([reportTargets, [/SELECT pseudo, avatar_url, is_deleted FROM bg_users/, () => [[{ pseudo: "Nova", avatar_url: "https://x.test/a.webp", is_deleted: 0 }]]]]);
    await expect(hideUserAvatarForReport(12, 9, actor)).rejects.toThrow("AVATAR_NOT_MOVABLE");
    expect(rename).not.toHaveBeenCalled();
  });

  it("refuse clairement un avatar dont le fichier n'existe plus, sans rien écrire", async () => {
    jest.mocked(rename).mockRejectedValueOnce(Object.assign(new Error("absent"), { code: "ENOENT" }));
    install([reportTargets, user], []);
    await expect(hideUserAvatarForReport(12, 9, actor)).rejects.toThrow("AVATAR_FILE_MISSING");
    expect(connection.execute).not.toHaveBeenCalled();
  });

  // Revue sécurité #571, cycle 4 (D6) : l'avatar du masque d'un compte en
  // attente se masque comme les autres, retiré du masque et non de la ligne.
  it("hideUserAvatarForReport_pendingAccount_clearsHeldAvatarNotUserRow", async () => {
    const held: Route = [/SELECT pseudo, avatar_url FROM bg_account_deletion_holds/, () => [[{ pseudo: "Nova", avatar_url: AVATAR }]]];
    install(
      [reportTargets, [user[0], () => [[{ pseudo: "Anonyme-3", avatar_url: null, is_deleted: 1 }]]], held, recipient],
      [
        lockedUser(null, 1),
        held,
        [/UPDATE bg_account_deletion_holds SET avatar_url = \? WHERE user_id = \?/, () => [{}]],
        [/INSERT INTO bg_logo_quarantines/, () => [{ insertId: 51 }]],
      ],
    );

    const view = await hideUserAvatarForReport(12, 9, actor);

    expect(view).toEqual(expect.objectContaining({ id: 51, status: "HIDDEN" }));
    expect(rename).toHaveBeenCalledWith(LIVE_AVATAR, HIDDEN_AVATAR);
    expect(connection.execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bg_account_deletion_holds SET avatar_url = \?/), [null, 9]);
    expect(connection.execute.mock.calls.some(([sql]) => /UPDATE bg_users SET avatar_url/.test(sql))).toBe(false);
    expect(syncSoloEntryIdentityOn).not.toHaveBeenCalled();
  });

  it("hideUserAvatarForReport_reactivatedDuringMove_throwsAvatarChanged", async () => {
    const held: Route = [/SELECT pseudo, avatar_url FROM bg_account_deletion_holds/, () => [[{ pseudo: "Nova", avatar_url: AVATAR }]]];
    install([reportTargets, [user[0], () => [[{ pseudo: "Anonyme-3", avatar_url: null, is_deleted: 1 }]]], held], [lockedUser(AVATAR, 0)]);

    await expect(hideUserAvatarForReport(12, 9, actor)).rejects.toThrow("AVATAR_CHANGED");

    expect(connection.rollback).toHaveBeenCalled();
    expect(unlink).toHaveBeenCalledWith(HIDDEN_AVATAR);
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
        [/SELECT logo_url FROM bg_teams WHERE id = \? FOR UPDATE/, () => [[{ logo_url: null }]]],
        [/UPDATE bg_teams SET logo_url = \?/, () => [{}]],
        [/SET status = 'RESTORED'/, () => [{}]],
      ],
    );
    await restoreReportedImage(30, actor);
    await flush();
    expect(rename).toHaveBeenCalledWith(HIDDEN, LIVE);
    expect(connection.execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bg_teams SET logo_url = \?/), [LOGO, 4]);
    expect(connection.commit).toHaveBeenCalled();
    expect(invalidateTeamIdentityViews).toHaveBeenCalledTimes(1);
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls[0][2]).toBe("logo-restored");
  });

  it("restoreReportedImage_hiddenRotationFails_stillRotatesHeldAvatar", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(rotateHiddenAvatarFile).mockRejectedValueOnce(new Error("EBUSY"));
    install(
      [[/FROM bg_users\s+WHERE id = \? AND is_deleted = 0/, () => [[{ pseudo: "Nova", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]]]],
      [
        [/FROM bg_logo_quarantines q[\s\S]*FOR UPDATE/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SELECT pseudo, avatar_url, is_deleted FROM bg_users WHERE id = \? FOR UPDATE/, () => [[{ pseudo: "Nova", avatar_url: null, is_deleted: 0 }]]],
        [/UPDATE bg_users SET avatar_url = \?/, () => [{}]],
        [/SET status = 'RESTORED'/, () => [{}]],
      ],
    );
    await restoreReportedImage(30, actor);
    await flush();

    expect(rotateHeldAvatarFile).toHaveBeenCalledWith(9);
    log.mockRestore();
  });

  it("remet l'avatar à la même adresse, resynchronise l'entrée solo et prévient le joueur", async () => {
    install(
      [[/FROM bg_users\s+WHERE id = \? AND is_deleted = 0/, () => [[{ pseudo: "Nova", discord_id: "900000000000000005", discord_pseudo: null, discord_verified_at: null }]]]],
      [
        [/FROM bg_logo_quarantines q[\s\S]*FOR UPDATE/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SELECT pseudo, avatar_url, is_deleted FROM bg_users WHERE id = \? FOR UPDATE/, () => [[{ pseudo: "Nova", avatar_url: null, is_deleted: 0 }]]],
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
    // Compte en attente de suppression : l'avatar rendu au masque change d'adresse aussi.
    expect(rotateHeldAvatarFile).toHaveBeenCalledWith(9);
    expect(connection.commit).toHaveBeenCalled();
    expect(invalidateLandingTeamViews).toHaveBeenCalledTimes(1);
    expect(invalidateTeamIdentityViews).not.toHaveBeenCalled();
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
        [/SELECT logo_url FROM bg_teams/, () => [[{ logo_url: "/api/uploads/teams/4-new.webp" }]]],
        [/SET contest_outcome = 'OVERTURNED'\s+WHERE id = \?/, () => [{ affectedRows: 1 }]],
      ],
    );
    await expect(restoreReportedImage(30, actor)).rejects.toThrow("TEAM_HAS_NEW_LOGO");
    expect(rename).not.toHaveBeenCalled();
  });

  it("n'écrase pas un avatar envoyé depuis", async () => {
    install(
      [],
      [
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SELECT pseudo, avatar_url, is_deleted FROM bg_users/, () => [[{ pseudo: "Nova", avatar_url: "/api/uploads/avatars/9-new.webp", is_deleted: 0 }]]],
        [/SET contest_outcome = 'OVERTURNED'\s+WHERE id = \?/, () => [{ affectedRows: 1 }]],
      ],
    );
    await expect(restoreReportedImage(30, actor)).rejects.toThrow("USER_HAS_NEW_AVATAR");
    expect(rename).not.toHaveBeenCalled();
  });

  // D23 : la contestation est acceptée même si l'avatar ne peut pas revenir —
  // l'issue est écrite pour que la suppression qui suivra ne bloque rien.
  // Revue sécurité #571, cycle 1 : l'issue est écrite sous le verrou de la
  // ligne, et commitée — une purge qui attendait la voit.
  it("restoreReportedImage_userHasNewAvatar_commitsOverturnedUnderLock", async () => {
    install(
      [],
      [
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SELECT pseudo, avatar_url, is_deleted FROM bg_users/, () => [[{ pseudo: "Nova", avatar_url: "/api/uploads/avatars/9-new.webp", is_deleted: 0 }]]],
        [/SET contest_outcome = 'OVERTURNED'\s+WHERE id = \?/, () => [{ affectedRows: 1 }]],
      ],
    );

    await expect(restoreReportedImage(30, actor)).rejects.toThrow("USER_HAS_NEW_AVATAR");

    expect(connection.execute).toHaveBeenCalledWith(expect.stringMatching(/SET contest_outcome = 'OVERTURNED'\s+WHERE id = \?/), [30]);
    expect(connection.commit).toHaveBeenCalled();
    expect(pool.execute).not.toHaveBeenCalledWith(expect.stringMatching(/contest_outcome/), expect.anything());
    // Revue sécurité #571, cycle 2 : journalisée comme une issue écrite, sans pseudo.
    const [staffLine] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(staffLine).toContain("acceptée");
    expect(staffLine).not.toContain("Nova");
  });

  // Revue sécurité #571, cycle 3 : un second clic ne réannonce pas la même issue.
  it("restoreReportedImage_userHasNewAvatarAlreadyOverturned_noSecondAnnouncement", async () => {
    install(
      [],
      [
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SELECT pseudo, avatar_url, is_deleted FROM bg_users/, () => [[{ pseudo: "Nova", avatar_url: "/api/uploads/avatars/9-new.webp", is_deleted: 0 }]]],
        [/SET contest_outcome = 'OVERTURNED'\s+WHERE id = \?/, () => [{ affectedRows: 0 }]],
      ],
    );

    await expect(restoreReportedImage(30, actor)).rejects.toThrow("USER_HAS_NEW_AVATAR");

    expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining("contest_outcome <> 'OVERTURNED'"), [30]);
    expect(publishStaffAction).not.toHaveBeenCalled();
  });

  it("restoreReportedImage_announcementFails_keepsOriginalRefusal", async () => {
    install(
      [],
      [
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SELECT pseudo, avatar_url, is_deleted FROM bg_users/, () => [[{ pseudo: "Nova", avatar_url: "/api/uploads/avatars/9-new.webp", is_deleted: 0 }]]],
        [/SET contest_outcome = 'OVERTURNED'\s+WHERE id = \?/, () => [{ affectedRows: 1 }]],
      ],
    );
    jest.mocked(publishStaffAction).mockImplementationOnce(() => {
      throw new Error("BOT_DOWN");
    });
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(restoreReportedImage(30, actor)).rejects.toThrow("USER_HAS_NEW_AVATAR");

    logged.mockRestore();
  });

  it("restoreReportedImage_success_setsOverturned", async () => {
    install(
      [[/FROM bg_team_members tm/, () => [[]]]],
      [
        [/FROM bg_logo_quarantines q[\s\S]*FOR UPDATE/, () => [[quarantineRow()]]],
        [/SELECT logo_url FROM bg_teams WHERE id = \? FOR UPDATE/, () => [[{ logo_url: null }]]],
        [/UPDATE bg_teams SET logo_url = \?/, () => [{}]],
        [/SET status = 'RESTORED'/, () => [{}]],
      ],
    );

    await restoreReportedImage(30, actor);

    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringMatching(/SET status = 'RESTORED'.*contest_outcome = 'OVERTURNED'/),
      [30],
    );
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
        [/SELECT logo_url FROM bg_teams/, () => [[{ logo_url: null }]]],
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
        [/SELECT pseudo, avatar_url, is_deleted FROM bg_users/, () => [[{ pseudo: "Nova", avatar_url: null, is_deleted: 0 }]]],
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

  // Revue sécurité #571, cycle 4 (D6) : rétabli dans le masque d'un compte en
  // attente, que la réactivation rendra — jamais sur sa ligne anonyme.
  it("restoreReportedImage_pendingAccount_writesAvatarBackIntoHold", async () => {
    install(
      [],
      [
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SELECT pseudo, avatar_url, is_deleted FROM bg_users/, () => [[{ pseudo: "Anonyme-3", avatar_url: null, is_deleted: 1 }]]],
        [/SELECT pseudo, avatar_url FROM bg_account_deletion_holds/, () => [[{ pseudo: "Nova", avatar_url: null }]]],
        [/UPDATE bg_account_deletion_holds SET avatar_url = \? WHERE user_id = \?/, () => [{}]],
        [/SET status = 'RESTORED'/, () => [{}]],
      ],
    );

    await restoreReportedImage(30, actor);

    expect(connection.execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bg_account_deletion_holds SET avatar_url = \?/), [AVATAR, 9]);
    expect(connection.execute.mock.calls.some(([sql]) => /UPDATE bg_users SET avatar_url/.test(sql))).toBe(false);
    expect(syncSoloEntryIdentityOn).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalled();
  });

  it("restoreReportedImage_anonymisedAccount_throwsQuarantineNotFound", async () => {
    install(
      [],
      [
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SELECT pseudo, avatar_url, is_deleted FROM bg_users/, () => [[{ pseudo: "Anonyme-3", avatar_url: null, is_deleted: 1 }]]],
        [/SELECT pseudo, avatar_url FROM bg_account_deletion_holds/, () => [[]]],
      ],
    );

    await expect(restoreReportedImage(30, actor)).rejects.toThrow("QUARANTINE_NOT_FOUND");

    expect(rename).not.toHaveBeenCalled();
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
    // Un logo d'équipe n'est pas bloqué (D6 ne vise que l'avatar).
    expect(blockImageHashOn).not.toHaveBeenCalled();
    expect(jest.mocked(connection.commit).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(unlink).mock.invocationCallOrder[0],
    );
    expect(publishStaffAction).toHaveBeenCalledWith(expect.stringContaining("supprimé définitivement par le staff"), {
      id: 1,
      pseudo: "Admin",
    }, { category: "moderation" });
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
    // D6 : l'avatar supprimé est bloqué, dans la transaction qui le supprime,
    // avant que le fichier en quarantaine ne parte ; son empreinte est gardée (D18).
    expect(blockImageHashOn).toHaveBeenCalledWith(expect.anything(), sha(HIDDEN_AVATAR));
    expect(jest.mocked(blockImageHashOn).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(connection.commit).mock.invocationCallOrder[0],
    );
    expect(jest.mocked(connection.commit).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(unlink).mock.invocationCallOrder[0],
    );
    const purge = connection.execute.mock.calls.find(([sql]) => /SET status = 'PURGED'/.test(sql));
    expect(purge?.[1]).toEqual([sha(HIDDEN_AVATAR), 1, 30]);
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
      [
        [/^SELECT id, contest_role FROM bg_reports WHERE parent_report_id = \? LOCK IN SHARE MODE/, () => [[]]],
        [/SELECT status FROM bg_reports WHERE id = \? FOR UPDATE/, () => [[{ status: "OPEN" }]]],
        [/FROM bg_logo_quarantines q/, (params) => [[quarantineRow({ id: (params as number[])[0] })]]],
        [/SET status = 'PURGED'/, () => [{}]],
      ],
    );
    await expect(purgeDueQuarantines(new Date("2026-07-01T00:00:00Z"))).resolves.toBe(2);
    const purged = connection.execute.mock.calls.filter(([sql]) => /SET status = 'PURGED'/.test(sql)).map(([, p]) => p);
    expect(purged).toEqual([[null, 0, 30], [null, 0, 32]]);
    expect(publishStaffAction).not.toHaveBeenCalled();
    // À l'échéance, le message du masquage a déjà annoncé la date.
    await flush();
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  // Revue sécurité #571 (D6) : un avatar contesté puis tranché n'est pas dit supprimé
  // par la modération — l'issue n'est pas écrite (contestation acceptée, rétablissement refusé).
  it("purgeDueQuarantines_contestedSettledAvatar_purgesWithoutBlocking", async () => {
    install(
      [[/FROM bg_logo_quarantines q\s+LEFT JOIN bg_reports r/, () => [[
        { id: 30, purge_after: new Date("2026-06-30T00:00:00Z"), report_id: 12, report_status: "RESOLVED", contested: 1 },
      ]]]],
      [
        [/^SELECT id, contest_role FROM bg_reports WHERE parent_report_id = \? LOCK IN SHARE MODE/, () => [[{ id: 60, contest_role: "TARGET" }]]],
        [/SELECT status FROM bg_reports WHERE id = \? FOR UPDATE/, () => [[{ status: "RESOLVED" }]]],
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SET status = 'PURGED'/, () => [{}]],
      ],
    );

    await expect(purgeDueQuarantines(new Date("2026-07-01T00:00:00Z"))).resolves.toBe(1);

    expect(unlink).toHaveBeenCalledWith(HIDDEN_AVATAR);
    expect(blockImageHashOn).not.toHaveBeenCalled();
    // L'empreinte reste gardée : une issue « maintenue » écrite après coup la
    // bloquera (D22) ; la ligne ne justifie aucun blocage (`hash_blocked = 0`).
    const purge = connection.execute.mock.calls.find(([sql]) => /SET status = 'PURGED'/.test(sql));
    expect(purge?.[1]).toEqual([sha(HIDDEN_AVATAR), 0, 30]);
  });

  it("purgeDueQuarantines_uncontestedAvatar_blocksHash", async () => {
    install(
      [[/FROM bg_logo_quarantines q\s+LEFT JOIN bg_reports r/, () => [[
        { id: 30, purge_after: new Date("2026-06-30T00:00:00Z"), report_id: 12, report_status: "OPEN", contested: 0 },
      ]]]],
      [
        [/^SELECT id, contest_role FROM bg_reports WHERE parent_report_id = \? LOCK IN SHARE MODE/, () => [[]]],
        [/SELECT status FROM bg_reports WHERE id = \? FOR UPDATE/, () => [[{ status: "OPEN" }]]],
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SET status = 'PURGED'/, () => [{}]],
      ],
    );

    await purgeDueQuarantines(new Date("2026-07-01T00:00:00Z"));

    expect(blockImageHashOn).toHaveBeenCalledWith(expect.anything(), sha(HIDDEN_AVATAR));
  });

  // Revue sécurité #571, cycle 2 : une contestation déposée après la relève est
  // vue sous verrou — rien n'est supprimé ni bloqué.
  it("purgeDueQuarantines_contestFiledAfterScan_skipsUnderLock", async () => {
    install(
      [[/FROM bg_logo_quarantines q\s+LEFT JOIN bg_reports r/, () => [[
        { id: 30, purge_after: new Date("2026-06-30T00:00:00Z"), report_id: 12, report_status: "OPEN", contested: 0 },
      ]]]],
      [
        [/^SELECT id, contest_role FROM bg_reports WHERE parent_report_id = \? LOCK IN SHARE MODE/, () => [[{ id: 60, contest_role: "TARGET" }]]],
        [/SELECT status FROM bg_reports WHERE id = \? FOR UPDATE/, () => [[{ status: "OPEN" }]]],
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SET status = 'PURGED'/, () => [{}]],
      ],
    );

    await expect(purgeDueQuarantines(new Date("2026-07-01T00:00:00Z"))).resolves.toBe(0);

    expect(connection.execute.mock.calls.some(([sql]) => /SET status = 'PURGED'/.test(sql))).toBe(false);
    expect(connection.rollback).toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(blockImageHashOn).not.toHaveBeenCalled();
  });

  // Revue sécurité #571, cycle 3 : sans signalement d'origine, aucune contestation
  // possible — ni verrou de signalement ni relecture.
  it("purgeDueQuarantines_noReport_skipsReportAndContestQueries", async () => {
    install(
      [[/FROM bg_logo_quarantines q\s+LEFT JOIN bg_reports r/, () => [[
        { id: 30, purge_after: new Date("2026-06-30T00:00:00Z"), report_id: null, report_status: null, contested: 0 },
      ]]]],
      [
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ report_id: null, target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SET status = 'PURGED'/, () => [{}]],
      ],
    );

    await expect(purgeDueQuarantines(new Date("2026-07-01T00:00:00Z"))).resolves.toBe(1);

    expect(connection.execute.mock.calls.some(([sql]) => /bg_reports/.test(sql))).toBe(false);
    expect(blockImageHashOn).toHaveBeenCalledWith(expect.anything(), sha(HIDDEN_AVATAR));
  });

  it("purgeDueQuarantines_contestReread_parameterisedOnReportId", async () => {
    install(
      [[/FROM bg_logo_quarantines q\s+LEFT JOIN bg_reports r/, () => [[
        { id: 30, purge_after: new Date("2026-06-30T00:00:00Z"), report_id: 12, report_status: "OPEN", contested: 0 },
      ]]]],
      [
        [/^SELECT id, contest_role FROM bg_reports WHERE parent_report_id = \? LOCK IN SHARE MODE/, () => [[]]],
        [/SELECT status FROM bg_reports WHERE id = \? FOR UPDATE/, () => [[{ status: "OPEN" }]]],
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
        [/SET status = 'PURGED'/, () => [{}]],
      ],
    );

    await purgeDueQuarantines(new Date("2026-07-01T00:00:00Z"));

    const contest = connection.execute.mock.calls.find(([sql]) => /^SELECT id, contest_role FROM bg_reports/.test(sql));
    expect(contest?.[1]).toEqual([12]);
    const lock = connection.execute.mock.calls.findIndex(([sql]) => /SELECT status FROM bg_reports WHERE id = \? FOR UPDATE/.test(sql));
    expect(lock).toBeLessThan(connection.execute.mock.calls.findIndex(([sql]) => /^SELECT id, contest_role FROM bg_reports/.test(sql)));
  });

  it("purgeQuarantinedLogo_byStaff_neverRereadsContest", async () => {
    install([], [
      [/FROM bg_logo_quarantines q/, () => [[quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR })]]],
      [/SET status = 'PURGED'/, () => [{}]],
    ]);

    await expect(purgeQuarantinedLogo(30, actor)).resolves.toBe(true);

    expect(blockImageHashOn).toHaveBeenCalledWith(expect.anything(), sha(HIDDEN_AVATAR));
  });

  it("ne compte pas la contestation de l'auteur du signalement : elle ne défend pas l'image", async () => {
    install([[/FROM bg_logo_quarantines q\s+LEFT JOIN bg_reports r/, () => [[]]]]);
    await purgeDueQuarantines(new Date("2026-07-01T00:00:00Z"));
    const [sql] = pool.execute.mock.calls[0];
    // Qui conteste est lu tel qu'écrit à la contestation, jamais redéduit de
    // l'appartenance du jour ; une contestation d'avant la colonne compte.
    expect(sql).toMatch(/c\.contest_role IS NULL OR c\.contest_role = 'TARGET'/);
    expect(sql).not.toMatch(/bg_team_members/);
    // La réouverture par l'auteur ne remet pas en attente ce qui était tranché :
    // seule une contestation de personne visée postérieure à la sienne compte.
    expect(sql).toMatch(/c\.id > COALESCE\(\(SELECT MAX\(n\.id\)[\s\S]*n\.contest_role = 'NOTIFIER'\), 0\)/);
  });
});

describe("removeModeratedAvatarFile", () => {
  // Revue sécurité #571 : tout avatar téléversé est bloqué avant d'être effacé,
  // même sous un nom de fichier antérieur à la règle actuelle.
  it("removeModeratedAvatarFile_legacyFilename_blocksThenDeletesIfUnreferenced", async () => {
    const legacy = path.join(process.cwd(), "public", "uploads", "avatars", "old.name.png");

    await removeModeratedAvatarFile("/api/uploads/avatars/old.name.png");

    expect(blockImageHashesSafely).toHaveBeenCalledWith([sha(legacy)]);
    expect(deleteUnreferencedUpload).toHaveBeenCalledWith("/api/uploads/avatars/old.name.png", "avatars");
    expect(jest.mocked(blockImageHashesSafely).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(deleteUnreferencedUpload).mock.invocationCallOrder[0],
    );
  });

  // Revue sécurité #571, cycle 3 : un fichier encore désigné ailleurs (adresse
  // recopiée, masque de suppression) reste ; seule l'empreinte est bloquée.
  it("removeModeratedAvatarFile_sharedFile_neverUnlinksDirectly", async () => {
    await removeModeratedAvatarFile(AVATAR);

    expect(blockImageHashesSafely).toHaveBeenCalledWith([sha(LIVE_AVATAR)]);
    expect(unlink).not.toHaveBeenCalled();
    expect(deleteUnreferencedUpload).toHaveBeenCalledWith(AVATAR, "avatars");
  });

  it.each<[string, string]>([
    ["https://cdn.discordapp.com/avatars/1/a.png", "adresse étrangère"],
    ["/api/uploads/teams/4-abc.webp", "autre dossier"],
    ["/api/uploads/avatars/../teams/4-abc.webp", "traversée de chemin"],
  ])("removeModeratedAvatarFile_notAnAvatarUpload_noop (%s, %s)", async (url) => {
    await removeModeratedAvatarFile(url);

    expect(blockImageHashesSafely).not.toHaveBeenCalled();
    expect(deleteUnreferencedUpload).not.toHaveBeenCalled();
  });
});


describe("removeModeratedAvatarFile — fichier partagé", () => {
  // Revue sécurité #571, cycle 4 : le fichier encore désigné ailleurs reste.
  it("removeModeratedAvatarFile_stillReferenced_blocksButKeepsFile", async () => {
    jest.mocked(isUploadReferenced).mockResolvedValue(true);
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await removeModeratedAvatarFile(AVATAR);

    expect(blockImageHashesSafely).toHaveBeenCalledWith([sha(LIVE_AVATAR)]);
    expect(deleteUnreferencedUpload).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("fichier gardé et servi"));
    logged.mockRestore();
  });

  it("removeModeratedAvatarFile_referenceCheckFails_keepsFile", async () => {
    jest.mocked(isUploadReferenced).mockRejectedValue(new Error("ECONNRESET"));
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await removeModeratedAvatarFile(AVATAR);

    expect(blockImageHashesSafely).toHaveBeenCalledWith([sha(LIVE_AVATAR)]);
    expect(deleteUnreferencedUpload).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("purgeQuarantinedLogo — issue écrite (D22, D23)", () => {
  const userRow = (outcome: string | null) =>
    quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR, contest_outcome: outcome });

  it("purgeQuarantinedLogo_staffAfterOverturned_noBlock", async () => {
    install([], [
      [/FROM bg_logo_quarantines q/, () => [[userRow("OVERTURNED")]]],
      [/SET status = 'PURGED'/, () => [{}]],
    ]);

    await expect(purgeQuarantinedLogo(30, actor)).resolves.toBe(true);

    expect(blockImageHashOn).not.toHaveBeenCalled();
    expect(unlink).toHaveBeenCalledWith(HIDDEN_AVATAR);
  });

  it("purgeDueQuarantines_contestedUpheld_blocks", async () => {
    install(
      [[/FROM bg_logo_quarantines q\s+LEFT JOIN bg_reports r/, () => [[
        { id: 30, purge_after: new Date("2026-06-30T00:00:00Z"), report_id: 12, report_status: "RESOLVED", contested: 1 },
      ]]]],
      [
        [/^SELECT id, contest_role FROM bg_reports WHERE parent_report_id = \? LOCK IN SHARE MODE/, () => [[{ id: 60, contest_role: "TARGET" }]]],
        [/SELECT status FROM bg_reports WHERE id = \? FOR UPDATE/, () => [[{ status: "RESOLVED" }]]],
        [/FROM bg_logo_quarantines q/, () => [[userRow("UPHELD")]]],
        [/SET status = 'PURGED'/, () => [{}]],
      ],
    );

    await expect(purgeDueQuarantines(new Date("2026-07-01T00:00:00Z"))).resolves.toBe(1);

    expect(blockImageHashOn).toHaveBeenCalledWith(expect.anything(), sha(HIDDEN_AVATAR));
  });
});

describe("recordContestOutcome", () => {
  const purgedAvatar = (overrides: Record<string, unknown> = {}) =>
    quarantineRow({
      target_type: "USER",
      target_id: 9,
      target_name: "Nova",
      logo_url: AVATAR,
      status: "PURGED",
      image_sha256: "abc",
      ...overrides,
    });
  const lockRow = (row: unknown): Route => [/FROM bg_logo_quarantines q[\s\S]*FOR UPDATE/, () => [[row]]];
  const writeOutcome: Route = [/UPDATE bg_logo_quarantines SET contest_outcome = \? WHERE id = \?/, () => [{}]];
  const writeHashBlocked: Route = [/UPDATE bg_logo_quarantines SET hash_blocked = \? WHERE id = \?/, () => [{}]];

  it("recordContestOutcome_purgedAvatarOverturned_unblocksInTransaction", async () => {
    install([], [lockRow(purgedAvatar()), writeOutcome, writeHashBlocked]);
    jest.mocked(unblockImageHashOn).mockResolvedValue(true);

    const result = await recordContestOutcome(30, "OVERTURNED", actor);

    expect(result).toEqual({ blocked: false, hashUnknown: false });
    expect(unblockImageHashOn).toHaveBeenCalledWith(expect.anything(), "abc", 30);
    expect(connection.execute).toHaveBeenCalledWith(expect.stringMatching(/SET contest_outcome = \?/), ["OVERTURNED", 30]);
    // Annulée, cette décision ne justifie plus aucun blocage.
    expect(connection.execute).toHaveBeenCalledWith(expect.stringMatching(/SET hash_blocked = \?/), [0, 30]);
    expect(jest.mocked(unblockImageHashOn).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(connection.commit).mock.invocationCallOrder[0],
    );
    const [staffLine] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(staffLine).toContain("acceptée");
    expect(staffLine).toContain("un joueur");
    expect(staffLine).not.toContain("Nova");
  });

  it("recordContestOutcome_purgedAvatarOverturnedOtherRemoval_staysBlocked", async () => {
    install([], [
      lockRow(purgedAvatar()),
      writeOutcome,
      writeHashBlocked,
      [/SELECT 1 FROM bg_blocked_image_hashes WHERE sha256 = \?/, () => [[{ 1: 1 }]]],
    ]);
    jest.mocked(unblockImageHashOn).mockResolvedValue(false);

    await expect(recordContestOutcome(30, "OVERTURNED", actor)).resolves.toEqual({ blocked: true, hashUnknown: false });
  });

  it("recordContestOutcome_purgedAvatarUpheld_blocks", async () => {
    install([], [lockRow(purgedAvatar()), writeOutcome, writeHashBlocked]);

    await expect(recordContestOutcome(30, "UPHELD", actor)).resolves.toEqual({ blocked: true, hashUnknown: false });

    expect(blockImageHashOn).toHaveBeenCalledWith(expect.anything(), "abc");
    expect(connection.execute).toHaveBeenCalledWith(expect.stringMatching(/SET hash_blocked = \?/), [1, 30]);
    expect(unblockImageHashOn).not.toHaveBeenCalled();
  });

  it("recordContestOutcome_purgedWithoutSha_hashUnknown", async () => {
    install([], [lockRow(purgedAvatar({ image_sha256: null })), writeOutcome]);

    await expect(recordContestOutcome(30, "OVERTURNED", actor)).resolves.toEqual({ blocked: null, hashUnknown: true });

    expect(unblockImageHashOn).not.toHaveBeenCalled();
  });

  it("recordContestOutcome_hiddenAvatar_writesOutcomeOnly", async () => {
    install([], [lockRow(purgedAvatar({ status: "HIDDEN" })), writeOutcome]);

    await expect(recordContestOutcome(30, "UPHELD", actor)).resolves.toEqual({ blocked: null, hashUnknown: false });

    expect(blockImageHashOn).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalled();
  });

  // Revue sécurité #571, cycle 1 : une image masquée dont la contestation
  // aboutit se rétablit ; l'accepter seulement laisserait la purge sans blocage.
  it("recordContestOutcome_hiddenOverturned_throwsStillHidden", async () => {
    install([], [lockRow(purgedAvatar({ status: "HIDDEN" }))]);

    await expect(recordContestOutcome(30, "OVERTURNED", actor)).rejects.toThrow("QUARANTINE_STILL_HIDDEN");

    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringMatching(/SET contest_outcome = \?/), expect.anything());
    expect(publishStaffAction).not.toHaveBeenCalled();
  });

  it("recordContestOutcome_restored_throwsClosed", async () => {
    install([], [lockRow(purgedAvatar({ status: "RESTORED" }))]);

    await expect(recordContestOutcome(30, "UPHELD", actor)).rejects.toThrow("QUARANTINE_CLOSED");

    expect(connection.rollback).toHaveBeenCalled();
    expect(publishStaffAction).not.toHaveBeenCalled();
  });

  it("recordContestOutcome_missing_throwsNotFound", async () => {
    install([], [[/FROM bg_logo_quarantines q[\s\S]*FOR UPDATE/, () => [[]]]]);

    await expect(recordContestOutcome(30, "UPHELD", actor)).rejects.toThrow("QUARANTINE_NOT_FOUND");
  });
});

describe("ordre des verrous — compte avant quarantaine (comme l'effacement)", () => {
  const avatarRow = (status: string) =>
    quarantineRow({ target_type: "USER", target_id: 9, target_name: "Nova", logo_url: AVATAR, status, image_sha256: "abc" });
  const owner: Route = [/SELECT user_id FROM bg_logo_quarantines WHERE id = \? LIMIT 1/, () => [[{ user_id: 9 }]]];
  const lockUser: Route = [/SELECT id FROM bg_users WHERE id = \? FOR UPDATE/, () => [[{ id: 9 }]]];

  /** Rang du verrou du compte et de celui de la quarantaine parmi les requêtes de la connexion. */
  function lockRanks(): { user: number; quarantine: number } {
    const sqls = connection.execute.mock.calls.map(([sql]) => sql);
    return {
      user: sqls.findIndex((sql) => /SELECT id FROM bg_users WHERE id = \? FOR UPDATE/.test(sql)),
      quarantine: sqls.findIndex((sql) => /FROM bg_logo_quarantines q[\s\S]*FOR UPDATE/.test(sql)),
    };
  }

  it("recordContestOutcome_avatar_locksUserBeforeQuarantine", async () => {
    install([], [
      owner,
      lockUser,
      [/FROM bg_logo_quarantines q[\s\S]*FOR UPDATE/, () => [[avatarRow("PURGED")]]],
      [/UPDATE bg_logo_quarantines SET/, () => [{}]],
    ]);

    await recordContestOutcome(30, "UPHELD", actor);

    const ranks = lockRanks();
    expect(ranks.user).toBe(1);
    expect(ranks.quarantine).toBe(2);
    expect(connection.execute).toHaveBeenCalledWith(expect.stringMatching(/FROM bg_users WHERE id = \? FOR UPDATE/), [9]);
    // Le compte visé est lu sur la connexion du geste, avant sa transaction.
    expect(connection.execute.mock.calls[0][0]).toMatch(/SELECT user_id FROM bg_logo_quarantines WHERE id = \? LIMIT 1/);
    expect(connection.execute.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(connection.beginTransaction).mock.invocationCallOrder[0]);
  });

  it("purgeQuarantinedLogo_avatar_locksUserBeforeQuarantine", async () => {
    install([], [
      owner,
      lockUser,
      [/FROM bg_logo_quarantines q[\s\S]*FOR UPDATE/, () => [[avatarRow("HIDDEN")]]],
      [/SET status = 'PURGED'/, () => [{}]],
    ]);

    await expect(purgeQuarantinedLogo(30, actor)).resolves.toBe(true);

    expect(lockRanks()).toEqual({ user: 1, quarantine: 2 });
  });

  it("restoreReportedImage_avatar_locksUserBeforeQuarantine", async () => {
    install([], [
      owner,
      lockUser,
      [/FROM bg_logo_quarantines q[\s\S]*FOR UPDATE/, () => [[avatarRow("HIDDEN")]]],
      [/SELECT pseudo, avatar_url, is_deleted FROM bg_users WHERE id = \? FOR UPDATE/, () => [[{ pseudo: "Nova", avatar_url: null, is_deleted: 0 }]]],
      [/UPDATE bg_users SET avatar_url = \?/, () => [{}]],
      [/SET status = 'RESTORED'/, () => [{}]],
    ]);

    await restoreReportedImage(30, actor);

    expect(lockRanks()).toEqual({ user: 1, quarantine: 2 });
  });

  it("recordContestOutcome_teamLogo_takesNoUserLock", async () => {
    install([], [
      [/FROM bg_logo_quarantines q[\s\S]*FOR UPDATE/, () => [[quarantineRow({ status: "PURGED" })]]],
      [/UPDATE bg_logo_quarantines SET/, () => [{}]],
    ]);

    await recordContestOutcome(30, "UPHELD", actor);

    expect(lockRanks()).toEqual({ user: -1, quarantine: 1 });
  });

  it("recordContestOutcome_ownerReadFails_noTransactionStarted", async () => {
    install([], [[/SELECT user_id FROM bg_logo_quarantines/, () => { throw new Error("ER_LOCK_WAIT_TIMEOUT"); }]]);

    await expect(recordContestOutcome(30, "UPHELD", actor)).rejects.toThrow("ER_LOCK_WAIT_TIMEOUT");

    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalled();
  });
});

describe("targetContestPending", () => {
  it("targetContestPending_targetAfterLastNotifier_true", () => {
    expect(targetContestPending([{ id: 5, contest_role: "NOTIFIER" }, { id: 7, contest_role: "TARGET" }])).toBe(true);
  });

  it("targetContestPending_targetBeforeNotifier_false", () => {
    expect(targetContestPending([{ id: 5, contest_role: "TARGET" }, { id: 7, contest_role: "NOTIFIER" }])).toBe(false);
  });

  it("targetContestPending_legacyNullRole_true", () => {
    expect(targetContestPending([{ id: 5, contest_role: null }])).toBe(true);
  });

  it("targetContestPending_notifierOnly_false", () => {
    expect(targetContestPending([{ id: 5, contest_role: "NOTIFIER" }])).toBe(false);
  });

  it("targetContestPending_none_false", () => {
    expect(targetContestPending([])).toBe(false);
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

// EF-24 : un logo retiré ou masqué par la modération ne reste pas servi par le
// leaderboard de l'accueil et de `/classement` (cache de la vitrine, 60 s).
describe("modération d'un logo d'équipe — vues de l'accueil", () => {
  const reportTargets: Route = [/JOIN bg_report_targets t ON t.report_id = r.id AND t.target_type = \?/, () => [[{ category: "COPYRIGHT" }]]];
  const members: Route = [/FROM bg_team_members tm\s+JOIN bg_users u/, () => [[]]];

  beforeEach(() => {
    clearCache();
  });

  it("deleteTeamLogoForReport_committed_clearsLandingLeaderboard", async () => {
    install(
      [reportTargets, members],
      [
        [/SELECT name, logo_url FROM bg_teams WHERE id = \? AND solo_user_id IS NULL FOR UPDATE/, () => [[{ name: "Alpha", logo_url: LOGO }]]],
        [/UPDATE bg_teams SET logo_url = NULL/, () => [{}]],
        [/COUNT\(\*\) AS total FROM bg_teams WHERE logo_url = \?/, () => [[{ total: 0 }]]],
        [/INSERT INTO bg_logo_quarantines/, () => [{ insertId: 33 }]],
      ],
    );
    const loader = jest.fn(async () => "rangs");
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    await deleteTeamLogoForReport(12, 4, actor);
    await flush();
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("hideTeamLogo_committed_clearsLandingLeaderboard", async () => {
    install(
      [
        reportTargets,
        [/SELECT name, logo_url FROM bg_teams/, () => [[{ name: "Alpha", logo_url: LOGO }]]],
        [/COUNT\(\*\) AS total FROM bg_teams WHERE logo_url = \? AND id <> \?/, () => [[{ total: 0 }]]],
        members,
      ],
      [
        [/SELECT logo_url FROM bg_teams WHERE id = \? FOR UPDATE/, () => [[{ logo_url: LOGO }]]],
        [/UPDATE bg_teams SET logo_url = NULL/, () => [{}]],
        [/INSERT INTO bg_logo_quarantines/, () => [{ insertId: 30 }]],
      ],
    );
    const loader = jest.fn(async () => "rangs");
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    await hideTeamLogo(12, 4, actor);
    await flush();
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("deleteTeamLogoForReport_refused_keepsLandingLeaderboard", async () => {
    install(
      [reportTargets, members],
      [[/SELECT name, logo_url FROM bg_teams WHERE id = \? AND solo_user_id IS NULL FOR UPDATE/, () => [[{ name: "Alpha", logo_url: null }]]]],
    );
    const loader = jest.fn(async () => "rangs");
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    await expect(deleteTeamLogoForReport(12, 4, actor)).rejects.toThrow();
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });
});
