import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/push-subscriptions");
jest.mock("@/lib/server/web-push", () => ({ webPushConfig: jest.fn(() => null) }));
jest.mock("@/lib/server/outbound-mute", () => ({ outboundMuted: jest.fn(() => false) }));

import { getDatabase } from "@/lib/server/database";
import { outboundMuted } from "@/lib/server/outbound-mute";
import { isBotCircuitOpen, pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import {
  dispatchPrivacyChangeNotifications,
  PRIVACY_SWEEP_LOCK_NAME,
  resetPrivacyNotificationThrottle,
} from "@/lib/server/privacy-change-notifications";
import { LIVE_STAFF_SQL } from "@/lib/server/privacy-consent";
import {
  announceablePrivacyChanges,
  PRIVACY_CHANGES,
  PRIVACY_DM_MIN_INTERVAL_DAYS,
  PRIVACY_DM_SETTLE_DAYS,
  PRIVACY_DM_WINDOW_DAYS,
  privacyChangeDay,
  privacyChangesForOneMessage,
} from "@/lib/shared/privacy-changes";
import { siteBaseUrl } from "@/lib/server/site-url";
import { fakeConnection, fakePool } from "../../helpers/sql-double";
import { pushToUsers } from "@/lib/server/push-subscriptions";
import { webPushConfig, type WebPushConfig } from "@/lib/server/web-push";

const DAY_MS = 86_400_000;
const at = (iso: string, plusDays = 0) => new Date(Date.parse(`${iso}T12:00:00Z`) + plusDays * DAY_MS);
/** Tous les changements du registre ont passé le délai de la modale. */
const NOW = at(PRIVACY_CHANGES.at(-1)!.publishedAt, PRIVACY_DM_SETTLE_DAYS);
// Le registre que le balayage de `NOW` peut encore annoncer (fenêtre de
// `PRIVACY_DM_WINDOW_DAYS`) : les plus anciennes entrées en sortent.
const DUE = announceablePrivacyChanges(NOW);
const flat = (sql: unknown) => String(sql).replace(/\s+/g, " ").trim();

type Candidate = {
  id: number;
  pseudo: string;
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: string | null;
  created_at: string;
  google_linked: 0 | 1;
  live_staff: 0 | 1;
  locale?: string | null;
};

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 1,
    pseudo: "Nova",
    discord_id: "100000000000000001",
    discord_pseudo: null,
    discord_verified_at: null,
    created_at: "2025-01-01 00:00:00",
    // Relié à Google et caster possible : toutes les entrées, ciblées
    // comprises, le concernent.
    google_linked: 1,
    live_staff: 1,
    ...overrides,
  };
}

function fakeDb(
  options: {
    candidates?: Candidate[];
    done?: { user_id: number; change_id: string }[];
    taken?: string[];
    /** Verrou du balayage tenu par un autre processus (`GET_LOCK` rend 0). */
    lockHeldElsewhere?: boolean;
  } = {},
) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const handler = async (sql: string, params: unknown[] = []) => {
    const q = flat(sql);
    calls.push({ sql: q, params });
    if (q.startsWith("SELECT GET_LOCK")) return [[{ acquired: options.lockHeldElsewhere ? 0 : 1 }]];
    if (q.startsWith("SELECT RELEASE_LOCK")) return [[{ released: 1 }]];
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
  const getConnection = jest.fn(async () => fakeConnection({ execute, query, release: jest.fn(), destroy: jest.fn() }));
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, query, getConnection }));
  return calls;
}

describe("dispatchPrivacyChangeNotifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPrivacyNotificationThrottle();
    jest.mocked(isBotCircuitOpen).mockReturnValue(false);
    jest.mocked(pushToUsers).mockResolvedValue(0);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({
      sent: 1,
      unresolved: [],
      failed: [],
    });
  });
  afterEach(() => {
    resetPrivacyNotificationThrottle();
  });

  // EF-62 revue standard cycle 4 : envois coupés, rien n'est réservé puis perdu.
  it("dispatchPrivacyChangeNotifications_whileMuted_returnsZeroWithoutQuery", async () => {
    jest.mocked(outboundMuted).mockReturnValueOnce(true);
    fakeDb({ candidates: [candidate()] });

    const sent = await dispatchPrivacyChangeNotifications(NOW);

    expect(sent).toBe(0);
    expect(getDatabase).not.toHaveBeenCalled();
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
    const batch = privacyChangesForOneMessage(DUE, siteBaseUrl());
    for (const change of batch) expect(message).toContain(change.title);
    // #587 : le registre entier ne tient pas dans un message ; le reste, dû mais
    // gardé pour le suivant, est compté — le joueur sait que d'autres l'attendent.
    expect(message).toMatch(/… et \d+ autre\(s\) changement\(s\)\./);
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
    const first = privacyChangesForOneMessage(DUE, siteBaseUrl());
    expect(first.length).toBeLessThan(DUE.length);
    fakeDb({
      candidates: [candidate()],
      done: first.map((change) => ({ user_id: 1, change_id: change.id })),
    });

    await dispatchPrivacyChangeNotifications(NOW);

    const message = jest.mocked(pushDiscordDirectMessages).mock.calls[0][0] as string;
    // Le message suivant nomme à son tour ce qu'il peut, dans l'ordre du registre.
    // (Des conditions à accepter sont toujours du lot : le reste se lit par identifiant, pas par position.)
    const second = privacyChangesForOneMessage(DUE.filter((change) => !first.includes(change)), siteBaseUrl());
    expect(second.length).toBeGreaterThan(0);
    for (const change of second) expect(message).toContain(change.title);
    for (const change of first) expect(message).not.toContain(change.title);
  });

  it("dispatchPrivacyChangeNotifications_localeReadWithCandidates_noSecondAccountRead", async () => {
    // La langue vient avec la ligne : `notifyUsers` ne relit pas `bg_users`.
    const calls = fakeDb({ candidates: [candidate({ locale: "en" })] });

    await dispatchPrivacyChangeNotifications(NOW);

    expect(calls.find((c) => c.sql.startsWith("SELECT u.id, u.pseudo"))?.sql).toContain("u.locale");
    expect(calls.some((c) => c.sql.startsWith("SELECT id, locale FROM bg_users"))).toBe(false);
    const [message] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toMatch(/privacy/i);
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

  it("filtre en base les entrées ciblées sur leur public (compte relié à Google)", async () => {
    const calls = fakeDb();
    await dispatchPrivacyChangeNotifications(NOW);
    const select = calls.find((c) => c.sql.startsWith("SELECT u.id, u.pseudo"))!;
    expect(select.sql).toContain("u.google_sub IS NOT NULL AS google_linked");
    expect(select.sql).toContain("u.created_at < ? AND u.google_sub IS NOT NULL AND NOT EXISTS");
    expect(select.sql).toContain(`${LIVE_STAFF_SQL} AS live_staff`);
    expect(select.sql).toContain(`u.created_at < ? AND ${LIVE_STAFF_SQL} AND NOT EXISTS`);
  });

  it("ne calcule pas le fait LIVE_STAFF quand aucune entrée annonçable ne le lit", async () => {
    const last = PRIVACY_CHANGES.filter((c) => c.audience === "LIVE_STAFF").at(-1)!;
    // Fenêtre d'annonce de l'entrée passée : plus rien ne lit le fait.
    const calls = fakeDb();
    await dispatchPrivacyChangeNotifications(at(last.publishedAt, PRIVACY_DM_WINDOW_DAYS + 1));
    for (const call of calls) expect(call.sql).not.toContain("JSON_CONTAINS");
  });

  it("n'annonce pas une entrée ciblée Google à un compte qui n'y est pas relié", async () => {
    const targeted = PRIVACY_CHANGES.filter((c) => c.audience === "GOOGLE_LINKED");
    expect(targeted.length).toBeGreaterThan(0);
    // Tout le reste est déjà lu : seule l'entrée ciblée resterait due.
    fakeDb({
      candidates: [candidate({ google_linked: 0 })],
      done: PRIVACY_CHANGES.filter((c) => c.audience !== "GOOGLE_LINKED").map((c) => ({ user_id: 1, change_id: c.id })),
    });
    expect(await dispatchPrivacyChangeNotifications(NOW)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("n'annonce pas une entrée réservée aux casters à un compte qui ne peut pas caster", async () => {
    const targeted = PRIVACY_CHANGES.filter((c) => c.audience === "LIVE_STAFF");
    expect(targeted.length).toBeGreaterThan(0);
    fakeDb({
      candidates: [candidate({ live_staff: 0 })],
      done: PRIVACY_CHANGES.filter((c) => c.audience !== "LIVE_STAFF").map((c) => ({ user_id: 1, change_id: c.id })),
    });
    expect(await dispatchPrivacyChangeNotifications(NOW)).toBe(0);
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
    const now = at(first, PRIVACY_DM_SETTLE_DAYS);
    await dispatchPrivacyChangeNotifications(now);

    const select = calls.find((c) => c.sql.startsWith("SELECT u.id, u.pseudo"))!;
    expect(select.params).toEqual([
      ...settled.flatMap((c) => [c.publishedAt, c.id, c.id]),
      PRIVACY_DM_MIN_INTERVAL_DAYS,
    ]);

    // Un seul message, qui porte aussi les changements récents — tous ceux
    // qu'il peut nommer sous le plafond du bot, le reste attendant le suivant.
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    const message = jest.mocked(pushDiscordDirectMessages).mock.calls[0][0] as string;
    // Dus ce jour-là : les changements déjà publiés (pas une entrée datée d'après, mise en tête du lot).
    const named = privacyChangesForOneMessage(PRIVACY_CHANGES.filter((change) => change.publishedAt <= privacyChangeDay(now)), siteBaseUrl());
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
    const [first, ...rest] = DUE;
    fakeDb({ candidates: [candidate()], done: [{ user_id: 1, change_id: first.id }] });
    await dispatchPrivacyChangeNotifications(NOW);
    const message = jest.mocked(pushDiscordDirectMessages).mock.calls[0][0] as string;
    expect(message).not.toContain(first.title);
    // Le message nomme ce qu'il peut porter ; le reste attend le suivant.
    const named = privacyChangesForOneMessage(rest, siteBaseUrl());
    expect(named.length).toBeGreaterThan(0);
    for (const change of named) expect(message).toContain(change.title);
  });

  it("n'envoie rien pour une réservation déjà prise ailleurs", async () => {
    fakeDb({ candidates: [candidate()], taken: PRIVACY_CHANGES.map((c) => `1:${c.id}`) });
    await dispatchPrivacyChangeNotifications(NOW);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  // Garde-fou : une partie du lot déjà réservée (verrou nommé contourné,
  // réservation laissée par un processus tué) — aucun décompte juste n'est
  // possible ici.
  it("dispatchPrivacyChangeNotifications_partOfBatchTakenElsewhere_releasesOwnReservationsWithoutMessage", async () => {
    const [first, ...rest] = privacyChangesForOneMessage(DUE, siteBaseUrl());
    const calls = fakeDb({ candidates: [candidate()], taken: [`1:${first.id}`] });

    const sent = await dispatchPrivacyChangeNotifications(NOW);

    expect(sent).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    const release = calls.find((c) => c.sql.startsWith("DELETE FROM bg_privacy_change_notifications"));
    expect(release?.params).toEqual([1, ...rest.map((change) => change.id)]);
  });

  it("dispatchPrivacyChangeNotifications_partialTakeForOneAccount_otherAccountStillServed", async () => {
    const first = privacyChangesForOneMessage(DUE, siteBaseUrl())[0];
    fakeDb({
      candidates: [candidate({ id: 1 }), candidate({ id: 2, pseudo: "Kai", discord_id: "3" })],
      taken: [`1:${first.id}`],
    });

    await dispatchPrivacyChangeNotifications(NOW);

    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls[0][1]).toHaveLength(1);
  });

  it("dispatchPrivacyChangeNotifications_sweepRunsUnderNamedLock_takenWithoutWaitAndReleased", async () => {
    const calls = fakeDb({ candidates: [candidate()] });

    await dispatchPrivacyChangeNotifications(NOW);

    const lock = calls.findIndex((c) => c.sql.startsWith("SELECT GET_LOCK"));
    const reserve = calls.findIndex((c) => c.sql.startsWith("INSERT IGNORE INTO bg_privacy_change_notifications"));
    const unlock = calls.findIndex((c) => c.sql.startsWith("SELECT RELEASE_LOCK"));
    expect(calls[lock].params).toEqual([PRIVACY_SWEEP_LOCK_NAME, 0]);
    expect(lock).toBeLessThan(reserve);
    expect(unlock).toBeGreaterThan(reserve);
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
  });

  // Deux processus au même instant : l'un balaie, l'autre passe son tour au lieu
  // de se partager les réservations d'un compte (chacun rendant sa part, aucun
  // n'écrivant).
  it("dispatchPrivacyChangeNotifications_lockHeldByAnotherProcess_skipsWithoutReservingOrSending", async () => {
    const calls = fakeDb({ candidates: [candidate()], lockHeldElsewhere: true });

    expect(await dispatchPrivacyChangeNotifications(NOW)).toBe(0);

    expect(calls.some((c) => c.sql.startsWith("SELECT u.id, u.pseudo"))).toBe(false);
    expect(calls.some((c) => c.sql.startsWith("INSERT IGNORE"))).toBe(false);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("dispatchPrivacyChangeNotifications_lockSkipped_nextSweepAfterThrottleSends", async () => {
    fakeDb({ candidates: [candidate()], lockHeldElsewhere: true });
    await dispatchPrivacyChangeNotifications(NOW);
    resetPrivacyNotificationThrottle();
    fakeDb({ candidates: [candidate()] });

    await dispatchPrivacyChangeNotifications(NOW);

    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
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
      ...privacyChangesForOneMessage(DUE, siteBaseUrl()).map((c) => c.id),
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

describe("dispatchPrivacyChangeNotifications — notifications push", () => {
  const CONFIG = { publicKey: "pk", privateKey: {} as WebPushConfig["privateKey"], subject: "mailto:a@b.test" };

  beforeEach(() => {
    jest.clearAllMocks();
    resetPrivacyNotificationThrottle();
    jest.mocked(isBotCircuitOpen).mockReturnValue(false);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 1, unresolved: [], failed: [] });
    jest.mocked(pushToUsers).mockResolvedValue(1);
  });
  afterEach(() => {
    resetPrivacyNotificationThrottle();
    jest.mocked(webPushConfig).mockReturnValue(null);
  });

  it("ne retient un compte sans Discord que si le push est allumé", async () => {
    jest.mocked(webPushConfig).mockReturnValue(null);
    const off = fakeDb({ candidates: [] });
    await dispatchPrivacyChangeNotifications(NOW);
    expect(off.find((c) => c.sql.startsWith("SELECT u.id, u.pseudo"))!.sql).not.toContain("bg_push_subscriptions");

    resetPrivacyNotificationThrottle();
    jest.mocked(webPushConfig).mockReturnValue(CONFIG);
    const on = fakeDb({ candidates: [] });
    await dispatchPrivacyChangeNotifications(NOW);
    expect(on.find((c) => c.sql.startsWith("SELECT u.id, u.pseudo"))!.sql).toContain(
      "OR EXISTS (SELECT 1 FROM bg_push_subscriptions s WHERE s.user_id = u.id)",
    );
  });

  it("retombe sur Discord seul si la table des abonnements manque", async () => {
    jest.mocked(webPushConfig).mockReturnValue(CONFIG);
    const handler = async (sql: string) => {
      const q = flat(sql);
      if (q.startsWith("SELECT u.id, u.pseudo")) {
        if (q.includes("bg_push_subscriptions")) throw Object.assign(new Error("absente"), { code: "ER_NO_SUCH_TABLE" });
        return [[candidate()]];
      }
      if (q.startsWith("SELECT user_id, change_id")) return [[]];
      if (q.startsWith("SELECT GET_LOCK")) return [[{ acquired: 1 }]];
      return [{ affectedRows: 1 }];
    };
    const execute = jest.fn(handler);
    const query = jest.fn(handler);
    const getConnection = jest.fn(async () => fakeConnection({ execute, query, release: jest.fn() }));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, query, getConnection }));

    expect(await dispatchPrivacyChangeNotifications(NOW)).toBeGreaterThan(0);
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
  });

  it("prévient en push un compte sans Discord, et ne rend au balayage que ceux que le bot devait joindre", async () => {
    jest.mocked(webPushConfig).mockReturnValue(CONFIG);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);
    const calls = fakeDb({
      candidates: [candidate({ id: 1 }), candidate({ id: 2, discord_id: null, pseudo: "Kiro" })],
    });

    await dispatchPrivacyChangeNotifications(NOW);

    expect(jest.mocked(pushToUsers).mock.calls[0][0]).toEqual([1, 2]);
    expect(jest.mocked(pushToUsers).mock.calls[0][1]).toBe("PRIVACY_CHANGE");
    const release = calls.find((c) => c.sql.startsWith("DELETE FROM bg_privacy_change_notifications"))!;
    expect(release.params[0]).toBe(1);
    expect(release.params).not.toContain(2);
  });
});
