import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/site-url", () => ({ siteBaseUrl: () => "https://site.test" }));
jest.mock("@/lib/server/web-push", () => ({
  sendWebPush: jest.fn(),
  webPushConfig: jest.fn(() => null),
}));

import { getDatabase } from "@/lib/server/database";
import {
  countDevices,
  deleteSubscription,
  endpointHash,
  exportPushData,
  loadDisabledTopics,
  purgeStaleSubscriptions,
  pushToUsers,
  saveDisabledTopics,
  saveSubscription,
  subscribedStaffCandidates,
} from "@/lib/server/push-subscriptions";
import { sendWebPush, type WebPushConfig } from "@/lib/server/web-push";
import { PUSH_SUBSCRIPTION_RETENTION_DAYS } from "@/lib/shared/push-notifications";
import { fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

const CONFIG = { publicKey: "pk", privateKey: {} as WebPushConfig["privateKey"], subject: "mailto:a@b.test" };
const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/a", p256dh: "k", auth: "s" };

function pool(members: { query?: jest.Mock<SqlQuery>; execute?: jest.Mock<SqlQuery>; getConnection?: unknown }) {
  jest.mocked(getDatabase).mockResolvedValue(fakePool(members));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("pushToUsers", () => {
  it("ne fait rien sans configuration, ni sans destinataire", async () => {
    const query = jest.fn<SqlQuery>();
    pool({ query });
    expect(await pushToUsers([1], "MATCH_START", { title: "t", body: "b", url: "/" }, {}, null)).toBe(0);
    expect(await pushToUsers([], "MATCH_START", { title: "t", body: "b", url: "/" }, {}, CONFIG)).toBe(0);
    expect(await pushToUsers([0, -2, 1.5], "MATCH_START", { title: "t", body: "b", url: "/" }, {}, CONFIG)).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("écarte en base les sujets coupés et les comptes supprimés", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([[]]);
    pool({ query });

    await pushToUsers([3, 3, 4], "SCORE_TO_CONFIRM", { title: "t", body: "b", url: "/" }, {}, CONFIG);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/u\.is_deleted = 0/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM bg_push_topic_optouts/);
    expect(params).toEqual([3, 4, "SCORE_TO_CONFIRM"]);
  });

  it("envoie à chaque appareil, oublie les abonnements morts et date les remises", async () => {
    const query = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([
        [
          { id: 10, ...SUB },
          { id: 11, ...SUB, endpoint: "https://fcm.googleapis.com/fcm/send/b" },
          { id: 12, ...SUB, endpoint: "https://fcm.googleapis.com/fcm/send/c" },
        ],
      ])
      .mockResolvedValue([{ affectedRows: 1 }]);
    pool({ query });
    jest
      .mocked(sendWebPush)
      .mockResolvedValueOnce("SENT")
      .mockResolvedValueOnce("GONE")
      .mockResolvedValueOnce("FAILED");

    const count = await pushToUsers(
      [1],
      "MATCH_START",
      { title: "Ton match commence", body: "b", url: "https://site.test/tournois/4" },
      { urgency: "high" },
      CONFIG,
    );

    expect(count).toBe(1);
    const payload = JSON.parse(jest.mocked(sendWebPush).mock.calls[0][2]);
    // Le lien est ramené à un chemin du site.
    expect(payload).toMatchObject({ topic: "MATCH_START", title: "Ton match commence", url: "/tournois/4" });
    expect(jest.mocked(sendWebPush).mock.calls[0][3]).toEqual({ urgency: "high" });
    expect(query.mock.calls[1]).toEqual([`DELETE FROM bg_push_subscriptions WHERE id IN (?)`, [11]]);
    expect(query.mock.calls[2][0]).toMatch(/SET last_success_at = NOW\(\) WHERE id IN \(\?\)/);
    expect(query.mock.calls[2][1]).toEqual([10]);
  });

  it("ne lève jamais : une panne rend zéro", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    pool({ query: jest.fn<SqlQuery>().mockRejectedValue(new Error("panne")) });
    expect(await pushToUsers([1], "MATCH_START", { title: "t", body: "b", url: "/" }, {}, CONFIG)).toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("se tait sur une table absente", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    pool({ query: jest.fn<SqlQuery>().mockRejectedValue(Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" })) });
    expect(await pushToUsers([1], "MATCH_START", { title: "t", body: "b", url: "/" }, {}, CONFIG)).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("abonnements", () => {
  it("range un abonnement par son empreinte, en le rattachant au compte courant", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([[{ user_id: 7 }]]);
    pool({ execute });

    expect(await saveSubscription(7, SUB)).toBe(true);

    const [sql, params] = execute.mock.calls[0];
    expect(params).toEqual([7, endpointHash(SUB.endpoint), SUB.endpoint, "k", "s"]);
    expect(endpointHash(SUB.endpoint)).toMatch(/^[0-9a-f]{64}$/);
    // Le titulaire est relu : `affectedRows` ne distingue pas un refus d'une
    // écriture à l'identique.
    expect(execute.mock.calls[1][0]).toMatch(/SELECT user_id FROM bg_push_subscriptions WHERE endpoint_hash = \?/);
    expect(execute.mock.calls[1][1]).toEqual([endpointHash(SUB.endpoint)]);
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/);
  });

  it("ne déplace un appareil vers un autre compte que sur preuve des clés", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{}]);
    pool({ execute });
    await saveSubscription(7, SUB).catch(() => undefined);
    const sql = String(execute.mock.calls[0][0]);
    const allowed = "(user_id = VALUES(user_id) OR (p256dh = VALUES(p256dh) AND auth = VALUES(auth)))";
    const assignments = sql
      .slice(sql.indexOf("ON DUPLICATE KEY UPDATE") + "ON DUPLICATE KEY UPDATE".length)
      .split(/,\n/)
      .map((line) => line.trim());
    // Chaque réécriture est gardée par la preuve — l'adresse seule ne suffit
    // plus, comme pour le désabonnement.
    for (const column of ["endpoint", "p256dh", "auth", "user_id"]) {
      expect(assignments).toContain(`${column} = IF(${allowed}, VALUES(${column}), ${column})`);
    }
    // Les dates ne repartent qu'au changement **accepté** de compte.
    expect(assignments).toContain(
      `created_at = IF(user_id = VALUES(user_id) OR NOT ${allowed}, created_at, CURRENT_TIMESTAMP)`,
    );
    expect(assignments).toContain(
      `last_success_at = IF(user_id = VALUES(user_id) OR NOT ${allowed}, last_success_at, NULL)`,
    );
    // `user_id` en dernier : les affectations se lisent de gauche à droite, et
    // la condition des autres doit lire le titulaire d'avant.
    expect(assignments[assignments.length - 1]).toMatch(/^user_id = /);
  });

  it("rend false quand l'appareil reste à un autre compte", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([[{ user_id: 99 }]]);
    pool({ execute });
    expect(await saveSubscription(7, SUB)).toBe(false);
  });

  it("ne désabonne que l'appareil du compte connecté", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{}]);
    pool({ execute });

    await deleteSubscription(7, SUB.endpoint);

    expect(execute.mock.calls[0][0]).toMatch(/WHERE endpoint_hash = \? AND user_id = \?/);
    expect(execute.mock.calls[0][1]).toEqual([endpointHash(SUB.endpoint), 7]);
  });

  it("compte les appareils du compte", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ devices: 2 }]]);
    pool({ execute });
    expect(await countDevices(7)).toBe(2);
    expect(execute.mock.calls[0][1]).toEqual([7]);
  });
});

describe("sujets coupés", () => {
  it("ne relit que des sujets connus, dans l'ordre du registre", async () => {
    pool({
      execute: jest.fn<SqlQuery>().mockResolvedValue([[{ topic: "MATCH_REMINDER" }, { topic: "RETIRÉ" }, { topic: "MATCH_START" }]]),
    });
    expect(await loadDisabledTopics(7)).toEqual(["MATCH_START", "MATCH_REMINDER"]);
  });

  it("remplace la liste en une transaction", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{}]);
    const connection = fakeConnection({
      beginTransaction: jest.fn(async () => undefined),
      commit: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined),
      release: jest.fn(),
      execute,
    });
    pool({ getConnection: async () => connection });

    await saveDisabledTopics(7, ["MATCH_START", "TOURNAMENT_START"]);

    expect(execute.mock.calls.map((call) => call[1])).toEqual([[7], [7, "MATCH_START"], [7, "TOURNAMENT_START"]]);
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("défait tout si une écriture échoue", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([{}]).mockRejectedValueOnce(new Error("panne"));
    const connection = fakeConnection({
      beginTransaction: jest.fn(async () => undefined),
      commit: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined),
      release: jest.fn(),
      execute,
    });
    pool({ getConnection: async () => connection });

    await expect(saveDisabledTopics(7, ["MATCH_START"])).rejects.toThrow("panne");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe("staff, purge et export", () => {
  it("ne lit comme staff que des comptes abonnés et vivants", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([[{ id: 3, is_admin: 1, platform_roles_json: null }]]);
    pool({ query });
    expect(await subscribedStaffCandidates()).toEqual([{ userId: 3, isAdmin: true, rolesJson: null }]);
    expect(query.mock.calls[0][0]).toMatch(/EXISTS \(SELECT 1 FROM bg_push_subscriptions/);
    expect(query.mock.calls[0][0]).toMatch(/is_deleted = 0/);
  });

  it("oublie les abonnements restés muets au-delà de la durée déclarée", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 4 }]);
    pool({ execute });
    expect(await purgeStaleSubscriptions()).toBe(4);
    expect(execute.mock.calls[0][0]).toContain(`INTERVAL ${PUSH_SUBSCRIPTION_RETENTION_DAYS} DAY`);
    expect(execute.mock.calls[0][0]).toContain("COALESCE(last_success_at, created_at)");
  });

  it("exporte appareils et sujets, et lit vide une table absente", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ ...SUB, created_at: new Date("2026-09-01T10:00:00Z"), last_success_at: null }]])
      .mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" }));
    pool({ execute });
    expect(await exportPushData(7)).toEqual({
      devices: [{ ...SUB, createdAt: "2026-09-01T10:00:00.000Z", lastSuccessAt: null }],
      disabledTopics: [],
    });
  });
});
