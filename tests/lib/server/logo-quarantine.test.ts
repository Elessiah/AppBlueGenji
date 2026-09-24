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
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://site.test" }));

import { copyFile, rename, unlink } from "node:fs/promises";
import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { publishStaffAction } from "@/lib/server/staff-audit";
import {
  hideTeamLogo,
  logoFileLocations,
  purgeDueQuarantines,
  purgeQuarantinedLogo,
  quarantineDirectory,
  quarantinedLogoFile,
  restoreTeamLogo,
} from "@/lib/server/logo-quarantine";
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

let pool: { execute: jest.Mock<SqlQuery>; getConnection: () => Promise<unknown> };
let connection: ReturnType<typeof connectionMock>;

function install(poolRoutes: Route[], connectionRoutes: Route[] = []) {
  connection = connectionMock();
  connection.execute = routed(connectionRoutes);
  pool = { execute: routed(poolRoutes), getConnection: async () => fakeConnection(connection) };
  jest.mocked(getDatabase).mockResolvedValue(fakePool(pool));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);
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

describe("hideTeamLogo", () => {
  const reportTargets: Route = [/JOIN bg_report_targets t ON t.report_id = r.id AND t.target_type = 'TEAM'/, () => [[{ id: 12 }]]];
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

    const before = Date.now();
    const view = await hideTeamLogo(12, 4, actor);
    await flush();

    expect(rename).toHaveBeenCalledWith(LIVE, HIDDEN);
    expect(connection.commit).toHaveBeenCalled();
    expect(view).toEqual(expect.objectContaining({ id: 30, teamId: 4, teamName: "Alpha", reportId: 12, status: "HIDDEN" }));
    const days = (new Date(view.purgeAfter).getTime() - before) / 86_400_000;
    expect(Math.round(days)).toBe(180);

    expect(publishStaffAction).toHaveBeenCalledWith(expect.stringContaining("« Alpha » masqué"), { id: 1, pseudo: "Admin" });
    const [message, recipients, context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(context).toBe("logo-hidden");
    expect(message).toContain("https://site.test/signalements/12");
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

const quarantineRow = (overrides: Record<string, unknown> = {}) => ({
  id: 30,
  team_id: 4,
  team_name: "Alpha",
  report_id: 12,
  logo_url: LOGO,
  status: "HIDDEN",
  hidden_at: new Date("2026-01-01T00:00:00Z"),
  purge_after: new Date("2026-06-30T00:00:00Z"),
  closed_at: null,
  ...overrides,
});

describe("restoreTeamLogo", () => {
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
    await restoreTeamLogo(30, actor);
    await flush();
    expect(rename).toHaveBeenCalledWith(HIDDEN, LIVE);
    expect(connection.execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bg_teams SET logo_url = \?/), [LOGO, 4]);
    expect(connection.commit).toHaveBeenCalled();
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls[0][2]).toBe("logo-restored");
  });

  it("n'écrase pas un logo envoyé depuis", async () => {
    install(
      [],
      [
        [/FROM bg_logo_quarantines q/, () => [[quarantineRow()]]],
        [/SELECT logo_url FROM bg_teams/, () => [[{ logo_url: "/api/uploads/teams/4-new.webp" }]]],
      ],
    );
    await expect(restoreTeamLogo(30, actor)).rejects.toThrow("TEAM_HAS_NEW_LOGO");
    expect(rename).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("refuse une quarantaine déjà close ou inconnue", async () => {
    install([], [[/FROM bg_logo_quarantines q/, () => [[quarantineRow({ status: "PURGED" })]]]]);
    await expect(restoreTeamLogo(30, actor)).rejects.toThrow("QUARANTINE_CLOSED");
    install([], [[/FROM bg_logo_quarantines q/, () => [[]]]]);
    await expect(restoreTeamLogo(30, actor)).rejects.toThrow("QUARANTINE_NOT_FOUND");
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
    await expect(restoreTeamLogo(30, actor)).rejects.toThrow("ER_LOCK_DEADLOCK");
    expect(rename).toHaveBeenNthCalledWith(1, HIDDEN, LIVE);
    expect(rename).toHaveBeenNthCalledWith(2, LIVE, HIDDEN);
  });
});

describe("purgeQuarantinedLogo / purgeDueQuarantines", () => {
  it("clôt la quarantaine puis efface le fichier, après le commit", async () => {
    install([], [[/FROM bg_logo_quarantines q/, () => [[quarantineRow()]]], [/SET status = 'PURGED'/, () => [{}]]]);
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
  });
});

describe("quarantinedLogoFile", () => {
  it("ne sert que l'aperçu d'un logo encore masqué", async () => {
    install([[/SELECT logo_url, team_id, status FROM bg_logo_quarantines/, () => [[{ logo_url: LOGO, team_id: 4, status: "HIDDEN" }]]]]);
    await expect(quarantinedLogoFile(30)).resolves.toBe(HIDDEN);
    install([[/SELECT logo_url, team_id, status FROM bg_logo_quarantines/, () => [[{ logo_url: LOGO, team_id: 4, status: "RESTORED" }]]]]);
    await expect(quarantinedLogoFile(30)).resolves.toBeNull();
  });
});
