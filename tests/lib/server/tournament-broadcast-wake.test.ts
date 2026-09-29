import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { constants as zlibConstants, gunzipSync } from "node:zlib";
import type { TournamentSnapshot } from "@/lib/shared/types";
import type { TournamentSnapshotFrame } from "@/lib/server/tournaments/snapshot";

// Même dispositif que `tournament-broadcast.test.ts` : la salle ne sait rien de
// la base, on lui sert des instantanés fabriqués et on compte ses lectures.
const getFrame = jest.fn<(id: number) => Promise<TournamentSnapshotFrame | null>>();

jest.mock("@/lib/server/tournaments/snapshot", () => ({
  getTournamentSnapshotFrame: (id: number) => getFrame(id),
}));

import {
  MAX_BUDGET_DELAY_MS,
  ROOM_BYTES_PER_SECOND,
  ROOM_READ_RETRY_MS,
  ROOM_SAFETY_NET_MS,
  SCORE_DEADLINE_MARGIN_MS,
  STATE_CATCH_UP_MS,
  budgetDelayMs,
  isRoomOverdue,
  isStateOverdue,
  joinTournamentRoom,
  nextRoomWakeAt,
  resetTournamentBroadcast,
  roomBudgetDelayMs,
} from "@/lib/server/tournament-broadcast";
import { publishTournamentEvent } from "@/lib/server/live";
import { GZIP_STREAM_HEADER } from "@/lib/server/sse-gzip";
import { REFRESH_CADENCE } from "@/lib/shared/refresh-tiers";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";

// Un tournoi en cours dont les jalons sont passés : aucune bascule à venir ni en retard.
const OPENED_AT = "2000-01-01T00:00:00.000Z";
const CLOSED_AT = "2000-01-02T00:00:00.000Z";
const STARTED_AT = "2000-01-03T00:00:00.000Z";
const iso = (ms: number) => new Date(ms).toISOString();

function frameOf(
  version: string,
  card: Partial<TournamentSnapshot["card"]> = {},
  matches: unknown[] = [],
  body = `"${version}"`,
): TournamentSnapshotFrame {
  const snapshot = {
    card: {
      id: 1,
      state: "RUNNING",
      registrationOpenAt: OPENED_AT,
      registrationCloseAt: CLOSED_AT,
      startAt: STARTED_AT,
      ...card,
    },
    matches,
    version,
  } as unknown as TournamentSnapshot;
  const frame = new TextEncoder().encode(`data: ${body}\n\n`);
  return {
    snapshot,
    version,
    frame,
    // Vue sur la trame, comme en production.
    snapshotJson: frame.subarray("data: ".length, frame.byteLength - 2),
  };
}

/** Trame lourde et répétitive, comme le JSON d'un plateau. */
function heavyFrame(version: string, matches = 2_000, variety = 97): TournamentSnapshotFrame {
  const rows = Array.from(
    { length: matches },
    (_, id) =>
      `{"id":${id % variety},"status":"READY","team1Name":"Équipe ${id % variety}","team2Name":null}`,
  );
  return frameOf(version, {}, [], `{"matches":[${rows.join(",")}],"version":"${version}"}`);
}

function plainSubscriber(version: string | null = null) {
  const received: string[] = [];
  return {
    received,
    handle: {
      tier: "PRIORITY" as const,
      version,
      send: (frame: Uint8Array) => {
        received.push(new TextDecoder().decode(frame).trim());
      },
    },
  };
}

function gzipSubscriber() {
  const chunks: Uint8Array[] = [];
  return {
    chunks,
    /** Ce que le navigateur décoderait : l'en-tête, puis les morceaux reçus. */
    decoded: () =>
      gunzipSync(Buffer.concat([GZIP_STREAM_HEADER, ...chunks]), {
        finishFlush: zlibConstants.Z_SYNC_FLUSH,
      }).toString("utf8"),
    handle: {
      tier: "PRIORITY" as const,
      encoding: "gzip" as const,
      version: null,
      send: (frame: Uint8Array) => {
        chunks.push(frame);
      },
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await settle();
}

function publish(): void {
  publishTournamentEvent({ type: "updated", tournamentId: 1, emittedAt: new Date().toISOString() });
}

beforeEach(() => {
  jest.useFakeTimers();
  getFrame.mockReset();
  getFrame.mockResolvedValue(frameOf("v1"));
  resetTournamentBroadcast();
  delete (globalThis as { __bgTournamentEmitter?: unknown }).__bgTournamentEmitter;
});

afterEach(() => {
  resetTournamentBroadcast();
  jest.useRealTimers();
  delete (globalThis as { __bgTournamentEmitter?: unknown }).__bgTournamentEmitter;
});

/**
 * Le battement d'entretien reconstruisait l'instantané entier toutes les 30 s,
 * pour chaque salle occupée — y compris un tournoi terminé, ou en cours sans
 * la moindre échéance, où il ne pouvait rien faire avancer. La salle se réveille
 * désormais à la prochaine échéance connue, et un filet rattrape le reste.
 */
describe("nextRoomWakeAt", () => {
  const NOW = Date.parse("2030-01-01T12:00:00.000Z");
  const snapshotOf = (card: Partial<TournamentSnapshot["card"]>, matches: unknown[] = []) =>
    frameOf("v", card, matches).snapshot;

  it("ne réveille jamais un tournoi terminé", () => {
    expect(nextRoomWakeAt(snapshotOf({ state: "FINISHED" }), NOW)).toBeNull();
  });

  it("retombe sur le filet sans échéance connue", () => {
    expect(nextRoomWakeAt(snapshotOf({ state: "RUNNING" }), NOW)).toBe(NOW + ROOM_SAFETY_NET_MS);
  });

  it("se réveille à la bascule d'état quand elle précède le filet", () => {
    const snapshot = snapshotOf({
      state: "REGISTRATION",
      registrationOpenAt: iso(NOW - 60_000),
      registrationCloseAt: iso(NOW + 30_000),
      startAt: iso(NOW + 60_000),
    });
    const wake = nextRoomWakeAt(snapshot, NOW);
    expect(wake).not.toBeNull();
    expect(wake!).toBeGreaterThan(NOW);
    expect(wake!).toBeLessThanOrEqual(NOW + 30_001);
  });

  it("se réveille juste après le plus proche délai de report", () => {
    const snapshot = snapshotOf({ state: "RUNNING" }, [
      { status: "AWAITING_CONFIRMATION", scoreDeadlineAt: iso(NOW + 120_000) },
      { status: "AWAITING_CONFIRMATION", scoreDeadlineAt: iso(NOW + 45_000) },
      // Un délai sur un match qui n'attend plus rien ne compte pas.
      { status: "COMPLETED", scoreDeadlineAt: iso(NOW + 5_000) },
    ]);
    expect(nextRoomWakeAt(snapshot, NOW)).toBe(NOW + 45_000 + SCORE_DEADLINE_MARGIN_MS);
  });

  it("rattrape un report unique expiré que la lecture n'a pas tranché, sans boucler", () => {
    // Lecture servie par le cache juste avant le délai : rattrapage une fois le
    // cache expiré, puis au pas lent si le retard persiste.
    const snapshot = snapshotOf({ state: "RUNNING" }, [
      {
        status: "AWAITING_CONFIRMATION",
        scoreDeadlineAt: iso(NOW - 10_000),
        team1Report: { score: 2, opponentScore: 1 },
        team2Report: null,
      },
    ]);
    expect(isRoomOverdue(snapshot, NOW)).toBe(true);
    expect(nextRoomWakeAt(snapshot, NOW)).toBe(NOW + STATE_CATCH_UP_MS);
    expect(nextRoomWakeAt(snapshot, NOW, ROOM_READ_RETRY_MS)).toBe(NOW + ROOM_READ_RETRY_MS);
  });

  it("n'attend d'un conflit expiré que son escalade à l'arbitrage", () => {
    // Deux reports contradictoires : l'expiration ne tranche rien. Relire toutes
    // les 30 s jusqu'à l'arbitrage rouvrirait le battement supprimé.
    const conflict = (deadline: number) => ({
      status: "AWAITING_CONFIRMATION",
      scoreDeadlineAt: iso(deadline),
      team1Report: { score: 2, opponentScore: 1 },
      team2Report: { score: 2, opponentScore: 1 },
    });
    const escalation = SCORE_REPORT_TIMEOUT_MINUTES * 60_000;

    // Délai passé depuis longtemps, escalade dans une minute.
    const fresh = snapshotOf({ state: "RUNNING" }, [conflict(NOW - escalation + 60_000)]);
    expect(isRoomOverdue(fresh, NOW)).toBe(false);
    expect(nextRoomWakeAt(fresh, NOW)).toBe(NOW + 60_000 + SCORE_DEADLINE_MARGIN_MS);

    // Délai tout juste passé : l'escalade est loin, le filet l'emporte — et
    // surtout pas une relecture toutes les 30 s.
    const recent = snapshotOf({ state: "RUNNING" }, [conflict(NOW - 10_000)]);
    expect(nextRoomWakeAt(recent, NOW)).toBe(
      Math.min(NOW + ROOM_SAFETY_NET_MS, NOW - 10_000 + escalation + SCORE_DEADLINE_MARGIN_MS),
    );

    // Escalade tout juste échue : la lecture a pu venir du cache, une relecture
    // la rattrape — une seule, la fenêtre étant plus courte que le rattrapage.
    const escalating = snapshotOf({ state: "RUNNING" }, [
      conflict(NOW - escalation - SCORE_DEADLINE_MARGIN_MS),
    ]);
    expect(isRoomOverdue(escalating, NOW)).toBe(true);
    expect(nextRoomWakeAt(escalating, NOW)).toBe(NOW + STATE_CATCH_UP_MS);
    expect(isRoomOverdue(escalating, NOW + STATE_CATCH_UP_MS)).toBe(false);

    // Escalade passée : plus rien à attendre que le filet.
    const stalled = snapshotOf({ state: "RUNNING" }, [conflict(NOW - escalation - 60_000)]);
    expect(nextRoomWakeAt(stalled, NOW)).toBe(NOW + ROOM_SAFETY_NET_MS);
  });

  it("rattrape vite une bascule déjà passée que l'instantané ne reflète pas", () => {
    // L'instantané lu à l'heure de la bascule venait du cache : l'entretien n'a
    // pas joué. Sans rattrapage, la bascule passée n'est plus une échéance
    // future, et le coup d'envoi n'arriverait qu'au filet, 5 min plus tard.
    const snapshot = snapshotOf({
      state: "REGISTRATION",
      registrationOpenAt: iso(NOW - 120_000),
      registrationCloseAt: iso(NOW - 60_000),
      startAt: iso(NOW - 1_000),
    });
    expect(isStateOverdue(snapshot.card, NOW)).toBe(true);
    expect(nextRoomWakeAt(snapshot, NOW)).toBe(NOW + STATE_CATCH_UP_MS);
    expect(nextRoomWakeAt(snapshot, NOW, ROOM_READ_RETRY_MS)).toBe(NOW + ROOM_READ_RETRY_MS);
  });

  it("ne conclut pas au retard sur des dates illisibles ni sur un état à jour", () => {
    expect(isStateOverdue(snapshotOf({ state: "RUNNING", startAt: "??" }).card, NOW)).toBe(false);
    expect(
      isStateOverdue(
        snapshotOf({
          state: "RUNNING",
          registrationOpenAt: iso(NOW - 3),
          registrationCloseAt: iso(NOW - 2),
          startAt: iso(NOW - 1),
        }).card,
        NOW,
      ),
    ).toBe(false);
    expect(isStateOverdue(snapshotOf({ state: "FINISHED" }).card, NOW)).toBe(false);
  });

  it("ignore un délai illisible", () => {
    const snapshot = snapshotOf({ state: "RUNNING" }, [
      { status: "AWAITING_CONFIRMATION", scoreDeadlineAt: "pas une date" },
    ]);
    expect(nextRoomWakeAt(snapshot, NOW)).toBe(NOW + ROOM_SAFETY_NET_MS);
  });
});

describe("tournament-broadcast — réveil d'entretien", () => {
  /**
   * Abonne un lecteur qui tient `frame`, puis laisse passer le contrôle
   * d'arrivée (une lecture, sans envoi) : les tests comptent ensuite les seules
   * lectures du réveil.
   */
  async function settledJoin(
    frame: TournamentSnapshotFrame,
    viewer: ReturnType<typeof plainSubscriber>,
  ): Promise<void> {
    getFrame.mockResolvedValue(frame);
    joinTournamentRoom(1, viewer.handle, frame.snapshot);
    await advance(0);
    expect(viewer.received).toEqual([]);
    getFrame.mockClear();
  }

  it("ne relit jamais l'instantané d'un tournoi terminé qu'on regarde", async () => {
    const finished = frameOf("v1", { state: "FINISHED" });
    const viewer = plainSubscriber("v1");
    await settledJoin(finished, viewer);

    await advance(60 * 60_000);

    expect(getFrame).not.toHaveBeenCalled();
    expect(viewer.received).toEqual([]);
  });

  it("relit un tournoi terminé quand une correction est publiée", async () => {
    const finished = frameOf("v1", { state: "FINISHED" });
    const viewer = plainSubscriber("v1");
    joinTournamentRoom(1, viewer.handle, finished.snapshot);

    getFrame.mockResolvedValue(frameOf("v2", { state: "FINISHED" }));
    publish();
    await advance(0);

    expect(viewer.received).toEqual(['data: "v2"']);
  });

  it("n'attend plus 30 s pour un tournoi en cours sans échéance", async () => {
    const viewer = plainSubscriber("v1");
    await settledJoin(frameOf("v1"), viewer);

    await advance(ROOM_SAFETY_NET_MS - 1_000);
    expect(getFrame).not.toHaveBeenCalled();

    getFrame.mockResolvedValue(frameOf("v2"));
    await advance(1_000);
    expect(getFrame).toHaveBeenCalledTimes(1);
    expect(viewer.received).toEqual(['data: "v2"']);
  });

  it("se réveille au délai de report, pas avant", async () => {
    const deadline = Date.now() + 90_000;
    const running = frameOf("v1", {}, [
      { status: "AWAITING_CONFIRMATION", scoreDeadlineAt: iso(deadline) },
    ]);
    const viewer = plainSubscriber("v1");
    await settledJoin(running, viewer);

    await advance(89_000);
    expect(getFrame).not.toHaveBeenCalled();

    // Le report a été tranché par l'entretien à la lecture.
    getFrame.mockResolvedValue(frameOf("v2"));
    await advance(1_000 + SCORE_DEADLINE_MARGIN_MS);
    expect(getFrame).toHaveBeenCalledTimes(1);
    expect(viewer.received).toEqual(['data: "v2"']);
  });

  it("replanifie son réveil sur chaque nouvelle lecture", async () => {
    const viewer = plainSubscriber("v1");
    await settledJoin(frameOf("v1"), viewer);

    // Un report est saisi : la lecture qui suit découvre son délai.
    const deadline = Date.now() + 60_000;
    getFrame.mockResolvedValue(
      frameOf("v2", {}, [{ status: "AWAITING_CONFIRMATION", scoreDeadlineAt: iso(deadline) }]),
    );
    publish();
    await advance(0);
    expect(getFrame).toHaveBeenCalledTimes(1);

    getFrame.mockResolvedValue(frameOf("v3"));
    await advance(60_000 + SCORE_DEADLINE_MARGIN_MS);
    expect(getFrame).toHaveBeenCalledTimes(2);
    expect(viewer.received).toEqual(['data: "v2"', 'data: "v3"']);
  });

  it("relit après le cache une bascule manquée, puis au pas lent si elle persiste", async () => {
    const start = Date.now() + 10_000;
    const beforeKickoff = {
      state: "UPCOMING" as const,
      registrationOpenAt: iso(start - 120_000),
      registrationCloseAt: iso(start - 60_000),
      startAt: iso(start),
    };
    const viewer = plainSubscriber("v1");
    await settledJoin(frameOf("v1", beforeKickoff), viewer);

    // À l'heure du coup d'envoi, la lecture sert encore l'instantané en cache.
    await advance(10_000);
    expect(getFrame).toHaveBeenCalledTimes(1);

    // Rattrapage une fois le cache expiré — toujours en retard (entretien qui
    // n'aboutit pas) : la salle ne boucle pas, elle passe au pas lent.
    await advance(STATE_CATCH_UP_MS);
    expect(getFrame).toHaveBeenCalledTimes(2);
    await advance(STATE_CATCH_UP_MS);
    expect(getFrame).toHaveBeenCalledTimes(2);

    // L'entretien finit par passer : le tournoi est en cours.
    getFrame.mockResolvedValue(frameOf("v2", { ...beforeKickoff, state: "RUNNING" }));
    await advance(ROOM_READ_RETRY_MS - STATE_CATCH_UP_MS);
    expect(getFrame).toHaveBeenCalledTimes(3);
    expect(viewer.received).toEqual(['data: "v2"']);
  });

  it("rattrape à l'arrivée un lecteur qui a manqué une diffusion", async () => {
    // La route lit v1, puis résout le contexte du lecteur : pendant ce temps,
    // un score est diffusé (v2) aux abonnés déjà là. Sans contrôle d'arrivée,
    // le nouveau venu resterait sur v1 jusqu'au filet — ou pour toujours sur
    // un tournoi terminé.
    const early = plainSubscriber(null);
    getFrame.mockResolvedValue(frameOf("v2", { state: "FINISHED" }));
    joinTournamentRoom(1, early.handle);
    publish();
    await advance(0);
    expect(early.received).toEqual(['data: "v2"']);

    const late = plainSubscriber("v1");
    joinTournamentRoom(1, late.handle, frameOf("v1", { state: "FINISHED" }).snapshot);
    await advance(0);
    expect(late.received).toEqual(['data: "v2"']);
  });

  it("ne repousse pas une échéance proche après une lecture en échec", async () => {
    // Un coup d'envoi dans 5 s ; une écriture publiée entre-temps tombe sur une
    // base en panne. Le délai d'essai (30 s) ne doit pas remplacer le réveil.
    const start = Date.now() + 5_000;
    const beforeKickoff = {
      state: "UPCOMING" as const,
      registrationOpenAt: iso(start - 120_000),
      registrationCloseAt: iso(start - 60_000),
      startAt: iso(start),
    };
    const viewer = plainSubscriber("v1");
    await settledJoin(frameOf("v1", beforeKickoff), viewer);

    getFrame.mockRejectedValueOnce(new Error("ECONNRESET"));
    publish();
    await advance(0);
    expect(getFrame).toHaveBeenCalledTimes(1);

    getFrame.mockResolvedValue(frameOf("v2", { ...beforeKickoff, state: "RUNNING" }));
    await advance(5_000);
    expect(getFrame).toHaveBeenCalledTimes(2);
    expect(viewer.received).toEqual(['data: "v2"']);
  });

  it("retente une lecture en échec sans attendre le filet", async () => {
    const running = frameOf("v1");
    const viewer = plainSubscriber("v1");
    joinTournamentRoom(1, viewer.handle, running.snapshot);

    getFrame.mockRejectedValueOnce(new Error("ECONNRESET"));
    publish();
    await advance(0);
    expect(getFrame).toHaveBeenCalledTimes(1);

    getFrame.mockResolvedValue(frameOf("v2"));
    await advance(ROOM_READ_RETRY_MS);
    expect(getFrame).toHaveBeenCalledTimes(2);
    expect(viewer.received).toEqual(['data: "v2"']);
  });

  it("fait une lecture de précaution quand la salle ne sait rien du tournoi", async () => {
    const viewer = plainSubscriber(null);
    joinTournamentRoom(1, viewer.handle);

    await advance(ROOM_READ_RETRY_MS);
    expect(getFrame).toHaveBeenCalledTimes(1);
  });

  it("n'arme plus rien une fois la salle fermée", async () => {
    const viewer = plainSubscriber("v1");
    const leave = joinTournamentRoom(1, viewer.handle, frameOf("v1").snapshot);
    leave();

    await advance(ROOM_SAFETY_NET_MS * 2);
    expect(getFrame).not.toHaveBeenCalled();
  });
});

/**
 * Le flux partait en clair : 238 Ko par instantané sur un gros plateau, et c'est
 * ce poids brut que le budget de sortie convertissait en attente — jusqu'à une
 * mise à jour par minute pour les joueurs eux-mêmes. Un abonné qui accepte gzip
 * reçoit désormais la trame compressée, calculée une fois pour tous, et c'est
 * ce poids-là qui compte.
 */
describe("tournament-broadcast — compression", () => {
  it("écrit la trame compressée à un abonné gzip, et la trame en clair aux autres", async () => {
    const frame = heavyFrame("v1");
    getFrame.mockResolvedValue(frame);
    const compressed = gzipSubscriber();
    const plain = plainSubscriber();
    joinTournamentRoom(1, compressed.handle);
    joinTournamentRoom(1, plain.handle);

    publish();
    await advance(0);

    expect(compressed.decoded()).toBe(new TextDecoder().decode(frame.frame));
    expect(compressed.chunks[0].byteLength).toBeLessThan(frame.frame.byteLength / 5);
    expect(plain.received).toEqual([new TextDecoder().decode(frame.frame).trim()]);
  });

  it("partage la même compression entre tous les abonnés", async () => {
    getFrame.mockResolvedValue(heavyFrame("v1"));
    const viewers = Array.from({ length: 5 }, () => gzipSubscriber());
    for (const viewer of viewers) joinTournamentRoom(1, viewer.handle);

    publish();
    await advance(0);

    // Les mêmes octets, pas cinq compressions.
    for (const viewer of viewers) expect(viewer.chunks[0]).toBe(viewers[0].chunks[0]);
  });

  it("compte le poids compressé dans le budget de sortie", async () => {
    // En clair, 128 abonnés à cette trame dépasseraient la fenêtre du palier ;
    // compressée, elle tient dedans.
    const first = heavyFrame("v1", 400, 4);
    expect(budgetDelayMs(first.frame.byteLength, 128)).toBeGreaterThan(
      REFRESH_CADENCE.PRIORITY.pushCoalesceMs,
    );
    getFrame.mockResolvedValue(first);
    const viewers = Array.from({ length: 128 }, () => gzipSubscriber());
    for (const viewer of viewers) joinTournamentRoom(1, viewer.handle);
    publish();
    await advance(0);

    getFrame.mockResolvedValue(heavyFrame("v2", 400, 4));
    publish();
    await advance(REFRESH_CADENCE.PRIORITY.pushCoalesceMs + 10);

    expect(viewers[0].chunks).toHaveLength(2);
    expect(viewers[0].decoded()).toContain('"version":"v2"');
  });
});

describe("roomBudgetDelayMs", () => {
  it("convertit un total d'octets en attente, plafonnée", () => {
    expect(roomBudgetDelayMs(0)).toBe(0);
    expect(roomBudgetDelayMs(ROOM_BYTES_PER_SECOND)).toBe(1_000);
    expect(roomBudgetDelayMs(ROOM_BYTES_PER_SECOND * 1_000)).toBe(MAX_BUDGET_DELAY_MS);
  });

  it("rend le même résultat que la forme par abonné", () => {
    expect(roomBudgetDelayMs(150 * 1024 * 128)).toBe(budgetDelayMs(150 * 1024, 128));
  });
});
