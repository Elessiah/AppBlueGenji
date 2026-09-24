import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/terms-acceptance", () =>
  jest.requireActual<typeof import("../../helpers/terms-acceptance-double")>(
    "../../helpers/terms-acceptance-double",
  ).termsAcceptanceDouble(),
);
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/user-avatar-import");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");

import { getDatabase } from "@/lib/server/database";
import { ensureUniquePseudo } from "@/lib/server/auth";
import { sendBotLog } from "@/lib/server/bot-integration";
import {
  assertTermsAccepted,
  recordTermsAcceptance,
  recordTermsAcceptanceIfBehind,
} from "@/lib/server/terms-acceptance";
import {
  createTeam,
  removeTeamMember,
  respondToInvitation,
  transferTeamOwnership,
  updateTeamLogo,
  updateTeamMemberRoles,
} from "@/lib/server/teams-service";
import { createOrGetBlizzardUser, createOrGetDiscordUser, createOrGetGoogleUser } from "@/lib/server/users-service";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

type Route = [RegExp, (params: unknown[]) => unknown];

function routed(routes: Route[]): jest.Mock<SqlQuery> {
  return jest.fn<SqlQuery>(async (sql, params) => {
    const route = routes.find(([pattern]) => pattern.test(sql));
    if (!route) throw new Error(`requête inattendue : ${sql}`);
    return route[1]((params ?? []) as unknown[]);
  });
}

let pool: { execute: jest.Mock<SqlQuery>; getConnection: () => Promise<unknown> };
let connection: ReturnType<typeof connectionMock>;

function install(poolRoutes: Route[], connectionRoutes: Route[] = []) {
  connection = connectionMock();
  connection.execute = routed(connectionRoutes);
  pool = { execute: routed(poolRoutes), getConnection: async () => fakeConnection(connection) };
  jest.mocked(getDatabase).mockResolvedValue(fakePool(pool));
}

/** Rôles de chaque membre de l'équipe 7, par identifiant de compte. */
const rolesOf = (roles: Record<number, string[]>): Route => [
  /SELECT roles_json\s+FROM bg_team_members/,
  (params) => {
    const found = roles[Number(params[1])];
    return [found ? [{ roles_json: JSON.stringify(found) }] : []];
  },
];

const refused = new Error("TERMS_ACCEPTANCE_REQUIRED");

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(assertTermsAccepted).mockResolvedValue(undefined);
  jest.mocked(recordTermsAcceptance).mockResolvedValue(true);
  jest.mocked(sendBotLog).mockResolvedValue(undefined);
  jest.mocked(ensureUniquePseudo).mockImplementation(async (source: unknown) => String(source));
});

describe("gestion d'une équipe — les conditions après le rôle", () => {
  it("refuse un gérant qui ne les a pas acceptées, avant toute écriture", async () => {
    install([rolesOf({ 1: ["MANAGER"], 2: ["DPS"] }), [/UPDATE bg_team_members/, () => [{ affectedRows: 1 }]]]);
    jest.mocked(assertTermsAccepted).mockRejectedValueOnce(refused);

    await expect(updateTeamMemberRoles(1, 7, 2, ["TANK"])).rejects.toThrow("TERMS_ACCEPTANCE_REQUIRED");
    expect(assertTermsAccepted).toHaveBeenCalledWith(1);
    expect(pool.execute.mock.calls.some(([sql]) => /UPDATE/.test(sql))).toBe(false);
  });

  it("répond « interdit » à qui n'a aucun rôle, sans parler des conditions", async () => {
    install([rolesOf({ 1: ["DPS"] })]);
    await expect(updateTeamMemberRoles(1, 7, 2, ["TANK"])).rejects.toThrow("FORBIDDEN");
    expect(assertTermsAccepted).not.toHaveBeenCalled();
  });

  it("exige les conditions pour exclure un membre et transférer la propriété", async () => {
    install([rolesOf({ 1: ["OWNER"], 2: ["DPS"] })]);
    jest.mocked(assertTermsAccepted).mockRejectedValue(refused);
    await expect(removeTeamMember(1, 7, 2)).rejects.toThrow("TERMS_ACCEPTANCE_REQUIRED");
    await expect(transferTeamOwnership(1, 7, 2)).rejects.toThrow("TERMS_ACCEPTANCE_REQUIRED");
  });

  it("exige les conditions pour envoyer un logo, jamais pour le retirer", async () => {
    install([rolesOf({ 1: ["MANAGER"] }), [/UPDATE bg_teams SET logo_url/, () => [{}]]]);

    await updateTeamLogo(1, 7, null);
    expect(assertTermsAccepted).not.toHaveBeenCalled();

    await updateTeamLogo(1, 7, "/api/uploads/teams/7-a.webp");
    expect(assertTermsAccepted).toHaveBeenCalledWith(1);
  });

  it("ne les exige pas du staff qui conduit une fantôme", async () => {
    install([
      rolesOf({}),
      [/SELECT is_ghost, deleted_at FROM bg_teams/, () => [[{ is_ghost: 1, deleted_at: null }]]],
      [/UPDATE bg_teams SET logo_url/, () => [{}]],
    ]);
    await updateTeamLogo(9, 7, "/api/uploads/teams/7-a.webp", true);
    expect(assertTermsAccepted).not.toHaveBeenCalled();
  });

  it("exige les conditions pour accepter une demande d'adhésion, pas pour la refuser", async () => {
    const invitation: Route = [
      /FROM bg_team_invitations WHERE id = \?/,
      () => [[{ team_id: 7, user_id: 3, kind: "REQUEST", status: "PENDING", roles_json: null }]],
    ];
    install([invitation, rolesOf({ 1: ["MANAGER"] }), [/SET status = 'DECLINED'/, () => [{}]]]);
    await respondToInvitation(1, 40, false);
    expect(assertTermsAccepted).not.toHaveBeenCalled();

    jest.mocked(assertTermsAccepted).mockRejectedValueOnce(refused);
    await expect(respondToInvitation(1, 40, true)).rejects.toThrow("TERMS_ACCEPTANCE_REQUIRED");
  });
});

describe("createTeam — l'acceptation écrite dans la transaction qui crée l'équipe", () => {
  const routes: Route[] = [
    [/SELECT id FROM bg_teams WHERE tag/, () => [[]]],
    [/INSERT INTO bg_teams/, () => [{ insertId: 50 }]],
    [/INSERT INTO bg_team_members/, () => [{}]],
  ];

  it("enregistre l'acceptation sur la connexion de la transaction", async () => {
    install([[/FROM bg_team_members\s+WHERE user_id = \?/, () => [[]]]], routes);
    await expect(createTeam(3, "Nouvelle équipe")).resolves.toBe(50);
    expect(recordTermsAcceptance).toHaveBeenCalledWith(3, "TEAM_CREATION", expect.anything());
    expect(jest.mocked(recordTermsAcceptance).mock.calls[0][2]).toBe(fakeConnection(connection));
    expect(connection.commit).toHaveBeenCalled();
  });

  it("défait la création si le compte a disparu entre-temps", async () => {
    install([[/FROM bg_team_members\s+WHERE user_id = \?/, () => [[]]]], routes);
    jest.mocked(recordTermsAcceptance).mockResolvedValueOnce(false);
    await expect(createTeam(3, "Nouvelle équipe")).rejects.toThrow("PROFILE_NOT_FOUND");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe("création d'un compte — les conditions, condition de naissance", () => {
  const noAccount: Route = [/WHERE (google_sub|discord_id|blizzard_sub) = \?/, () => [[]]];
  const insert: Route = [/INSERT INTO bg_users/, () => [{ insertId: 77 }]];
  const refusedConsent = { termsAccepted: false };
  const consent = { termsAccepted: true };

  it.each<[string, () => Promise<number>]>([
    ["Google", () => createOrGetGoogleUser({ sub: "g-1", name: "Nova" }, refusedConsent)],
    ["Blizzard", () => createOrGetBlizzardUser("bz-1", "Nova#2143", refusedConsent)],
    ["Discord", () => createOrGetDiscordUser("900000000000000001", "Nova", null, { method: "OAUTH", termsAccepted: false })],
  ])("%s : refuse de créer un compte sans acceptation, avant l'insertion", async (_label, create) => {
    install([noAccount, insert]);
    await expect(create()).rejects.toThrow("TERMS_REQUIRED");
    expect(pool.execute.mock.calls.some(([sql]) => /INSERT INTO bg_users/.test(sql))).toBe(false);
  });

  it.each<[string, () => Promise<number>]>([
    ["Google", () => createOrGetGoogleUser({ sub: "g-1", name: "Nova" }, consent)],
    ["Blizzard", () => createOrGetBlizzardUser("bz-1", "Nova#2143", consent)],
    ["Discord", () => createOrGetDiscordUser("900000000000000001", "Nova", null, { method: "DM_CODE", termsAccepted: true })],
  ])("%s : écrit l'acceptation du compte qui naît", async (_label, create) => {
    install([noAccount, insert]);
    await expect(create()).resolves.toBe(77);
    expect(recordTermsAcceptance).toHaveBeenCalledWith(77, "SIGNUP");
  });

  it("n'empêche pas un compte existant de se connecter sans la case, et n'écrit rien", async () => {
    install([[/WHERE blizzard_sub = \?/, () => [[{ id: 12 }]]], [/UPDATE bg_users SET overwatch_battletag/, () => [{}]]]);
    await expect(createOrGetBlizzardUser("bz-1", "Nova#2143", refusedConsent)).resolves.toBe(12);
    expect(recordTermsAcceptanceIfBehind).not.toHaveBeenCalled();
  });

  it("enregistre l'acceptation d'un compte existant qui coche la case, s'il était en retard", async () => {
    install([[/WHERE blizzard_sub = \?/, () => [[{ id: 12 }]]], [/UPDATE bg_users SET overwatch_battletag/, () => [{}]]]);
    await createOrGetBlizzardUser("bz-1", "Nova#2143", consent);
    expect(recordTermsAcceptanceIfBehind).toHaveBeenCalledWith(12, "LOGIN");
    expect(recordTermsAcceptance).not.toHaveBeenCalled();
  });
});
