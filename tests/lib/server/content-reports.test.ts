import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/logo-quarantine");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://site.test" }));
// Le verrou nommé est joué sur le pool simulé lui-même : ce qui compte ici est
// ce qui se lit et s'écrit sous lui, pas `GET_LOCK`.
jest.mock("@/lib/server/named-lock", () => ({
  withNamedLock: (pool: unknown, _name: string, _timeout: number, run: (connection: unknown) => unknown) => run(pool),
}));

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
  listReportsByAuthor,
  purgeExpiredReports,
  resolveReportTargets,
  schedulePurgeExpiredReports,
  searchReportTargets,
} from "@/lib/server/content-reports";
import {
  REPORTS_HOURLY_CAP,
  REPORTS_HOURLY_HARD_CAP,
  type ReportSubmission,
} from "@/lib/shared/content-reports";
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
  /** Cibles déjà visées par un autre signalement récent (délai de reprévenance). */
  const cooldownRoute = (rows: { target_type: string; target_id: number }[] = []): Route => [
    /SELECT DISTINCT t.target_type, t.target_id\s+FROM bg_report_targets t/,
    () => [rows],
  ];
  /** Ancienneté du compte auteur et ses signalements à cibles du jour. */
  const markRoute: Route = [/UPDATE bg_report_targets SET notified_at = NOW\(\)/, () => [{ affectedRows: 1 }]];
  const releaseRoute: Route = [/UPDATE bg_report_targets SET notified_at = NULL/, () => [{ affectedRows: 1 }]];
  const usersRoute = (rows: Record<string, unknown>[] = []): Route => [
    /FROM bg_users u\s+WHERE u.is_deleted = 0 AND u.id IN/,
    () => [rows],
  ];
  const membersRoute = (rows: Record<string, unknown>[] = []): Route => [
    /FROM bg_team_members tm\s+JOIN bg_users u/,
    () => [rows],
  ];
  const reporterRoute = (ageHours = 24 * 30, earlier = 0): Route => [
    /TIMESTAMPDIFF\(HOUR, u.created_at, NOW\(\)\) AS age_hours/,
    () => [[{ age_hours: ageHours, earlier }]],
  ];

  it("enregistre le signalement et ses cibles, libellé relevé, dans une transaction", async () => {
    install(
      [
        cooldownRoute(),
        reporterRoute(),
        markRoute,
        usersRoute(),
        membersRoute(),
        [/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]],
      ],
      [
        countRoute(0),
        ...targetRoutes,
        [/INSERT INTO bg_reports/, () => [{ insertId: 12 }]],
        [/INSERT INTO bg_report_targets/, () => [{}]],
      ],
    );

    await expect(createReport(submission(), { userId: 3, managesTournaments: false })).resolves.toBe(12);

    const insert = connection.execute.mock.calls.find(([sql]) => /INSERT INTO bg_reports/.test(sql));
    expect(insert?.[1]).toEqual([
      "COPYRIGHT",
      "Le logo de cette équipe reprend celui de notre club.",
      "/equipes/4",
      3,
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
        cooldownRoute(),
        reporterRoute(),
        markRoute,
        usersRoute(),
        membersRoute(),
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
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 2, unresolved: [], failed: [] });
    install(
      [
        cooldownRoute(),
        reporterRoute(),
        markRoute,
        releaseRoute,
        usersRoute([
          { id: 8, pseudo: "PseudoSecret", discord_id: "900000000000000008", discord_pseudo: null, discord_verified_at: null },
        ]),
        membersRoute([
          { team_id: 4, id: 9, pseudo: "Membre", discord_id: null, discord_pseudo: "membre", discord_verified_at: new Date() },
          // Tag saisi mais jamais certifié : il peut désigner n'importe qui.
          { team_id: 4, id: 10, pseudo: "NonCertifie", discord_id: null, discord_pseudo: "quelquun", discord_verified_at: null },
          // L'auteur du signalement, membre de l'équipe qu'il signale.
          { team_id: 4, id: 3, pseudo: "Auteur", discord_id: "900000000000000003", discord_pseudo: null, discord_verified_at: null },
        ]),
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

    const users = pool.execute.mock.calls.find(([sql]) => /FROM bg_users u\s+WHERE u.is_deleted = 0 AND u.id IN/.test(sql));
    expect(users?.[1]).toEqual([8]);
    // Les membres **actuels** de l'équipe désignée.
    const members = pool.execute.mock.calls.find(([sql]) => /FROM bg_team_members tm/.test(sql));
    expect(members?.[1]).toEqual([4]);
    expect(members?.[0]).toMatch(/tm.left_at IS NULL/);

    // Un envoi par cible — le joueur désigné, puis l'équipe —, chacun une seule fois.
    const calls = jest.mocked(pushDiscordDirectMessages).mock.calls;
    expect(calls).toHaveLength(2);
    const [message, , context] = calls[0];
    expect(context).toBe("content-report-target");
    expect(message).toContain("https://site.test/signalements/12");
    expect(calls.map(([, recipients]) => recipients)).toEqual([
      [{ discordId: "900000000000000008", handle: null, label: "PseudoSecret" }],
      [{ discordId: null, handle: "membre", label: "Membre" }],
    ]);
    // Les cibles prévenues sont marquées : c'est ce que relit la reprévenance.
    const mark = pool.execute.mock.calls.find(([sql]) => /UPDATE bg_report_targets SET notified_at = NOW/.test(sql));
    expect(mark?.[1]).toEqual([12, "USER", 8, "TEAM", 4]);
    // Quelque chose est parti : la marque reste.
    expect(pool.execute.mock.calls.some(([sql]) => /SET notified_at = NULL/.test(sql))).toBe(false);
  });

  it("ne marque que les cibles qui ont donné un destinataire, et rend la marque si rien n'est parti", async () => {
    install(
      [
        cooldownRoute(),
        reporterRoute(),
        markRoute,
        releaseRoute,
        usersRoute([
          { id: 8, pseudo: "PseudoSecret", discord_id: "900000000000000008", discord_pseudo: null, discord_verified_at: null },
        ]),
        // L'équipe n'a aucun membre joignable : elle n'est pas « prévenue ».
        membersRoute([]),
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

    const mark = pool.execute.mock.calls.find(([sql]) => /SET notified_at = NOW/.test(sql));
    expect(mark?.[1]).toEqual([12, "USER", 8]);
    // Bot injoignable, aucun appareil abonné : la réservation est rendue, sans
    // quoi le joueur serait tenu pour prévenu et un signalement légitime tu.
    const release = pool.execute.mock.calls.find(([sql]) => /SET notified_at = NULL/.test(sql));
    expect(release?.[1]).toEqual([12, "USER", 8]);
  });

  it.each([
    ["bot tombé entre les deux", null],
    ["envoi qui lève", new Error("boom")],
  ])("rend la marque de la seule cible à qui rien n'est parvenu (%s)", async (_label, teamOutcome) => {
    // Le joueur reçoit son message, l'équipe non.
    const mocked = jest.mocked(pushDiscordDirectMessages).mockResolvedValueOnce({ sent: 1, unresolved: [], failed: [] });
    if (teamOutcome instanceof Error) mocked.mockRejectedValueOnce(teamOutcome);
    else mocked.mockResolvedValueOnce(teamOutcome);
    install(
      [
        cooldownRoute(),
        reporterRoute(),
        markRoute,
        releaseRoute,
        usersRoute([
          { id: 8, pseudo: "PseudoSecret", discord_id: "900000000000000008", discord_pseudo: null, discord_verified_at: null },
        ]),
        membersRoute([
          { team_id: 4, id: 9, pseudo: "Membre", discord_id: "900000000000000009", discord_pseudo: null, discord_verified_at: null },
        ]),
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

    const release = pool.execute.mock.calls.find(([sql]) => /SET notified_at = NULL/.test(sql));
    expect(release?.[1]).toEqual([12, "TEAM", 4]);
  });

  it("ne reprévient pas une cible déjà prévenue par un signalement récent", async () => {
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 1, unresolved: [], failed: [] });
    install(
      [
        cooldownRoute([{ target_type: "TEAM", target_id: 4 }]),
        reporterRoute(),
        markRoute,
        usersRoute([
          { id: 8, pseudo: "PseudoSecret", discord_id: "900000000000000008", discord_pseudo: null, discord_verified_at: null },
        ]),
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

    const cooldown = pool.execute.mock.calls.find(([sql]) => /SELECT DISTINCT t.target_type/.test(sql));
    // Autre signalement que celui-ci, dans les 24 dernières heures, sur ces cibles.
    expect(cooldown?.[0]).toMatch(/t.report_id <> \?/);
    // Seules comptent les cibles réellement prévenues, pas celles seulement désignées.
    expect(cooldown?.[0]).toMatch(/t.notified_at > NOW\(\) - INTERVAL 24 HOUR/);
    expect(cooldown?.[1]).toEqual([12, "TEAM", 4, "USER", 8]);
    // L'équipe, déjà prévenue, n'est plus cherchée : seul le joueur l'est.
    expect(pool.execute.mock.calls.some(([sql]) => /FROM bg_team_members tm/.test(sql))).toBe(false);
    expect(jest.mocked(pushDiscordDirectMessages)).toHaveBeenCalledTimes(1);
  });

  it("n'écrit à personne quand toutes les cibles ont déjà été prévenues", async () => {
    install(
      [
        cooldownRoute([
          { target_type: "TEAM", target_id: 4 },
          { target_type: "USER", target_id: 8 },
        ]),
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
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    // La direction, elle, est toujours alertée.
    expect(pushLeadershipAlert).toHaveBeenCalled();
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

  it("refuse qu'un visiteur sans compte désigne des cibles — chacune recevrait un message privé", async () => {
    install([], []);
    await expect(createReport(submission(), { userId: null, managesTournaments: false })).rejects.toThrow(
      "REPORT_TARGETS_REQUIRE_LOGIN",
    );
    expect(pool.execute).not.toHaveBeenCalled();
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it.each(["RGPD", "HOSTING"] as const)(
    "refuse une demande %s sans compte ni adresse : personne ne pourrait y répondre",
    async (category) => {
      install([], []);
      await expect(
        createReport(submission({ category, targets: [], contactName: null, contactEmail: null, rightsRelation: null }), {
          userId: null,
          managesTournaments: false,
        }),
      ).rejects.toThrow("REPORT_REPLY_CHANNEL_REQUIRED");
      expect(pool.execute).not.toHaveBeenCalled();
    },
  );

  const reachableRoute = (reachable: boolean): Route => [
    /SELECT 1 FROM bg_users\s+WHERE id = \? AND is_deleted = 0 AND discord_verified_at IS NOT NULL/,
    () => [reachable ? [{ 1: 1 }] : []],
  ];

  it.each(["RGPD", "HOSTING"] as const)(
    "refuse une demande %s d'un compte sans tag Discord certifié ni adresse : le site n'envoie aucun courriel",
    async (category) => {
      install([reachableRoute(false)], []);
      await expect(
        createReport(submission({ category, targets: [], contactName: null, contactEmail: null, rightsRelation: null }), {
          userId: 3,
          managesTournaments: false,
        }),
      ).rejects.toThrow("REPORT_REPLY_CHANNEL_REQUIRED");
      expect(connection.execute).not.toHaveBeenCalled();
    },
  );

  it("accepte une demande RGPD sans adresse d'un compte au tag Discord certifié, sans date de consentement", async () => {
    install(
      [reachableRoute(true), [/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]]],
      [countRoute(0), [/INSERT INTO bg_reports/, () => [{ insertId: 16 }]]],
    );
    await expect(
      createReport(submission({ category: "RGPD", targets: [], contactName: null, contactEmail: null, rightsRelation: null }), {
        userId: 3,
        managesTournaments: false,
      }),
    ).resolves.toBe(16);
    const insert = jest.mocked(connection.execute).mock.calls.find(([sql]) => /INSERT INTO bg_reports/.test(String(sql)));
    expect(String(insert?.[0])).toMatch(/VALUES \(\?, \?, \?, \?, \?, \?, \?, NULL\)/);
  });

  it("ne consulte pas le compte quand une adresse est donnée", async () => {
    install(
      [[/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]]],
      [countRoute(0), [/INSERT INTO bg_reports/, () => [{ insertId: 17 }]]],
    );
    await expect(
      createReport(submission({ category: "HOSTING", targets: [], contactName: null, rightsRelation: null }), {
        userId: 3,
        managesTournaments: false,
      }),
    ).resolves.toBe(17);
    expect(jest.mocked(pool.execute).mock.calls.some(([sql]) => /discord_verified_at IS NOT NULL/.test(String(sql)))).toBe(
      false,
    );
  });

  it("date le consentement d'une catégorie qui en demande un, et d'elle seule", async () => {
    install(
      [[/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]]],
      [countRoute(0), [/INSERT INTO bg_reports/, () => [{ insertId: 18 }]]],
    );
    await createReport(submission({ category: "BUG", targets: [] }), { userId: null, managesTournaments: false });
    const insert = jest.mocked(connection.execute).mock.calls.find(([sql]) => /INSERT INTO bg_reports/.test(String(sql)));
    expect(String(insert?.[0])).toMatch(/VALUES \(\?, \?, \?, \?, \?, \?, \?, NOW\(\)\)/);
  });

  it("accepte le signalement sans cible d'un visiteur sans compte", async () => {
    install(
      [[/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]]],
      [countRoute(0), [/INSERT INTO bg_reports/, () => [{ insertId: 15 }]]],
    );
    await expect(
      createReport(submission({ category: "OTHER", targets: [] }), { userId: null, managesTournaments: false }),
    ).resolves.toBe(15);
  });

  it("refuse au-delà du plafond dur de l'heure, sans rien écrire", async () => {
    install([], [countRoute(REPORTS_HOURLY_HARD_CAP)]);
    await expect(createReport(submission(), { userId: 3, managesTournaments: false })).rejects.toThrow(
      "REPORTS_SATURATED",
    );
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => /INSERT/.test(sql))).toBe(false);
    expect(pushLeadershipAlert).not.toHaveBeenCalled();
  });

  /**
   * Le plafond d'alerte refusait le dépôt : six IP suffisaient à fermer le seul
   * canal de signalement que le site publie. Au-delà, le signalement est
   * enregistré ; seule l'alerte est retenue.
   */
  it("enregistre au-delà du plafond d'alerte, et n'annonce la saturation qu'une fois", async () => {
    const routes = (total: number): Route[] => [
      countRoute(total),
      [/INSERT INTO bg_reports/, () => [{ insertId: 70 }]],
    ];
    const bug = submission({ category: "BUG", targets: [] });

    install([[/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]]], routes(REPORTS_HOURLY_CAP));
    await expect(createReport(bug, { userId: 3, managesTournaments: false })).resolves.toBe(70);
    expect(connection.commit).toHaveBeenCalled();
    expect(pushLeadershipAlert).toHaveBeenCalledTimes(1);
    const [notice] = jest.mocked(pushLeadershipAlert).mock.calls[0];
    expect(notice).toContain(`Plus de ${REPORTS_HOURLY_CAP} signalements`);
    expect(notice).toContain("https://site.test/admin/signalements");
    expect(notice).not.toContain("#70");

    jest.mocked(pushLeadershipAlert).mockClear();
    install([[/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]]], routes(REPORTS_HOURLY_CAP + 1));
    await expect(createReport(bug, { userId: 3, managesTournaments: false })).resolves.toBe(70);
    expect(connection.commit).toHaveBeenCalled();
    expect(pushLeadershipAlert).not.toHaveBeenCalled();

    // Le rythme retombe, puis un second pic dans l'heure : il est annoncé à son
    // tour, sans quoi les alertes se tairaient sans que rien ne le dise.
    install([[/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]]], routes(0));
    await createReport(bug, { userId: 3, managesTournaments: false });
    install([[/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]]], routes(REPORTS_HOURLY_CAP + 1));
    jest.mocked(pushLeadershipAlert).mockClear();
    await createReport(bug, { userId: 3, managesTournaments: false });
    expect(jest.mocked(pushLeadershipAlert).mock.calls[0]?.[0]).toContain(`Plus de ${REPORTS_HOURLY_CAP} signalements`);
  });

  it.each([
    ["un compte trop récent", 1, 0],
    ["un compte qui a déjà désigné des cibles trois fois dans la journée", 24 * 30, 3],
  ])("ne fait écrire à personne depuis %s — le signalement est enregistré", async (_label, ageHours, earlier) => {
    install(
      [
        cooldownRoute(),
        reporterRoute(ageHours, earlier),
        [/DELETE FROM bg_reports/, () => [{ affectedRows: 0 }]],
      ],
      [
        countRoute(0),
        ...targetRoutes,
        [/INSERT INTO bg_reports/, () => [{ insertId: 12 }]],
        [/INSERT INTO bg_report_targets/, () => [{}]],
      ],
    );
    await expect(createReport(submission(), { userId: 3, managesTournaments: false })).resolves.toBe(12);
    await flush();

    const reporter = pool.execute.mock.calls.find(([sql]) => /AS age_hours/.test(sql));
    // Les **autres** signalements de l'auteur : lus sous le verrou de la
    // réservation, ceux qui ont prévenu quelqu'un sont exactement comptés.
    expect(reporter?.[0]).toMatch(/r.id <> \?/);
    expect(reporter?.[1]).toEqual([12, 3]);
    expect(reporter?.[0]).toMatch(/INTERVAL 24 HOUR/);
    // Seuls comptent les signalements qui ont réellement prévenu quelqu'un.
    expect(reporter?.[0]).toMatch(/t.notified_at > NOW\(\) - INTERVAL 24 HOUR/);
    // Retenu, celui-ci ne marque aucune cible : il ne tiendra pas les autres au silence.
    expect(pool.execute.mock.calls.some(([sql]) => /UPDATE bg_report_targets/.test(sql))).toBe(false);
    expect(pool.execute.mock.calls.some(([sql]) => /FROM bg_users u\s+WHERE u.is_deleted = 0 AND u.id IN/.test(sql))).toBe(false);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    // La direction, elle, est alertée.
    expect(pushLeadershipAlert).toHaveBeenCalled();
  });

  it("refuse une cible disparue ou invisible", async () => {
    install([], [countRoute(0), [/FROM bg_teams/, () => [[TEAM_ROW]]], [/FROM bg_users/, () => [[]]]]);
    await expect(createReport(submission(), { userId: 3, managesTournaments: false })).rejects.toThrow(
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
  const parentRoutes = (status: string, targets: unknown[], reporter: number | null = null): Route[] => [
    [
      /SELECT category, status, reporter_user_id FROM bg_reports WHERE id = \? FOR UPDATE/,
      () => [[{ category: "COPYRIGHT", status, reporter_user_id: reporter }]],
    ],
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

  it("exige un canal pour la décision motivée : adresse ou tag Discord certifié", async () => {
    install(
      [[/SELECT 1 FROM bg_users\s+WHERE id = \? AND is_deleted = 0 AND discord_verified_at IS NOT NULL/, () => [[]]]],
      [],
    );
    await expect(
      createReport({ ...contest, contactEmail: null }, { userId: 5, managesTournaments: false }),
    ).rejects.toThrow("REPORT_REPLY_CHANNEL_REQUIRED");
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("n'accepte que la contestation d'une personne visée — même refus pour un signalement inexistant", async () => {
    install([], parentRoutes("OPEN", [{ report_id: 12, target_type: "TEAM", target_id: 99, label_snapshot: "Autre" }]));
    await expect(createReport(contest, { userId: 5, managesTournaments: false })).rejects.toThrow("REPORT_NOT_CONCERNED");
    expect(connection.rollback).toHaveBeenCalled();

    install([], [[/SELECT category, status, reporter_user_id FROM bg_reports/, () => [[]]]]);
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

  it("laisse l'auteur du signalement contester la décision prise, une fois le dossier archivé", async () => {
    const other = [{ report_id: 12, target_type: "TEAM", target_id: 99, label_snapshot: "Autre" }];
    install([], parentRoutes("RESOLVED", other, 5));
    await expect(createReport(contest, { userId: 5, managesTournaments: false })).resolves.toBe(20);
    const message = jest.mocked(pushLeadershipAlert).mock.calls[0][0];
    expect(message).toContain("envoyée par l'auteur du signalement");
    expect(message).toContain("réactivé");

    // Avant la décision, il n'a rien à contester ; un autre compte non plus.
    install([], parentRoutes("IN_PROGRESS", other, 5));
    await expect(createReport(contest, { userId: 5, managesTournaments: false })).rejects.toThrow("REPORT_NOT_CONCERNED");
    install([], parentRoutes("RESOLVED", other, 6));
    await expect(createReport(contest, { userId: 5, managesTournaments: false })).rejects.toThrow("REPORT_NOT_CONCERNED");
  });

  it("dit « personne visée » quand l'auteur est aussi visé", async () => {
    install([], parentRoutes("RESOLVED", [{ report_id: 12, target_type: "USER", target_id: 5, label_snapshot: "Moi" }], 5));
    await createReport(contest, { userId: 5, managesTournaments: false });
    expect(jest.mocked(pushLeadershipAlert).mock.calls[0][0]).toContain("envoyée par une personne visée");
  });

  it("ne laisse pas contester une contestation", async () => {
    install(
      [],
      [
        [/SELECT category, status, reporter_user_id FROM bg_reports/, () => [[{ category: "CONTEST", status: "OPEN", reporter_user_id: 5 }]]],
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
    // Un logo supprimé retient le signalement jusqu'à la fin du délai de
    // contestation ; un logo rétabli ne retient rien.
    expect(sql).toMatch(/q.status = 'PURGED' AND q.purge_after > NOW\(\)/);
    expect(sql).not.toMatch(/RESTORED/);
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

describe("resolveReportTargets — avatar masqué et modération", () => {
  const hiddenAvatarRow = { ...USER_ROW, avatar_url: "/api/uploads/avatars/8.webp", visible_avatar: 0 };

  it("masque un avatar caché pour un lecteur ordinaire", async () => {
    install([[/FROM bg_users/, () => [[hiddenAvatarRow]]]]);
    const [option] = await resolveReportTargets([{ type: "USER", id: 8 }], { userId: 1, managesTournaments: false });
    expect(option.imageUrl).toBeNull();
  });

  it("montre l'avatar caché à la modération, pour qu'elle puisse le retirer", async () => {
    install([[/FROM bg_users/, () => [[hiddenAvatarRow]]]]);
    const [option] = await resolveReportTargets([{ type: "USER", id: 8 }], {
      userId: null,
      managesTournaments: true,
      isModerator: true,
    });
    expect(option.imageUrl).toBe("/api/uploads/avatars/8.webp");
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

  it("ne montre que le logo de ses équipes et son propre avatar, jamais ceux des autres cibles", async () => {
    install([
      ...routes(
        [
          { report_id: 12, target_type: "TEAM", target_id: 4, label_snapshot: "Alpha" },
          { report_id: 12, target_type: "TEAM", target_id: 6, label_snapshot: "Beta" },
          { report_id: 12, target_type: "USER", target_id: 5, label_snapshot: "Nova" },
          { report_id: 12, target_type: "USER", target_id: 77, label_snapshot: "UnAutreJoueur" },
        ],
        [{ team_id: 4 }],
      ),
      [
        /FROM bg_users/,
        () => [
          [
            { id: 5, pseudo: "Nova", avatar_url: null, visible_avatar: 1 },
            { id: 77, pseudo: "UnAutreJoueur", avatar_url: null, visible_avatar: 1 },
          ],
        ],
      ],
    ]);
    jest.mocked(listQuarantinesForReports).mockResolvedValue([
      { id: 1, targetType: "TEAM", targetId: 4, targetName: "Alpha", reportId: 12, status: "HIDDEN", hiddenAt: "2026-09-20T10:00:00.000Z", purgeAfter: "2027-03-19T10:00:00.000Z", closedAt: null },
      // Équipe visée, mais dont le lecteur n'est pas membre : ne le concerne pas.
      { id: 2, targetType: "TEAM", targetId: 6, targetName: "Beta", reportId: 12, status: "HIDDEN", hiddenAt: "2026-09-20T10:00:00.000Z", purgeAfter: "2027-03-19T10:00:00.000Z", closedAt: null },
      { id: 3, targetType: "USER", targetId: 5, targetName: "Nova", reportId: 12, status: "HIDDEN", hiddenAt: "2026-09-20T10:00:00.000Z", purgeAfter: "2027-03-19T10:00:00.000Z", closedAt: null },
      // Un autre joueur visé : son avatar masqué ne concerne pas ce lecteur.
      { id: 4, targetType: "USER", targetId: 77, targetName: "UnAutreJoueur", reportId: 12, status: "HIDDEN", hiddenAt: "2026-09-20T10:00:00.000Z", purgeAfter: "2027-03-19T10:00:00.000Z", closedAt: null },
    ]);

    const report = await getConcernedReport(12, 5);
    expect(report?.quarantines.map((quarantine) => quarantine.id)).toEqual([1, 3]);
  });
});

describe("listContestableReports", () => {
  it("cherche les signalements qui visent le joueur ou ses équipes, et ceux qu'il a envoyés une fois archivés — jamais les contestations", async () => {
    install([
      [/FROM bg_team_members tm/, () => [[{ team_id: 4 }, { team_id: 6 }]]],
      [/SELECT r.id, r.category/, () => [[{ id: 12, category: "COPYRIGHT", status: "RESOLVED", created_at: new Date("2026-09-20T10:00:00Z") }]]],
    ]);
    await expect(listContestableReports(5)).resolves.toEqual([
      { id: 12, category: "COPYRIGHT", status: "RESOLVED", createdAt: "2026-09-20T10:00:00.000Z" },
    ]);
    const [sql, params] = pool.execute.mock.calls[1];
    expect(sql).toMatch(/r.category <> 'CONTEST'/);
    expect(sql).toMatch(/r\.reporter_user_id = \? AND r\.status = 'RESOLVED'/);
    expect(sql).toMatch(/r\.category IN \(\?, \?\)/);
    expect(params).toEqual([5, 4, 6, 5, "COPYRIGHT", "MODERATION"]);
  });
});

describe("listReportsByAuthor", () => {
  it("rend à l'export tout ce que la ligne garde de son auteur, coordonnées comprises", async () => {
    install([
      [
        /WHERE reporter_user_id = \?/,
        () => [
          [
            {
              id: 12,
              category: "COPYRIGHT",
              status: "OPEN",
              description: "Notre logo.",
              page_path: "/equipes/4",
              contact_name: "Club Exemple",
              contact_email: "juridique@exemple.fr",
              rights_relation: "HOLDER",
              parent_report_id: null,
              created_at: new Date("2026-09-20T10:00:00Z"),
            },
            {
              id: 13,
              category: "CONTEST",
              status: "OPEN",
              description: "Nous avons les droits.",
              page_path: null,
              contact_name: null,
              contact_email: null,
              rights_relation: null,
              parent_report_id: 9,
              created_at: new Date("2026-09-21T10:00:00Z"),
            },
          ],
        ],
      ],
    ]);
    await expect(listReportsByAuthor(3)).resolves.toEqual([
      {
        id: 12,
        category: "COPYRIGHT",
        status: "OPEN",
        description: "Notre logo.",
        pagePath: "/equipes/4",
        contactName: "Club Exemple",
        contactEmail: "juridique@exemple.fr",
        rightsRelation: "HOLDER",
        parentReportId: null,
        createdAt: "2026-09-20T10:00:00.000Z",
      },
      expect.objectContaining({ id: 13, parentReportId: 9, contactEmail: null }),
    ]);
    expect(pool.execute.mock.calls[0][1]).toEqual([3]);
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
