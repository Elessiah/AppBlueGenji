import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/users-service", () => {
  const actual = jest.requireActual("@/lib/server/users-service") as Record<string, unknown>;
  return { ...actual, getUserIdByPseudo: jest.fn() };
});

import {
  cancelInvitation,
  inviteToTeam,
  listTeamPendingInvitations,
  requestToJoinTeam,
  respondToInvitation,
} from "@/lib/server/teams-service";
import { getDatabase } from "@/lib/server/database";
import { getUserIdByPseudo } from "@/lib/server/users-service";
import { type SqlMock, fakePool } from "../../helpers/sql-double";

/**
 * Circuit des invitations : les rôles choisis voyagent jusqu'à l'arrivée du
 * joueur, l'acceptation est atomique, et une invitation se retire.
 *
 * Base factice **à état** : les requêtes sont reconnues par leur texte et
 * jouées sur des tableaux en mémoire, si bien qu'un test lit ce que la
 * précédente écriture a réellement laissé — et non une réponse posée d'avance
 * dans le bon ordre, qui ne dirait rien d'un ordre d'instructions changé.
 */

type Invitation = {
  id: number;
  team_id: number;
  user_id: number;
  kind: "INVITE" | "REQUEST";
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED";
  roles_json: string[] | null;
  created_at: Date;
};

type State = {
  /** Appartenances actives : `team_id`, `user_id`, rôles. */
  members: { team_id: number; user_id: number; roles: string[] }[];
  invitations: Invitation[];
  deletedUsers: Set<number>;
  teams: Record<number, { deleted_at: Date | null; is_ghost: 0 | 1; solo_user_id: number | null }>;
  /**
   * Appartenances que seule la **transaction** voit : ce que la lecture
   * préalable sur le pool a manqué — une acceptation concurrente commitée entre
   * les deux.
   */
  lateMembers: { team_id: number; user_id: number; roles: string[] }[];
};

function freshState(): State {
  return {
    members: [{ team_id: 7, user_id: 1, roles: ["OWNER"] }],
    invitations: [],
    deletedUsers: new Set(),
    teams: { 7: { deleted_at: null, is_ghost: 0, solo_user_id: null } },
    lateMembers: [],
  };
}

let state: State;
let nextId = 100;
const connection = {
  beginTransaction: jest.fn(async () => undefined),
  commit: jest.fn(async () => undefined),
  rollback: jest.fn(async () => undefined),
  release: jest.fn(() => undefined),
  execute: jest.fn(),
};

function run(sql: string, params: unknown[], inTransaction: boolean): unknown {
  const text = sql.replace(/\s+/g, " ");
  const members = inTransaction ? [...state.members, ...state.lateMembers] : state.members;

  if (/SELECT roles_json FROM bg_team_members/.test(text)) {
    const [teamId, userId] = params as number[];
    const row = members.find((m) => m.team_id === teamId && m.user_id === userId);
    return [row ? [{ roles_json: JSON.stringify(row.roles) }] : []];
  }
  if (/SELECT id FROM bg_team_members WHERE user_id = \?/.test(text)) {
    const [userId] = params as number[];
    return [members.filter((m) => m.user_id === userId).map((_, i) => ({ id: i + 1 }))];
  }
  if (/SELECT is_deleted FROM bg_users WHERE id = \? FOR UPDATE/.test(text)) {
    const [userId] = params as number[];
    return [[{ is_deleted: state.deletedUsers.has(userId) ? 1 : 0 }]];
  }
  if (/SELECT id, kind, roles_json FROM bg_team_invitations/.test(text)) {
    const [teamId, userId] = params as number[];
    const inv = state.invitations
      .filter((i) => i.team_id === teamId && i.user_id === userId && i.status === "PENDING")
      .at(-1);
    return [inv ? [{ id: inv.id, kind: inv.kind, roles_json: inv.roles_json }] : []];
  }
  if (/FROM bg_team_invitations WHERE id = \?/.test(text)) {
    const [id] = params as number[];
    const inv = state.invitations.find((i) => i.id === id);
    return [inv ? [{ ...inv }] : []];
  }
  if (/FROM bg_team_invitations i/.test(text)) {
    const [teamId] = params as number[];
    return [
      state.invitations
        .filter((i) => i.team_id === teamId && i.status === "PENDING")
        .map((i) => ({ ...i, pseudo: `joueur${i.user_id}` })),
    ];
  }
  if (/SELECT id, deleted_at, is_ghost, solo_user_id FROM bg_teams/.test(text)) {
    const [teamId] = params as number[];
    const team = state.teams[teamId];
    return [team ? [{ id: teamId, ...team }] : []];
  }
  if (/INSERT INTO bg_team_invitations/.test(text)) {
    const kind = /'INVITE'/.test(text) ? "INVITE" : "REQUEST";
    const [teamId, userId, , roles] = params as [number, number, number, string | undefined];
    state.invitations.push({
      id: nextId++,
      team_id: teamId,
      user_id: userId,
      kind,
      status: "PENDING",
      roles_json: roles ? JSON.parse(roles) : null,
      created_at: new Date("2026-09-23T10:00:00Z"),
    });
    return [{ affectedRows: 1 }];
  }
  if (/INSERT INTO bg_team_members/.test(text)) {
    const [teamId, userId, roles] = params as [number, number, string];
    state.members.push({ team_id: teamId, user_id: userId, roles: JSON.parse(roles) });
    return [{ affectedRows: 1 }];
  }
  if (/UPDATE bg_team_invitations SET status = '(\w+)'.* WHERE id = \? AND status = 'PENDING'/.test(text)) {
    const status = text.match(/SET status = '(\w+)'/)![1] as Invitation["status"];
    const [id] = params as number[];
    const inv = state.invitations.find((i) => i.id === id && i.status === "PENDING");
    if (!inv) return [{ affectedRows: 0 }];
    inv.status = status;
    return [{ affectedRows: 1 }];
  }
  if (/UPDATE bg_team_invitations SET status = 'CANCELLED'.* WHERE user_id = \? AND status = 'PENDING'/.test(text)) {
    const [userId] = params as number[];
    let n = 0;
    for (const inv of state.invitations) {
      if (inv.user_id === userId && inv.status === "PENDING") {
        inv.status = "CANCELLED";
        n++;
      }
    }
    return [{ affectedRows: n }];
  }
  if (/UPDATE bg_team_invitations SET status = 'DECLINED'.* WHERE id = \?/.test(text)) {
    const [id] = params as number[];
    const inv = state.invitations.find((i) => i.id === id);
    if (inv) inv.status = "DECLINED";
    return [{ affectedRows: inv ? 1 : 0 }];
  }
  throw new Error(`Requête non simulée : ${text}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  state = freshState();
  nextId = 100;
  const execute = jest.fn(async (sql: unknown, params: unknown) => run(String(sql), (params ?? []) as unknown[], false));
  connection.execute.mockImplementation((async (sql: unknown, params: unknown) =>
    run(String(sql), (params ?? []) as unknown[], true)));
  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    execute,
    getConnection: jest.fn(async () => connection),
  }));
  jest.mocked(getUserIdByPseudo).mockResolvedValue(42);
});

const invite = (overrides: Partial<Invitation> = {}): Invitation => {
  const inv: Invitation = {
    id: nextId++,
    team_id: 7,
    user_id: 42,
    kind: "INVITE",
    status: "PENDING",
    roles_json: null,
    created_at: new Date("2026-09-22T10:00:00Z"),
    ...overrides,
  };
  state.invitations.push(inv);
  return inv;
};

const rolesOf = (userId: number) => state.members.find((m) => m.user_id === userId)?.roles;

describe("inviteToTeam — les rôles choisis voyagent avec l'invitation", () => {
  it("enregistre les rôles demandés", async () => {
    await expect(inviteToTeam(1, 7, "Nova", ["TANK", "MANAGER"])).resolves.toBe("INVITED");
    expect(state.invitations[0]).toMatchObject({ kind: "INVITE", roles_json: ["TANK", "MANAGER"] });
  });

  it("pose DPS quand l'appelant ne dit rien — le comportement d'origine", async () => {
    await inviteToTeam(1, 7, "Nova");
    expect(state.invitations[0].roles_json).toEqual(["DPS"]);
  });

  it("n'accorde jamais OWNER par une invitation", async () => {
    await inviteToTeam(1, 7, "Nova", ["OWNER", "HEAL"]);
    expect(state.invitations[0].roles_json).toEqual(["HEAL"]);
  });

  it.each([
    ["vide", []],
    ["réduite à OWNER", ["OWNER"]],
    ["faite de codes inconnus", ["PILOTE"]],
  ])("refuse une liste %s : un membre sans rôle n'existe pas", async (_label, roles) => {
    await expect(inviteToTeam(1, 7, "Nova", roles as never)).rejects.toThrow("MISSING_ROLE");
    expect(state.invitations).toHaveLength(0);
  });

  it("refuse avant tout un demandeur qui ne gère pas l'équipe", async () => {
    await expect(inviteToTeam(9, 7, "Nova", ["DPS"])).rejects.toThrow("FORBIDDEN");
  });

  it("valide une demande en attente en posant les rôles choisis", async () => {
    invite({ kind: "REQUEST" });

    await expect(inviteToTeam(1, 7, "Nova", ["COACH"])).resolves.toBe("JOINED");

    expect(rolesOf(42)).toEqual(["COACH"]);
    expect(state.invitations[0].status).toBe("ACCEPTED");
    expect(connection.commit).toHaveBeenCalled();
  });
});

describe("arrivée du joueur — les rôles de l'invitation sont posés", () => {
  it("le joueur qui accepte arrive avec les rôles proposés", async () => {
    const inv = invite({ roles_json: ["TANK", "MANAGER"] });

    await respondToInvitation(42, inv.id, true);

    expect(rolesOf(42)).toEqual(["TANK", "MANAGER"]);
    expect(inv.status).toBe("ACCEPTED");
  });

  it("une invitation d'avant la colonne fait arriver le joueur en DPS", async () => {
    const inv = invite({ roles_json: null });
    await respondToInvitation(42, inv.id, true);
    expect(rolesOf(42)).toEqual(["DPS"]);
  });

  it("une demande acceptée par la gestion fait arriver le joueur en DPS", async () => {
    const inv = invite({ kind: "REQUEST" });
    await respondToInvitation(1, inv.id, true);
    expect(rolesOf(42)).toEqual(["DPS"]);
  });

  it("une demande qui croise une invitation reprend les rôles de l'invitation", async () => {
    invite({ roles_json: ["CAPITAINE", "HEAL"] });

    await expect(requestToJoinTeam(42, 7)).resolves.toBe("JOINED");

    expect(rolesOf(42)).toEqual(["CAPITAINE", "HEAL"]);
  });

  it("ne pose jamais OWNER, même s'il était écrit dans l'invitation", async () => {
    const inv = invite({ roles_json: ["OWNER", "DPS"] });
    await respondToInvitation(42, inv.id, true);
    expect(rolesOf(42)).toEqual(["DPS"]);
  });

  it("rend caduques les autres invitations du joueur", async () => {
    const other = invite({ team_id: 8 });
    const inv = invite();

    await respondToInvitation(42, inv.id, true);

    expect(other.status).toBe("CANCELLED");
  });

  it("décliner n'écrit aucune appartenance", async () => {
    const inv = invite();
    await respondToInvitation(42, inv.id, false);
    expect(inv.status).toBe("DECLINED");
    expect(rolesOf(42)).toBeUndefined();
  });
});

describe("acceptation atomique", () => {
  it("s'ouvre sur le verrou du joueur, avant toute lecture ordinaire", async () => {
    const inv = invite();
    await respondToInvitation(42, inv.id, true);

    const first = String(connection.execute.mock.calls[0][0]);
    expect(first).toMatch(/SELECT is_deleted FROM bg_users WHERE id = \? FOR UPDATE/);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("refuse et défait tout si une autre équipe l'a accueilli entre-temps", async () => {
    // La lecture préalable sur le pool ne voit rien ; la transaction, elle, voit
    // l'appartenance qu'une acceptation concurrente vient de commiter.
    const inv = invite();
    state.lateMembers.push({ team_id: 8, user_id: 42, roles: ["DPS"] });

    await expect(respondToInvitation(42, inv.id, true)).rejects.toThrow("USER_ALREADY_IN_TEAM");

    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(state.members.some((m) => m.team_id === 7 && m.user_id === 42)).toBe(false);
    expect(connection.release).toHaveBeenCalled();
  });

  it("refuse une invitation qu'une autre réponse a déjà tranchée", async () => {
    const inv = invite();
    // Lue `PENDING` par l'appelant, tranchée avant la réservation.
    const originalExecute = connection.execute.getMockImplementation()!;
    connection.execute.mockImplementationOnce((async (sql: unknown, params: unknown) => {
      inv.status = "DECLINED";
      return (originalExecute as (a: unknown, b: unknown) => unknown)(sql, params);
    }));

    await expect(respondToInvitation(42, inv.id, true)).rejects.toThrow("INVITATION_NOT_PENDING");
    expect(rolesOf(42)).toBeUndefined();
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("refuse de rattacher un compte supprimé", async () => {
    const inv = invite();
    state.deletedUsers.add(42);

    await expect(respondToInvitation(42, inv.id, true)).rejects.toThrow("PLAYER_ACCOUNT_DELETED");
    expect(rolesOf(42)).toBeUndefined();
    expect(inv.status).toBe("PENDING");
  });
});

describe("acceptation — l'équipe doit encore exister", () => {
  it("refuse une équipe dissoute pendant l'attente, sans consommer l'invitation", async () => {
    const inv = invite();
    state.teams[7].deleted_at = new Date();

    await expect(respondToInvitation(42, inv.id, true)).rejects.toThrow("TEAM_DELETED");

    expect(rolesOf(42)).toBeUndefined();
    expect(inv.status).toBe("PENDING");
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("refuse une équipe devenue fantôme", async () => {
    const inv = invite();
    state.teams[7].is_ghost = 1;
    await expect(respondToInvitation(42, inv.id, true)).rejects.toThrow("TEAM_NOT_JOINABLE");
  });

  it("verrouille dans l'ordre de la dissolution : joueur, équipe, puis invitation", async () => {
    // `softDeleteTeam` écrit l'équipe puis ses invitations ; prendre
    // l'invitation avant l'équipe ouvrirait un interblocage avec elle.
    const inv = invite();
    await respondToInvitation(42, inv.id, true);

    const sqls = connection.execute.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " "));
    const user = sqls.findIndex((q) => /FROM bg_users WHERE id = \? FOR UPDATE/.test(q));
    const team = sqls.findIndex((q) => /FROM bg_teams WHERE id = \? FOR SHARE/.test(q));
    const claim = sqls.findIndex((q) => /SET status = 'ACCEPTED'/.test(q));
    expect(user).toBe(0);
    expect(team).toBeGreaterThan(user);
    expect(claim).toBeGreaterThan(team);
  });
});

describe("cancelInvitation", () => {
  it("laisse la gestion retirer une invitation de l'équipe", async () => {
    const inv = invite();
    await cancelInvitation(1, inv.id);
    expect(inv.status).toBe("CANCELLED");
  });

  it("refuse au destinataire de « retirer » une invitation : il la décline", async () => {
    const inv = invite();
    await expect(cancelInvitation(42, inv.id)).rejects.toThrow("FORBIDDEN");
    expect(inv.status).toBe("PENDING");
  });

  it("laisse un joueur retirer sa propre demande", async () => {
    const inv = invite({ kind: "REQUEST" });
    await cancelInvitation(42, inv.id);
    expect(inv.status).toBe("CANCELLED");
  });

  it("refuse à la gestion de retirer la demande d'un joueur : elle la refuse", async () => {
    const inv = invite({ kind: "REQUEST" });
    await expect(cancelInvitation(1, inv.id)).rejects.toThrow("FORBIDDEN");
  });

  it("refuse un inconnu", async () => {
    const inv = invite();
    await expect(cancelInvitation(99, inv.id)).rejects.toThrow("FORBIDDEN");
  });

  it("rend INVITATION_NOT_FOUND sur un identifiant inconnu", async () => {
    await expect(cancelInvitation(1, 12345)).rejects.toThrow("INVITATION_NOT_FOUND");
  });

  it("refuse une invitation déjà tranchée", async () => {
    const inv = invite({ status: "ACCEPTED" });
    await expect(cancelInvitation(1, inv.id)).rejects.toThrow("INVITATION_NOT_PENDING");
    expect(inv.status).toBe("ACCEPTED");
  });

  it("ne réécrit pas une invitation acceptée pendant l'annulation", async () => {
    // L'écriture est conditionnée à PENDING : la réponse arrivée entre la
    // lecture et l'écriture l'emporte.
    const inv = invite();
    const db = (await getDatabase()) as unknown as { execute: SqlMock };
    const original = db.execute.getMockImplementation()!;
    db.execute.mockImplementation((async (sql: unknown, params: unknown) => {
      if (/UPDATE bg_team_invitations/.test(String(sql))) inv.status = "ACCEPTED";
      return (original as (a: unknown, b: unknown) => unknown)(sql, params);
    }));

    await expect(cancelInvitation(1, inv.id)).rejects.toThrow("INVITATION_NOT_PENDING");
    expect(inv.status).toBe("ACCEPTED");
  });
});

describe("listTeamPendingInvitations", () => {
  it("sépare demandes reçues et invitations envoyées, rôles compris", async () => {
    invite({ roles_json: ["TANK"] });
    invite({ user_id: 43, roles_json: null });
    invite({ user_id: 44, status: "DECLINED" });
    invite({ user_id: 45, kind: "REQUEST" });

    const { requests, invitations } = await listTeamPendingInvitations(7, 1);

    expect(invitations.map((i) => [i.userId, i.roles])).toEqual([
      [42, ["TANK"]],
      // Invitation d'avant la colonne : le joueur arrivera en DPS, on le dit.
      [43, ["DPS"]],
    ]);
    expect(invitations[0].createdAt).toBe("2026-09-22T10:00:00.000Z");
    expect(requests).toEqual([
      { id: expect.any(Number), userId: 45, pseudo: "joueur45", createdAt: "2026-09-22T10:00:00.000Z" },
    ]);
  });

  it("ne contrôle les droits qu'une fois et ne lit qu'une fois", async () => {
    const db = (await getDatabase()) as unknown as { execute: SqlMock };
    await listTeamPendingInvitations(7, 1);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("est réservée à la gestion", async () => {
    await expect(listTeamPendingInvitations(7, 42)).rejects.toThrow("FORBIDDEN");
  });
});
