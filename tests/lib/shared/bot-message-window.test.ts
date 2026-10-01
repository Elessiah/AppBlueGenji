import { describe, expect, it } from "@jest/globals";
import {
  BOT_MESSAGE_WINDOW_DAYS,
  BOT_MESSAGE_WINDOW_LABEL,
  normalizeBotServerEntry,
  normalizeBotServersPayload,
  normalizeBotStats,
} from "@/lib/shared/bot-message-window";

describe("fenêtre des compteurs de messages du bot", () => {
  it("est celle de la purge des messages relayés", () => {
    expect(BOT_MESSAGE_WINDOW_DAYS).toBe(7);
    expect(BOT_MESSAGE_WINDOW_LABEL).toBe("7j");
  });
});

describe("normalizeBotStats", () => {
  it("préfère le nouveau nom quand les deux sont présents", () => {
    expect(normalizeBotStats({ messagesLast7Days: 5, messagesLast30Days: 99 }).messagesLast7Days).toBe(5);
  });

  it("retombe sur l'ancien nom d'un bot pas encore déployé", () => {
    expect(
      normalizeBotStats({ messagesLast30Days: 8, relayedMessagesLast30Days: 3, uniqueUsersLast30Days: 2 }),
    ).toMatchObject({ messagesLast7Days: 8, relayedMessagesLast7Days: 3, uniqueUsersLast7Days: 2 });
  });

  it("rend zéro pour un compte absent, illisible ou NaN, et pour une charge qui n'est pas un objet", () => {
    const empty = {
      affiliatedServers: 0,
      affiliatedChannels: 0,
      messagesLast7Days: 0,
      relayedMessagesLast7Days: 0,
      uniqueUsersLast7Days: 0,
    };
    expect(normalizeBotStats(null)).toEqual(empty);
    expect(normalizeBotStats("oops")).toEqual(empty);
    expect(normalizeBotStats({ affiliatedServers: "12", messagesLast7Days: Number.NaN })).toEqual(empty);
  });

  it("ne recopie pas les champs inconnus (windowDays, anciens noms)", () => {
    const stats = normalizeBotStats({ messagesLast30Days: 1, windowDays: 7 });
    expect(Object.keys(stats).sort()).toEqual(
      ["affiliatedChannels", "affiliatedServers", "messagesLast7Days", "relayedMessagesLast7Days", "uniqueUsersLast7Days"],
    );
  });
});

describe("normalizeBotServerEntry", () => {
  it("garde relays7j et le reste de la ligne", () => {
    expect(normalizeBotServerEntry({ id: "1", name: "A", relays7j: 4 })).toEqual({ id: "1", name: "A", relays7j: 4 });
  });

  it("reprend relays30j d'un bot d'avant, sans le garder", () => {
    const entry = normalizeBotServerEntry({ id: "2", relays30j: 9 });
    expect(entry.relays7j).toBe(9);
    expect(entry).not.toHaveProperty("relays30j");
  });

  it("préfère relays7j quand les deux sont présents", () => {
    expect(normalizeBotServerEntry({ relays7j: 1, relays30j: 9 }).relays7j).toBe(1);
  });

  it("laisse une valeur illisible au tableau, qui rend un tiret", () => {
    expect(normalizeBotServerEntry({ relays7j: "beaucoup" }).relays7j).toBe("beaucoup");
  });
});

describe("normalizeBotServersPayload", () => {
  it("normalise chaque ligne et garde la pagination", () => {
    const payload = normalizeBotServersPayload({ servers: [{ relays30j: 3 }], total: 1, limit: 8, offset: 0 });
    expect(payload.servers[0].relays7j).toBe(3);
    expect(payload).toMatchObject({ total: 1, limit: 8, offset: 0 });
  });

  it("ne touche pas à une liste absente ou mal typée, ni à une charge qui n'est pas un objet", () => {
    expect(normalizeBotServersPayload({ servers: "x" }).servers).toBe("x");
    expect(normalizeBotServersPayload(null)).toBeNull();
  });

  it("laisse illisibles les lignes qui ne sont pas des objets", () => {
    // Habillées en `{ relays7j: undefined }`, elles passeraient pour des
    // serveurs vides au lieu d'être écartées par le tableau.
    const payload = normalizeBotServersPayload({ servers: [null, [], "x", { relays30j: 1 }] });
    expect(payload.servers).toEqual([null, [], "x", { relays7j: 1 }]);
  });
});
