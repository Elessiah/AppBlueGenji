import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/logo-quarantine");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://site.test" }));

import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages, pushLeadershipAlert } from "@/lib/server/bot-integration";
import { listQuarantinesForReports, purgeDueQuarantines } from "@/lib/server/logo-quarantine";
import { publishStaffAction } from "@/lib/server/staff-audit";
import {
  applyReportAction,
  createReport,
  escapeLikePattern,
  getConcernedReport,
  listContestableReports,
  listReports,
  purgeExpiredReports,
  schedulePurgeExpiredReports,
  searchReportTargets,
} from "@/lib/server/content-reports";
import type { ReportSubmission } from "@/lib/shared/content-reports";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

type Route = [RegExp, (params: unknown) => unknown];

/**
 * Double SQL qui répond selon la requête plutôt que selon l'ordre : ces
 * services enchaînent des lectures dont l'ordre n'est pas ce qu'on teste.
 * Toute requête sans réponse prévue fait échouer le test.
 */
function routed(routes: Route[]): jest.Mock<SqlQuery> {
  return jest.fn<SqlQuery>(async (sql, params) => {
    const route = routes.find(([pattern]) => pattern.test(sql));
    if (!route) throw new Error(`requête inattendue : ${sql}`);
    return route[1](params);
  });
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

let pool: { execute: jest.Mock<SqlQuery>; getConnection: () => Promise<unknown> };
let connection: ReturnType<typeof connectionMock>;

function install(poolRoutes: Route[], connectionRoutes: Route[] = []) {
  connection = connectionMock();
  connection.execute = routed(connectionRoutes);
  pool = { execute: routed(poolRoutes), getConnection: async () => fakeConnection(connection) };
  jest.mocked(getDatabase).mockResolvedValue(fakePool(pool));
}

function submission(overrides: Partial<ReportSubmission> = {}): ReportSubmission {
  return {
    category: "COPYRIGHT",
    description: "Le logo de cette équipe reprend celui de notre club.",
    targets: [
      { type: "TEAM", id: 4 },
      { type: "USER", id: 8 },
    ],
    pagePath: "/equipes/4",
    contactName: "Club Exemple",
    contactEmail: "juridique@exemple.fr",
    rightsRelation: "HOLDER",
    parentReportId: null,
    ...overrides,
  };
}

const TEAM_ROW = { id: 4, name: "Alpha", tag: "ALP", logo_url: "/api/uploads/teams/4-a.webp", is_ghost: 0 };
const USER_ROW = { id: 8, pseudo: "PseudoSecret", avatar_url: null, visible_avatar: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(pushLeadershipAlert).mockResolvedValue(null);
  jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);
  jest.mocked(listQuarantinesForReports).mockResolvedValue([]);
  jest.mocked(purgeDueQuarantines).mockResolvedValue(0);
});

describe("createReport", () => {
  const countRoute = (total: number): Route => [/COUNT\(\*\) AS total FROM bg_reports/, () => [[{ total }]]];
  const targetRoutes: Route[] = [
    [/FROM bg_teams/, () => [[TEAM_ROW]]],
    [/FROM bg_users\s+WHERE is_deleted = 0 AND id IN/, () => [[USER_ROW]]],
  ];

  it("enregistre le signalement et ses cibles, libellé relevé, dans une transaction", async () => {
    install(
      [
        [/FROM bg_users u\s+WHERE u.is_deleted = 0/, () => [[]]],
        [/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]],
      ],
      [
        countRoute(0),
        ...targetRoutes,
        [/INSERT INTO bg_reports/, () => [{ insertId: 12 }]],
        [/INSERT INTO bg_report_targets/, () => [{}]],
      ],
    );

    await expect(createReport(submission(), { userId: null, managesTournaments: false })).resolves.toBe(12);

    const insert = connection.execute.mock.calls.find(([sql]) => /INSERT INTO bg_reports/.test(sql));
    expect(insert?.[1]).toEqual([
      "COPYRIGHT",
      "Le logo de cette équipe reprend celui de notre club.",
      "/equipes/4",
      null,
      "Club Exemple",
      "juridique@exemple.fr",
      "HOLDER",
    ]);
    const targets = connection.execute.mock.calls.filter(([sql]) => /INSERT INTO bg_report_targets/.test(sql));
    expect(targets.map(([, params]) => params)).toEqual([
      [12, "TEAM", 4, "Alpha"],
      [12, "USER", 8, "PseudoSecret"],
    ]);
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("alerte la direction sans jamais nommer le joueur visé", async () => {
    install(
      [
        [/FROM bg_users u\s+WHERE u.is_deleted = 0/, () => [[]]],
        [/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]],
      ],
      [
        countRoute(0),
        ...targetRoutes,
        [/INSERT INTO bg_reports/, () => [{ insertId: 12 }]],
        [/INSERT INTO bg_report_targets/, () => [{}]],
      ],
    );
    await createReport(submission(), { userId: 3, managesTournaments: false });
    const [message, context] = jest.mocked(pushLeadershipAlert).mock.calls[0];
    expect(context).toBe("content-report");
    expect(message).toContain("Alpha");
    expect(message).toContain("1 joueur");
    expect(message).not.toContain("PseudoSecret");
    expect(message).toContain("https://site.test/admin/signalements?id=12");
    expect(message).toContain("un membre");
  });

  it("prévient les personnes visées joignables par un moyen prouvé, jamais l'auteur", async () => {
    install(
      [
        [
          /FROM bg_users u\s+WHERE u.is_deleted = 0/,
          () => [
            [
              { id: 8, pseudo: "PseudoSecret", discord_id: "900000000000000008", discord_pseudo: null, discord_verified_at: null },
              { id: 9, pseudo: "Membre", discord_id: null, discord_pseudo: "membre", discord_verified_at: new Date() },
              // Tag saisi mais jamais certifié : il peut désigner n'importe qui.
              { id: 10, pseudo: "NonCertifie", discord_id: null, discord_pseudo: "quelquun", discord_verified_at: null },
              // L'auteur du signalement, membre de l'équipe qu'il signale.
              { id: 3, pseudo: "Auteur", discord_id: "900000000000000003", discord_pseudo: null, discord_verified_at: null },
            ],
          ],
        ],
        [/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]],
      ],
      [
        countRoute(0),
        ...targetRoutes,
        [/INSERT INTO bg_reports/, () => [{ insertId: 12 }]],
        [/INSERT INTO bg_report_targets/, () => [{}]],
      ],
    );

    await createReport(submission(), { userId: 3, managesTournaments: false });
    await flush();

    const lookup = pool.execute.mock.calls.find(([sql]) => /FROM bg_users u\s+WHERE u.is_deleted = 0/.test(sql));
    // Le joueur désigné, puis les membres actuels de l'équipe désignée.
    expect(lookup?.[1]).toEqual([8, 4]);
    expect(lookup?.[0]).toMatch(/tm.left_at IS NULL/);

    const [message, recipients, context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(context).toBe("content-report-target");
    expect(message).toContain("https://site.test/signalements/12");
    expect(recipients).toEqual([
      { discordId: "900000000000000008", handle: null, label: "PseudoSecret" },
      { discordId: null, handle: "membre", label: "Membre" },
    ]);
  });

  it("ne prévient personne pour un signalement sans joueur ni équipe", async () => {
    install(
      [[/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]]],
      [countRoute(0), [/INSERT INTO bg_reports/, () => [{ insertId: 13 }]]],
    );
    await createReport(submission({ category: "BUG", targets: [] }), { userId: null, managesTournaments: false });
    await flush();
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("refuse au-delà du plafond horaire, sans rien écrire", async () => {
    install([], [countRoute(60)]);
    await expect(createReport(submission(), { userId: null, managesTournaments: false })).rejects.toThrow(
      "REPORTS_SATURATED",
    );
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => /INSERT/.test(sql))).toBe(false);
    expect(pushLeadershipAlert).not.toHaveBeenCalled();
  });

  it("refuse une cible disparue ou invisible", async () => {
    install([], [countRoute(0), [/FROM bg_teams/, () => [[TEAM_ROW]]], [/FROM bg_users/, () => [[]]]]);
    await expect(createReport(submission(), { userId: null, managesTournaments: false })).rejects.toThrow(
      "REPORT_TARGET_NOT_FOUND",
    );
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("ne laisse désigner un tournoi non publié qu'au staff", async () => {
    const hidden = { id: 2, name: "Secret", image_url: null, start_visibility_at: new Date(Date.now() + 86_400_000) };
    const tournament = submission({ category: "OTHER", targets: [{ type: "TOURNAMENT", id: 2 }] });

    install([], [countRoute(0), [/FROM bg_tournaments/, () => [[hidden]]]]);
    await expect(createReport(tournament, { userId: 3, managesTournaments: false })).rejects.toThrow(
      "REPORT_TARGET_NOT_FOUND",
    );

    install(
      [[/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]]],
      [
        countRoute(0),
        [/FROM bg_tournaments/, () => [[hidden]]],
        [/INSERT INTO bg_reports/, () => [{ insertId: 14 }]],
        [/INSERT INTO bg_report_targets/, () => [{}]],
      ],
    );
    await expect(createReport(tournament, { userId: 3, managesTournaments: true })).resolves.toBe(14);
  });
});

describe("createReport — contestation", () => {
  const contest = submission({
    category: "CONTEST",
    targets: [],
    contactName: null,
    rightsRelation: null,
    parentReportId: 12,
    description: "Nous détenons les droits sur ce logo.",
  });
  const parentRoutes = (status: string, targets: unknown[]): Route[] => [
    [/SELECT category, status FROM bg_reports WHERE id = \? FOR UPDATE/, () => [[{ category: "COPYRIGHT", status }]]],
    [/FROM bg_report_targets WHERE report_id = \?/, () => [targets]],
    [/FROM bg_team_members tm/, () => [[{ team_id: 4 }]]],
    [/COUNT\(\*\) AS total FROM bg_reports/, () => [[{ total: 0 }]]],
    [/INSERT INTO bg_reports/, () => [{ insertId: 20 }]],
    [/UPDATE bg_reports SET status = 'OPEN'/, () => [{ affectedRows: 1 }]],
  ];

  it("exige un compte", async () => {
    install([], []);
    await expect(createReport(contest, { userId: null, managesTournaments: false })).rejects.toThrow(
      "REPORT_CONTEST_LOGIN_REQUIRED",
    );
  });

  it("n'accepte que la contestation d'une personne visée — même refus pour un signalement inexistant", async () => {
    install([], parentRoutes("OPEN", [{ report_id: 12, target_type: "TEAM", target_id: 99, label_snapshot: "Autre" }]));
    await expect(createReport(contest, { userId: 5, managesTournaments: false })).rejects.toThrow("REPORT_NOT_CONCERNED");
    expect(connection.rollback).toHaveBeenCalled();

    install([], [[/SELECT category, status FROM bg_reports/, () => [[]]]]);
    await expect(createReport(contest, { userId: 5, managesTournaments: false })).rejects.toThrow("REPORT_NOT_CONCERNED");
  });

  it("rattache la contestation d'un membre de l'équipe visée, sans rouvrir un signalement ouvert", async () => {
    install([], parentRoutes("IN_PROGRESS", [{ report_id: 12, target_type: "TEAM", target_id: 4, label_snapshot: "Alpha" }]));
    await expect(createReport(contest, { userId: 5, managesTournaments: false })).resolves.toBe(20);

    const insert = connection.execute.mock.calls.find(([sql]) => /INSERT INTO bg_reports/.test(sql));
    expect(insert?.[0]).toMatch(/'CONTEST'/);
    expect(insert?.[1]).toEqual([12, "Nous détenons les droits sur ce logo.", "/equipes/4", 5, "juridique@exemple.fr"]);
    expect(connection.execute.mock.calls.some(([sql]) => /SET status = 'OPEN'/.test(sql))).toBe(false);
    const [message, context] = jest.mocked(pushLeadershipAlert).mock.calls[0];
    expect(context).toBe("content-report-contest");
    expect(message).toContain("Contestation #20 du signalement #12");
    expect(message).not.toContain("réactivé");
    // Une contestation ne prévient pas les personnes visées : c'en est une.
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("réactive un signalement archivé et le dit à la direction", async () => {
    install([], parentRoutes("RESOLVED", [{ report_id: 12, target_type: "USER", target_id: 5, label_snapshot: "Moi" }]));
    await createReport(contest, { userId: 5, managesTournaments: false });
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE bg_reports SET status = 'OPEN', resolved_at = NULL WHERE id = \?/),
      [12],
    );
    expect(jest.mocked(pushLeadershipAlert).mock.calls[0][0]).toContain("réactivé");
  });

  it("ne laisse pas contester une contestation", async () => {
    install(
      [],
      [
        [/SELECT category, status FROM bg_reports/, () => [[{ category: "CONTEST", status: "OPEN" }]]],
        [/FROM bg_report_targets/, () => [[]]],
        [/FROM bg_team_members tm/, () => [[]]],
      ],
    );
    await expect(createReport(contest, { userId: 5, managesTournaments: false })).rejects.toThrow("REPORT_NOT_CONCERNED");
  });
});

describe("applyReportAction", () => {
  const actor = { userId: 1, pseudo: "Admin" };

  it("refuse un signalement inconnu — et une contestation, qui n'a pas de cycle propre", async () => {
    install([], [[/SELECT status FROM bg_reports WHERE id = \? AND parent_report_id IS NULL FOR UPDATE/, () => [[]]]]);
    await expect(applyReportAction(9, "TAKE", actor)).rejects.toThrow("REPORT_NOT_FOUND");
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("refuse un geste sans objet depuis l'état courant", async () => {
    install([], [[/SELECT status FROM bg_reports/, () => [[{ status: "RESOLVED" }]]]]);
    await expect(applyReportAction(9, "TAKE", actor)).rejects.toThrow("REPORT_ACTION_NOT_ALLOWED");
  });

  it("prend en charge au nom de l'administrateur", async () => {
    install(
      [],
      [
        [/SELECT status FROM bg_reports/, () => [[{ status: "OPEN" }]]],
        [/UPDATE bg_reports SET status = 'IN_PROGRESS'/, () => [{}]],
      ],
    );
    await applyReportAction(9, "TAKE", actor);
    expect(connection.execute).toHaveBeenCalledWith(expect.stringMatching(/assignee_user_id = \?/), [1, 9]);
    expect(connection.commit).toHaveBeenCalled();
    expect(publishStaffAction).not.toHaveBeenCalled();
  });

  it("archive avec la note bornée, et le dit sans nommer l'administrateur sur Discord", async () => {
    install(
      [],
      [
        [/SELECT status FROM bg_reports/, () => [[{ status: "IN_PROGRESS" }]]],
        [/SET status = 'RESOLVED'/, () => [{}]],
      ],
    );
    await applyReportAction(9, "RESOLVE", actor, `  ${"n".repeat(2100)}  `);
    const [, params] = connection.execute.mock.calls.find(([sql]) => /SET status = 'RESOLVED'/.test(sql)) ?? [];
    expect((params as unknown[])[0]).toHaveLength(2000);
    expect(publishStaffAction).toHaveBeenCalledWith(expect.stringContaining("Signalement #9 résolu et archivé par le staff"), {
      id: 1,
      pseudo: "Admin",
    });
  });

  it("archive sans note en `NULL`, et rouvre", async () => {
    install(
      [],
      [
        [/SELECT status FROM bg_reports/, () => [[{ status: "OPEN" }]]],
        [/SET status = 'RESOLVED'/, () => [{}]],
      ],
    );
    await applyReportAction(9, "RESOLVE", actor, "   ");
    expect(connection.execute.mock.calls.find(([sql]) => /RESOLVED/.test(sql))?.[1]).toEqual([null, 1, 9]);

    install(
      [],
      [
        [/SELECT status FROM bg_reports/, () => [[{ status: "RESOLVED" }]]],
        [/SET status = 'OPEN', resolved_at = NULL/, () => [{}]],
      ],
    );
    await applyReportAction(9, "REOPEN", actor);
    expect(connection.commit).toHaveBeenCalled();
  });
});

describe("conservation", () => {
  it("n'efface que des signalements d'origine archivés depuis trente jours, sans logo masqué en attente", async () => {
    install([[/DELETE FROM bg_reports/, () => [{ affectedRows: 3 }]]]);
    await expect(purgeExpiredReports()).resolves.toBe(3);
    const [sql] = pool.execute.mock.calls[0];
    expect(sql).toMatch(/status = 'RESOLVED'/);
    expect(sql).toMatch(/parent_report_id IS NULL/);
    expect(sql).toMatch(/INTERVAL 30 DAY/);
    expect(sql).toMatch(/NOT EXISTS[\s\S]*bg_logo_quarantines[\s\S]*status = 'HIDDEN'/);
  });

  it("purge au plus une fois par heure, les logos échus avant les signalements", async () => {
    install([[/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]]]);
    const start = 1_000_000_000_000;
    schedulePurgeExpiredReports(start);
    schedulePurgeExpiredReports(start + 10 * 60 * 1000);
    await flush();
    expect(purgeDueQuarantines).toHaveBeenCalledTimes(1);
    expect(pool.execute).toHaveBeenCalledTimes(1);

    schedulePurgeExpiredReports(start + 61 * 60 * 1000);
    await flush();
    expect(purgeDueQuarantines).toHaveBeenCalledTimes(2);
  });
});

describe("searchReportTargets", () => {
  it("ne cherche rien sous deux caractères", async () => {
    install([]);
    await expect(searchReportTargets("TEAM", " a ", { userId: 1, managesTournaments: false })).resolves.toEqual([]);
    expect(pool.execute).not.toHaveBeenCalled();
  });

  it("échappe les jokers de la saisie", () => {
    expect(escapeLikePattern("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  it("cherche les équipes par nom ou sigle, sans entrée solo ni équipe dissoute", async () => {
    install([[/FROM bg_teams/, () => [[TEAM_ROW]]]]);
    const options = await searchReportTargets("TEAM", "alp%", { userId: 1, managesTournaments: false });
    const [sql, params] = pool.execute.mock.calls[0];
    expect(sql).toMatch(/deleted_at IS NULL AND solo_user_id IS NULL/);
    expect(params).toEqual(["%alp\\%%", "%alp\\%%"]);
    expect(options).toEqual([
      { type: "TEAM", id: 4, label: "Alpha", detail: "ALP", imageUrl: "/api/uploads/teams/4-a.webp" },
    ]);
  });

  it("ne propose pas un compte supprimé, et masque un avatar caché", async () => {
    install([[/FROM bg_users/, () => [[{ ...USER_ROW, avatar_url: "/api/uploads/avatars/8.webp", visible_avatar: 0 }]]]]);
    const [option] = await searchReportTargets("USER", "pseudo", { userId: 1, managesTournaments: false });
    expect(pool.execute.mock.calls[0][0]).toMatch(/is_deleted = 0/);
    expect(option.imageUrl).toBeNull();
  });
});

describe("getConcernedReport", () => {
  const routes = (targets: unknown[], teams: unknown[]): Route[] => [
    [
      /SELECT id, category, status, description, created_at FROM bg_reports WHERE id = \?/,
      () => [[{ id: 12, category: "COPYRIGHT", status: "OPEN", description: "Logo repris.", created_at: new Date("2026-09-20T10:00:00Z") }]],
    ],
    [/FROM bg_report_targets WHERE report_id = \?/, () => [targets]],
    [/FROM bg_team_members tm/, () => [teams]],
    [/FROM bg_teams/, () => [[TEAM_ROW]]],
    [/WHERE parent_report_id = \? AND reporter_user_id = \?/, () => [[]]],
  ];

  it("rend `null` à qui n'est pas visé", async () => {
    install(routes([{ report_id: 12, target_type: "TEAM", target_id: 4, label_snapshot: "Alpha" }], []));
    await expect(getConcernedReport(12, 5)).resolves.toBeNull();
  });

  it("ne montre que les cibles du lecteur, et rien du signalant", async () => {
    install(
      routes(
        [
          { report_id: 12, target_type: "TEAM", target_id: 4, label_snapshot: "Alpha" },
          { report_id: 12, target_type: "USER", target_id: 77, label_snapshot: "UnAutreJoueur" },
        ],
        [{ team_id: 4 }],
      ),
    );
    const report = await getConcernedReport(12, 5);
    expect(report?.targets.map((target) => target.label)).toEqual(["Alpha"]);
    expect(JSON.stringify(report)).not.toContain("UnAutreJoueur");
    expect(report).not.toHaveProperty("reporter");
    expect(report).not.toHaveProperty("contactEmail");
    expect(listQuarantinesForReports).toHaveBeenCalledWith([12]);
  });
});

describe("listContestableReports", () => {
  it("cherche les signalements qui visent le joueur ou ses équipes, jamais les contestations", async () => {
    install([
      [/FROM bg_team_members tm/, () => [[{ team_id: 4 }, { team_id: 6 }]]],
      [/SELECT DISTINCT r.id/, () => [[{ id: 12, category: "COPYRIGHT", status: "RESOLVED", created_at: new Date("2026-09-20T10:00:00Z") }]]],
    ]);
    await expect(listContestableReports(5)).resolves.toEqual([
      { id: 12, category: "COPYRIGHT", status: "RESOLVED", createdAt: "2026-09-20T10:00:00.000Z" },
    ]);
    const [sql, params] = pool.execute.mock.calls[1];
    expect(sql).toMatch(/r.category <> 'CONTEST'/);
    expect(params).toEqual([5, 4, 6]);
  });
});

describe("listReports", () => {
  it("range les contestations sous leur signalement d'origine, jamais à part", async () => {
    install([
      [/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]],
      [
        /FROM bg_reports r\s+LEFT JOIN bg_users reporter/,
        () => [
          [
            {
              id: 12,
              category: "COPYRIGHT",
              status: "OPEN",
              description: "Logo repris.",
              page_path: null,
              reporter_user_id: null,
              reporter_pseudo: null,
              contact_name: "Club",
              contact_email: "c@exemple.fr",
              rights_relation: "HOLDER",
              assignee_user_id: null,
              assignee_pseudo: null,
              resolution_note: null,
              created_at: new Date("2026-09-20T10:00:00Z"),
              updated_at: new Date("2026-09-20T10:00:00Z"),
              resolved_at: null,
            },
          ],
        ],
      ],
      [
        /FROM bg_reports c/,
        () => [
          [
            {
              id: 20,
              parent_report_id: 12,
              description: "Nous avons les droits.",
              created_at: new Date("2026-09-21T10:00:00Z"),
              reporter_user_id: 5,
              reporter_pseudo: "Capitaine",
              contact_email: null,
            },
          ],
        ],
      ],
      [/FROM bg_report_targets/, () => [[{ report_id: 12, target_type: "TEAM", target_id: 4, label_snapshot: "Ancien nom" }]]],
      [/FROM bg_teams/, () => [[TEAM_ROW]]],
    ]);

    const [report, ...rest] = await listReports();
    expect(rest).toEqual([]);
    const topLevel = pool.execute.mock.calls.find(([sql]) => /LEFT JOIN bg_users reporter/.test(sql));
    expect(topLevel?.[0]).toMatch(/WHERE r.parent_report_id IS NULL/);
    expect(report.contests).toEqual([
      {
        id: 20,
        description: "Nous avons les droits.",
        createdAt: "2026-09-21T10:00:00.000Z",
        author: { userId: 5, pseudo: "Capitaine" },
        contactEmail: null,
      },
    ]);
    // La cible est relue : son nom du jour, pas celui de l'envoi.
    expect(report.targets[0]).toEqual(expect.objectContaining({ label: "Alpha", exists: true }));
  });
});
