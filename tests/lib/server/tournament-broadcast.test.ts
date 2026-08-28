import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { TournamentSnapshot } from "@/lib/shared/types";
import type { TournamentSnapshotFrame } from "@/lib/server/tournaments/snapshot";

// Le module de diffusion ne doit rien savoir de la base : on lui sert des
// instantanés fabriqués, et on compte combien de fois il les demande — c'est
// exactement la propriété qu'on cherche à garantir (un calcul par tournoi, quel
// que soit le nombre de spectateurs).
const getFrame = jest.fn<(id: number) => Promise<TournamentSnapshotFrame | null>>();

jest.mock("@/lib/server/tournaments/snapshot", () => ({
  getTournamentSnapshotFrame: (id: number) => getFrame(id),
}));

import {
  MAX_BUDGET_DELAY_MS,
  MAX_STREAMS_PER_USER,
  ROOM_BYTES_PER_SECOND,
  acquireStreamSlot,
  budgetDelayMs,
  joinTournamentRoom,
  resetTournamentBroadcast,
  tournamentAudience,
} from "@/lib/server/tournament-broadcast";
import { publishTournamentEvent } from "@/lib/server/live";
import { REFRESH_CADENCE } from "@/lib/shared/refresh-tiers";

const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

function frameOf(version: string, bytes = 32): TournamentSnapshotFrame {
  const snapshot = {
    card: {
      id: 1,
      state: "RUNNING",
      registrationOpenAt: FAR_FUTURE,
      registrationCloseAt: FAR_FUTURE,
      startAt: FAR_FUTURE,
    },
    version,
  } as unknown as TournamentSnapshot;

  // Le poids compte : c'est lui qui déclenche le budget de sortie de la salle.
  const body = `data: ${version}`.padEnd(Math.max(bytes - 2, 1), " ");
  return {
    snapshot,
    version,
    frame: new TextEncoder().encode(`${body}\n\n`),
  };
}

/** Promesse dont le test décide du moment de résolution. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Laisse tourner les promesses en attente (le flush est asynchrone). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** Avance le temps puis laisse le flush se terminer. */
async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await settle();
}

function subscriber(tier: "PRIORITY" | "STANDARD" = "PRIORITY") {
  const received: string[] = [];
  return {
    received,
    handle: {
      tier,
      send: (frame: Uint8Array) => {
        received.push(new TextDecoder().decode(frame).trim());
      },
    },
  };
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

function publish(tournamentId = 1): void {
  publishTournamentEvent({
    type: "score_reported",
    tournamentId,
    matchId: 5,
    emittedAt: new Date().toISOString(),
  });
}

describe("tournament-broadcast — diffusion", () => {
  it("pousse l'instantané aux abonnés sur événement", async () => {
    const viewer = subscriber();
    joinTournamentRoom(1, viewer.handle);

    publish();
    await advance(0);

    expect(viewer.received).toEqual(["data: v1"]);
  });

  it("ne calcule qu'une fois pour toute la salle", async () => {
    // Le cœur du sujet : avant, cent spectateurs produisaient cent lectures
    // simultanées du détail. Ici, une seule, quelle que soit l'affluence.
    const viewers = Array.from({ length: 100 }, () => subscriber());
    for (const viewer of viewers) joinTournamentRoom(1, viewer.handle);

    publish();
    await advance(0);

    expect(getFrame).toHaveBeenCalledTimes(1);
    for (const viewer of viewers) expect(viewer.received).toEqual(["data: v1"]);
  });

  it("n'envoie rien quand le contenu n'a pas changé", async () => {
    const viewer = subscriber();
    joinTournamentRoom(1, viewer.handle);

    publish();
    await advance(0);
    publish();
    await advance(REFRESH_CADENCE.PRIORITY.pushCoalesceMs + 10);

    expect(viewer.received).toEqual(["data: v1"]);
  });

  it("envoie la nouvelle version dès qu'elle diffère", async () => {
    const viewer = subscriber();
    joinTournamentRoom(1, viewer.handle);

    publish();
    await advance(0);

    getFrame.mockResolvedValue(frameOf("v2"));
    publish();
    await advance(REFRESH_CADENCE.PRIORITY.pushCoalesceMs + 10);

    expect(viewer.received).toEqual(["data: v1", "data: v2"]);
  });

  it("ne diffuse rien à une salle vide", async () => {
    publish();
    await advance(0);
    expect(getFrame).not.toHaveBeenCalled();
  });

  it("survit à un instantané introuvable", async () => {
    getFrame.mockResolvedValue(null);
    const viewer = subscriber();
    joinTournamentRoom(1, viewer.handle);

    publish();
    await advance(0);

    expect(viewer.received).toEqual([]);
  });

  it("survit à un échec de lecture", async () => {
    getFrame.mockRejectedValue(new Error("DB_DOWN"));
    const viewer = subscriber();
    joinTournamentRoom(1, viewer.handle);

    publish();
    await advance(0);

    expect(viewer.received).toEqual([]);

    // La salle reste utilisable une fois la base revenue.
    getFrame.mockResolvedValue(frameOf("v2"));
    publish();
    await advance(REFRESH_CADENCE.PRIORITY.pushCoalesceMs + 10);
    expect(viewer.received).toEqual(["data: v2"]);
  });

  it("garde les salles indépendantes", async () => {
    const one = subscriber();
    const two = subscriber();
    joinTournamentRoom(1, one.handle);
    joinTournamentRoom(2, two.handle);

    publish(1);
    await advance(0);

    expect(one.received).toEqual(["data: v1"]);
    expect(two.received).toEqual([]);
  });
});

describe("tournament-broadcast — regroupement par palier", () => {
  it("sert le palier prioritaire avant le palier standard", async () => {
    const staff = subscriber("PRIORITY");
    const watcher = subscriber("STANDARD");
    joinTournamentRoom(1, staff.handle);
    joinTournamentRoom(1, watcher.handle);

    publish();
    await advance(0);

    // Les deux reçoivent la première version : leurs fenêtres partent à zéro.
    expect(staff.received).toEqual(["data: v1"]);
    expect(watcher.received).toEqual(["data: v1"]);

    getFrame.mockResolvedValue(frameOf("v2"));
    publish();
    await advance(REFRESH_CADENCE.PRIORITY.pushCoalesceMs + 10);

    expect(staff.received).toEqual(["data: v1", "data: v2"]);
    // Le spectateur attend encore : c'est la bande passante qu'on ménage, pas
    // la base — l'instantané est déjà calculé.
    expect(watcher.received).toEqual(["data: v1"]);

    await advance(REFRESH_CADENCE.STANDARD.pushCoalesceMs);
    expect(watcher.received).toEqual(["data: v1", "data: v2"]);
  });

  it("regroupe une rafale de changements en un seul envoi", async () => {
    const staff = subscriber("PRIORITY");
    joinTournamentRoom(1, staff.handle);

    publish();
    await advance(0);

    for (let i = 2; i <= 6; i += 1) {
      getFrame.mockResolvedValue(frameOf(`v${i}`));
      publish();
      await settle();
    }
    await advance(REFRESH_CADENCE.PRIORITY.pushCoalesceMs + 10);

    // Une seule mise à jour de rattrapage, portant la dernière version.
    expect(staff.received).toEqual(["data: v1", "data: v6"]);
  });
});

describe("tournament-broadcast — entretien", () => {
  it("rattrape ce qu'aucune écriture n'annonce", async () => {
    // Une manche qui démarre à l'heure, un report de score expiré : personne ne
    // publie d'événement. Sans ce battement, la page resterait figée.
    const viewer = subscriber();
    joinTournamentRoom(1, viewer.handle);

    getFrame.mockResolvedValue(frameOf("v2"));
    await advance(30_000);

    expect(viewer.received).toEqual(["data: v2"]);
  });
});

describe("tournament-broadcast — cycle de vie", () => {
  it("compte les abonnés", () => {
    const one = subscriber();
    const two = subscriber();
    const leave = joinTournamentRoom(1, one.handle);
    joinTournamentRoom(1, two.handle);

    expect(tournamentAudience(1)).toBe(2);
    leave();
    expect(tournamentAudience(1)).toBe(1);
  });

  it("ne compte rien pour un tournoi que personne ne suit", () => {
    expect(tournamentAudience(999)).toBe(0);
  });

  it("ferme la salle quand elle se vide", async () => {
    const viewer = subscriber();
    const leave = joinTournamentRoom(1, viewer.handle);
    leave();

    expect(tournamentAudience(1)).toBe(0);

    publish();
    await advance(60_000);
    // Plus aucun travail : ni lecture, ni battement d'entretien.
    expect(getFrame).not.toHaveBeenCalled();
  });

  it("retire un abonné dont la connexion est tombée", async () => {
    const broken = {
      tier: "PRIORITY" as const,
      send: () => {
        throw new Error("STREAM_CLOSED");
      },
    };
    const alive = subscriber();
    joinTournamentRoom(1, broken);
    joinTournamentRoom(1, alive.handle);

    publish();
    await advance(0);

    expect(tournamentAudience(1)).toBe(1);
    expect(alive.received).toEqual(["data: v1"]);
  });

  it("ne retire pas du registre une salle plus récente", async () => {
    // Une salle peut se vider pendant qu'un envoi est en attente. Le temps que
    // celui-ci reprenne, une salle NEUVE a pu prendre sa place : la retirer la
    // condamnerait à vivre hors registre — son écouteur et son battement
    // continueraient, un prochain abonné en ouvrirait une troisième, et les
    // instantanés partiraient en double.
    const gate = deferred<TournamentSnapshotFrame>();
    getFrame.mockReturnValue(gate.promise);

    const first = subscriber();
    const leaveFirst = joinTournamentRoom(1, first.handle);

    publish();
    await settle(); // l'envoi part et reste bloqué sur `getFrame`

    leaveFirst(); // la salle se vide et se ferme
    const second = subscriber();
    joinTournamentRoom(1, second.handle); // une salle neuve prend sa place

    gate.resolve(frameOf("v1"));
    await settle();

    // La salle neuve est toujours celle du registre, avec son unique abonné.
    expect(tournamentAudience(1)).toBe(1);

    // Et elle continue de servir : un seul exemplaire de chaque instantané.
    getFrame.mockResolvedValue(frameOf("v2"));
    publish();
    await advance(REFRESH_CADENCE.PRIORITY.pushCoalesceMs + 10);
    expect(second.received).toEqual(["data: v2"]);
  });

  it("supporte un désabonnement appelé deux fois", () => {
    const viewer = subscriber();
    const leave = joinTournamentRoom(1, viewer.handle);
    leave();
    expect(() => leave()).not.toThrow();
    expect(tournamentAudience(1)).toBe(0);
  });
});

describe("tournament-broadcast — plafond de flux par utilisateur", () => {
  it("accorde les places jusqu'au plafond", () => {
    for (let i = 0; i < MAX_STREAMS_PER_USER; i += 1) {
      expect(acquireStreamSlot(42)).not.toBeNull();
    }
    expect(acquireStreamSlot(42)).toBeNull();
  });

  it("rend la place à la fermeture", () => {
    const slots = Array.from({ length: MAX_STREAMS_PER_USER }, () => acquireStreamSlot(42));
    expect(acquireStreamSlot(42)).toBeNull();

    slots[0]?.();
    expect(acquireStreamSlot(42)).not.toBeNull();
  });

  it("ne libère qu'une place même si la fermeture est appelée deux fois", () => {
    const first = acquireStreamSlot(42);
    acquireStreamSlot(42);
    first?.();
    first?.();

    // Deux places prises, une seule rendue : il en reste une occupée.
    for (let i = 0; i < MAX_STREAMS_PER_USER - 1; i += 1) acquireStreamSlot(42);
    expect(acquireStreamSlot(42)).toBeNull();
  });

  it("compte chaque utilisateur séparément", () => {
    for (let i = 0; i < MAX_STREAMS_PER_USER; i += 1) acquireStreamSlot(42);
    expect(acquireStreamSlot(43)).not.toBeNull();
  });
});

describe("tournament-broadcast — budget de sortie", () => {
  it("n'impose rien à une petite salle", () => {
    // 6 ko vers 20 abonnés : absorbé bien avant la fenêtre du palier.
    expect(budgetDelayMs(6 * 1024, 20)).toBeLessThan(
      REFRESH_CADENCE.PRIORITY.pushCoalesceMs,
    );
  });

  it("espace les envois d'une salle lourde", () => {
    // Le cas réel qui motive ce budget : un tournoi à 128 équipes en double
    // élimination pèse ~150 ko, et ses 128 inscrits sont tous prioritaires.
    // Sans budget, un score rapporté écrirait 19 Mo d'un coup.
    const delay = budgetDelayMs(150 * 1024, 128);
    expect(delay).toBeGreaterThan(REFRESH_CADENCE.PRIORITY.pushCoalesceMs);
    expect(delay).toBe(
      Math.min(
        MAX_BUDGET_DELAY_MS,
        Math.ceil((150 * 1024 * 128 * 1000) / ROOM_BYTES_PER_SECOND),
      ),
    );
  });

  it("plafonne l'attente plutôt que de laisser une salle muette", () => {
    expect(budgetDelayMs(10 * 1024 * 1024, 1_000)).toBe(MAX_BUDGET_DELAY_MS);
  });

  it("n'attend rien sans abonné ni contenu", () => {
    expect(budgetDelayMs(0, 10)).toBe(0);
    expect(budgetDelayMs(1024, 0)).toBe(0);
    expect(budgetDelayMs(1024, -1)).toBe(0);
  });

  it("retarde effectivement l'envoi d'une salle lourde", async () => {
    const heavy = 256 * 1024;
    getFrame.mockResolvedValue(frameOf("v1", heavy));

    const viewers = Array.from({ length: 8 }, () => subscriber("PRIORITY"));
    for (const viewer of viewers) joinTournamentRoom(1, viewer.handle);

    publish();
    await advance(0);
    expect(viewers[0].received).toHaveLength(1);

    getFrame.mockResolvedValue(frameOf("v2", heavy));
    publish();
    await advance(REFRESH_CADENCE.PRIORITY.pushCoalesceMs + 10);
    // La fenêtre du palier est écoulée, mais pas celle du budget.
    expect(viewers[0].received).toHaveLength(1);

    await advance(budgetDelayMs(heavy, 8));
    expect(viewers[0].received).toHaveLength(2);
  });
});
