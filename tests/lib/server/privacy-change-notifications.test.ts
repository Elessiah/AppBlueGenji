import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");

import { getDatabase } from "@/lib/server/database";
import { isBotCircuitOpen, pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import {
  dispatchPrivacyChangeNotifications,
  resetPrivacyNotificationThrottle,
} from "@/lib/server/privacy-change-notifications";
import {
  PRIVACY_CHANGES,
  PRIVACY_DM_MIN_INTERVAL_DAYS,
  PRIVACY_DM_SETTLE_DAYS,
  privacyChangesForOneMessage,
} from "@/lib/shared/privacy-changes";
import { siteBaseUrl } from "@/lib/server/site-url";
import { fakePool } from "../../helpers/sql-double";

const DAY_MS = 86_400_000;
const at = (iso: string, plusDays = 0) => new Date(Date.parse(`${iso}T12:00:00Z`) + plusDays * DAY_MS);
/** Tous les changements du registre ont passé le délai de la modale. */
const NOW = at(PRIVACY_CHANGES.at(-1)!.publishedAt, PRIVACY_DM_SETTLE_DAYS);
const flat = (sql: unknown) => String(sql).replace(/\s+/g, " ").trim();

type Candidate = {
  id: number;
  pseudo: string;
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: string | null;
  created_at: string;
};

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 1,
    pseudo: "Nova",
    discord_id: "100000000000000001",
    discord_pseudo: null,
    discord_verified_at: null,
    created_at: "2025-01-01 00:00:00",
    ...overrides,
  };
}

function fakeDb(options: { candidates?: Candidate[]; done?: { user_id: number; change_id: string }[]; taken?: string[] } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const handler = async (sql: string, params: unknown[] = []) => {
    const q = flat(sql);
    calls.push({ sql: q, params });
    if (q.startsWith("SELECT u.id, u.pseudo")) return [options.candidates ?? []];
    if (q.startsWith("SELECT user_id, change_id")) return [options.done ?? []];
    if (q.startsWith("INSERT IGNORE INTO bg_privacy_change_notifications")) {
      const key = `${params[0]}:${params[1]}`;
      return [{ affectedRows: options.taken?.includes(key) ? 0 : 1 }];
    }
    return [{ affectedRows: 1 }];
  };
  const execute = jest.fn(handler);
  const query = jest.fn(handler);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, query }));
  return calls;
}

describe("dispatchPrivacyChangeNotifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPrivacyNotificationThrottle();
    jest.mocked(isBotCircuitOpen).mockReturnValue(false);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({
      sent: 1,
      unresolved: [],
      failed: [],
    });
  });
  afterEach(() => {
    resetPrivacyNotificationThrottle();
  });

  it("envoie un seul message qui cumule tous les changements dus", async () => {
    const calls = fakeDb({ candidates: [candidate()] });
    const sent = await dispatchPrivacyChangeNotifications(NOW);

    expect(sent).toBe(1);
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    const [message, recipients, context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0] as [
      string,
      unknown[],
      string,
    ];
    const batch = privacyChangesForOneMessage(PRIVACY_CHANGES, siteBaseUrl());
    for (const change of batch) expect(message).toContain(change.title);
    expect(message).not.toContain("autre(s) changement(s)");
    expect(recipients).toEqual([{ discordId: "100000000000000001", handle: null, label: "Nova" }]);
    expect(context).toBe("privacy-changes");

    // Réservé **avant** l'envoi, une ligne par changement nommé — et rien de ce
    // que le message n'a pas pu nommer.
    const reservations = calls.filter((c) => c.sql.startsWith("INSERT IGNORE INTO bg_privacy_change_notifications"));
    expect(reservations.map((c) => c.params[1])).toEqual(batch.map((c) => c.id));
  });

  it("envoie au message suivant ce qu'un message n'a pas pu nommer", async () => {
    // Le registre entier ne tient plus dans un message : le plus récent tombait
    // dans « … et 1 autre » et était pourtant marqué annoncé.
    const first = privacyChangesForOneMessage(PRIVACY_CHANGES, siteBaseUrl());
    expect(first.length).toBeLessThan(PRIVACY_CHANGES.length);
    fakeDb({
      candidates: [candidate()],
      done: first.map((change) => ({ user_id: 1, change_id: change.id })),
    });

    await dispatchPrivacyChangeNotifications(NOW);

    const message = jest.mocked(pushDiscordDirectMessages).mock.calls[0][0] as string;
    for (const change of PRIVACY_CHANGES.slice(first.length)) expect(message).toContain(change.title);
    for (const change of first) expect(message).not.toContain(change.title);
  });

  it("filtre en base : compte vivant, joignable, antérieur, ni accepté ni prévenu", async () => {
    const calls = fakeDb();
    await dispatchPrivacyChangeNotifications(NOW);
    const select = calls.find((c) => c.sql.startsWith("SELECT u.id, u.pseudo"))!;
    expect(select.sql).toContain("u.is_deleted = 0");
    expect(select.sql).toContain("u.discord_verified_at IS NOT NULL AND u.discord_pseudo IS NOT NULL");
    expect(select.sql).toContain("NOT EXISTS (SELECT 1 FROM bg_privacy_acknowledgments");
    expect(select.sql).toContain("NOT EXISTS (SELECT 1 FROM bg_privacy_change_notifications");
    expect(select.sql).toMatch(/LIMIT 20$/);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("écarte en base les comptes prévenus depuis moins d'un mois, avant la limite du lot", async () => {
    const calls = fakeDb();
    await dispatchPrivacyChangeNotifications(NOW);
    const select = calls.find((c) => c.sql.startsWith("SELECT u.id, u.pseudo"))!;
    expect(select.sql).toContain("r.sent_at > NOW() - INTERVAL ? DAY");
    expect(select.sql.indexOf("r.sent_at")).toBeLessThan(select.sql.indexOf("LIMIT"));
    expect(select.params.at(-1)).toBe(PRIVACY_DM_MIN_INTERVAL_DAYS);
  });

  it("n'écrit pas avant le délai de la modale : aucune requête", async () => {
    const first = PRIVACY_CHANGES[0].publishedAt;
    const calls = fakeDb({ candidates: [candidate()] });
    expect(await dispatchPrivacyChangeNotifications(at(first, PRIVACY_DM_SETTLE_DAYS - 1))).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("ne sélectionne que sur les changements mûrs, mais les annonce tous ensemble", async () => {
    const first = PRIVACY_CHANGES[0].publishedAt;
    const settled = PRIVACY_CHANGES.filter((c) => c.publishedAt === first);
    const fresh = PRIVACY_CHANGES.filter((c) => c.publishedAt !== first);
    expect(fresh.length).toBeGreaterThan(0);

    const calls = fakeDb({ candidates: [candidate()] });
    await dispatchPrivacyChangeNotifications(at(first, PRIVACY_DM_SETTLE_DAYS));

    const select = calls.find((c) => c.sql.startsWith("SELECT u.id, u.pseudo"))!;
    expect(select.params).toEqual([
      ...settled.flatMap((c) => [c.publishedAt, c.id, c.id]),
      PRIVACY_DM_MIN_INTERVAL_DAYS,
    ]);

    // Un seul message, qui porte aussi les changements récents — tous ceux
    // qu'il peut nommer sous le plafond du bot, le reste attendant le suivant.
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    const message = jest.mocked(pushDiscordDirectMessages).mock.calls[0][0] as string;
    const named = privacyChangesForOneMessage(PRIVACY_CHANGES, siteBaseUrl());
    expect(named.some((change) => fresh.includes(change))).toBe(true);
    for (const change of named) expect(message).toContain(change.title);
  });

  it("changements antérieurs déjà reçus : le dernier, trop récent, ne part pas seul", async () => {
    // Cas de la production : les premières entrées viennent d'être annoncées.
    const lastFresh = PRIVACY_CHANGES.at(-1)!.publishedAt;
    const announced = PRIVACY_CHANGES.filter((c) => c.publishedAt < lastFresh);
    expect(announced.length).toBeGreaterThan(0);
    fakeDb({
      candidates: [candidate()],
      done: announced.map((c) => ({ user_id: 1, change_id: c.id })),
    });
    expect(await dispatchPrivacyChangeNotifications(at(lastFresh, PRIVACY_DM_SETTLE_DAYS - 1))).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("n'utilise un tag que s'il est certifié", async () => {
    fakeDb({
      candidates: [
        candidate({ id: 1, discord_id: null, discord_pseudo: "nova", discord_verified_at: "2026-01-01 00:00:00" }),
        candidate({ id: 2, pseudo: "Faux", discord_id: "200000000000000002", discord_pseudo: "autre" }),
      ],
    });
    await dispatchPrivacyChangeNotifications(NOW);
    const recipients = jest.mocked(pushDiscordDirectMessages).mock.calls[0][1];
    expect(recipients).toEqual([
      { discordId: null, handle: "nova", label: "Nova" },
      { discordId: "200000000000000002", handle: null, label: "Faux" },
    ]);
  });

  it("n'annonce pas ce que le compte a déjà accepté ou reçu", async () => {
    const [first, ...rest] = PRIVACY_CHANGES;
    fakeDb({ candidates: [candidate()], done: [{ user_id: 1, change_id: first.id }] });
    await dispatchPrivacyChangeNotifications(NOW);
    const message = jest.mocked(pushDiscordDirectMessages).mock.calls[0][0] as string;
    expect(message).not.toContain(first.title);
    for (const change of rest) expect(message).toContain(change.title);
  });

  it("n'envoie rien pour une réservation déjà prise ailleurs", async () => {
    fakeDb({ candidates: [candidate()], taken: PRIVACY_CHANGES.map((c) => `1:${c.id}`) });
    await dispatchPrivacyChangeNotifications(NOW);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("regroupe les comptes qui ont les mêmes changements à recevoir", async () => {
    fakeDb({ candidates: [candidate({ id: 1 }), candidate({ id: 2, pseudo: "Kai", discord_id: "3" })] });
    await dispatchPrivacyChangeNotifications(NOW);
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls[0][1]).toHaveLength(2);
  });

  it("bot injoignable : rend la réservation pour réessayer", async () => {
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);
    const calls = fakeDb({ candidates: [candidate()] });
    expect(await dispatchPrivacyChangeNotifications(NOW)).toBe(0);
    const release = calls.find((c) => c.sql.startsWith("DELETE FROM bg_privacy_change_notifications"));
    expect(release).toBeDefined();
    expect(release!.params).toEqual([
      1,
      ...privacyChangesForOneMessage(PRIVACY_CHANGES, siteBaseUrl()).map((c) => c.id),
    ]);
  });

  it("membre introuvable : la réservation reste (la modale prend le relais)", async () => {
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({
      sent: 0,
      unresolved: ["Nova"],
      failed: [],
    });
    const calls = fakeDb({ candidates: [candidate()] });
    await dispatchPrivacyChangeNotifications(NOW);
    expect(calls.some((c) => c.sql.startsWith("DELETE"))).toBe(false);
  });

  it("coupe-circuit ouvert : ni lecture ni réservation", async () => {
    jest.mocked(isBotCircuitOpen).mockReturnValue(true);
    const calls = fakeDb({ candidates: [candidate()] });
    expect(await dispatchPrivacyChangeNotifications(NOW)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("hors de la fenêtre d'annonce : aucune requête", async () => {
    const calls = fakeDb({ candidates: [candidate()] });
    expect(await dispatchPrivacyChangeNotifications(new Date("2099-01-01T00:00:00Z"))).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("est étranglé à une minute", async () => {
    const calls = fakeDb();
    await dispatchPrivacyChangeNotifications(NOW);
    const count = calls.length;
    expect(await dispatchPrivacyChangeNotifications(NOW)).toBe(0);
    expect(calls).toHaveLength(count);
  });
});
