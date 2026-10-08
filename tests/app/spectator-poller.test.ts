import { describe, expect, it, jest } from "@jest/globals";
import {
  createSpectatorPoller,
  type SpectatorPollerEnv,
  type SpectatorState,
} from "@/app/suivre/tournois/[id]/_lib/spectator-poller";
import {
  SPECTATOR_MAX_POLL_MS,
  SPECTATOR_POLL_HEADER,
  SPECTATOR_RUNNING_POLL_MS,
  SPECTATOR_VIEWER_CONTEXT,
} from "@/lib/shared/spectator-view";
import type { TournamentSnapshot } from "@/lib/shared/types";
import { tournamentSnapshot } from "../helpers/tournament-detail";
import { bracketMatch } from "../helpers/bracket-match";

/**
 * Relecteur de la page sans compte, monté hors React : horloge, minuteries,
 * réseau et visibilité de l'onglet sont des doubles.
 */

type Reply = { status: number; headers?: Record<string, string>; body?: unknown } | Error;

function harness(replies: Reply[], options: { hidden?: boolean } = {}) {
  let now = 0;
  let hidden = options.hidden ?? false;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 1;
  const states: SpectatorState[] = [];
  const fetchMock = jest.fn(async (_url: string, _init: RequestInit) => {
    const reply = replies.shift();
    if (!reply) throw new Error("plus de réponse prévue");
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: reply.headers,
    });
  });
  const env: SpectatorPollerEnv = {
    fetch: fetchMock,
    now: () => now,
    setTimeout: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    isHidden: () => hidden,
    // Sans gigue : les attentes sont exactes.
    random: () => 0.5,
  };
  const poller = createSpectatorPoller(5, env, (state) => states.push(state));

  /** Avance l'horloge et déclenche les minuteries échues, réponses comprises. */
  async function advance(ms: number) {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.run();
      }
    }
    await flush();
  }

  return {
    poller,
    fetchMock,
    states,
    timers,
    last: () => states.at(-1)!,
    advance,
    setHidden: (value: boolean) => {
      hidden = value;
    },
  };
}

/** Laisse aboutir les promesses en cours (réponse, lecture du corps). */
async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

const ok = (snapshot: TournamentSnapshot, pollMs: number | null = SPECTATOR_RUNNING_POLL_MS): Reply => ({
  status: 200,
  headers: {
    etag: `"${snapshot.version}"`,
    ...(pollMs === null ? {} : { [SPECTATOR_POLL_HEADER]: String(pollMs) }),
  },
  body: snapshot,
});

const notModified = (pollMs = SPECTATOR_RUNNING_POLL_MS): Reply => ({
  status: 304,
  headers: { [SPECTATOR_POLL_HEADER]: String(pollMs) },
});

describe("relecteur de la page sans compte", () => {
  it("affiche l'instantané avec un contexte de lecteur sans aucun droit", async () => {
    const h = harness([ok(tournamentSnapshot({ version: "v1" }))]);

    await h.poller.start();

    expect(h.fetchMock).toHaveBeenCalledWith(
      "/api/spectator/tournaments/5",
      expect.objectContaining({ cache: "no-store", headers: {} }),
    );
    expect(h.last()).toMatchObject({ isLive: true, fatal: null, cadenceMs: SPECTATOR_RUNNING_POLL_MS });
    expect(h.last().detail).toMatchObject({ version: "v1", ...SPECTATOR_VIEWER_CONTEXT });
  });

  it("relit à la cadence accordée, en présentant la version détenue", async () => {
    const h = harness([ok(tournamentSnapshot({ version: "v1" })), notModified()]);
    await h.poller.start();

    await h.advance(SPECTATOR_RUNNING_POLL_MS - 1);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    await h.advance(1);

    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    expect(h.fetchMock.mock.calls[1][1]).toMatchObject({ cache: "no-store", headers: { "if-none-match": '"v1"' } });
  });

  it("garde le même plateau sur un 304", async () => {
    const h = harness([ok(tournamentSnapshot({ version: "v1" })), notModified()]);
    await h.poller.start();
    const before = h.last().detail;

    await h.advance(SPECTATOR_RUNNING_POLL_MS);

    expect(h.last().detail).toBe(before);
    expect(h.last().isLive).toBe(true);
  });

  it("réutilise les matchs inchangés d'une version à l'autre", async () => {
    const kept = bracketMatch({ id: 1 });
    const h = harness([
      ok(tournamentSnapshot({ version: "v1", matches: [kept, bracketMatch({ id: 2 })] })),
      ok(tournamentSnapshot({ version: "v2", matches: [kept, bracketMatch({ id: 2, status: "COMPLETED" })] })),
    ]);
    await h.poller.start();
    const first = h.last().detail!.matches;

    await h.advance(SPECTATOR_RUNNING_POLL_MS);

    const second = h.last().detail!.matches;
    expect(second[0]).toBe(first[0]);
    expect(second[1].status).toBe("COMPLETED");
  });

  it("suit la cadence que le serveur allonge sous la charge", async () => {
    const h = harness([ok(tournamentSnapshot(), 120_000), notModified()]);
    await h.poller.start();

    await h.advance(SPECTATOR_RUNNING_POLL_MS);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    await h.advance(120_000 - SPECTATOR_RUNNING_POLL_MS);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("relit un tournoi terminé à la cadence lente que le serveur lui donne", async () => {
    const h = harness([ok(tournamentSnapshot(), SPECTATOR_MAX_POLL_MS), notModified(SPECTATOR_MAX_POLL_MS)]);
    await h.poller.start();

    expect(h.last().cadenceMs).toBe(SPECTATOR_MAX_POLL_MS);
    await h.advance(SPECTATOR_MAX_POLL_MS - 1);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    await h.advance(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("dit qu'il réessaiera quand la toute première lecture échoue", async () => {
    const h = harness([{ status: 503, headers: { "retry-after": "60" } }, ok(tournamentSnapshot())]);
    await h.poller.start();

    expect(h.last()).toMatchObject({ detail: null, retrying: true, isLive: false });
    await h.advance(60_000);
    expect(h.last()).toMatchObject({ retrying: false, isLive: true });
  });

  it("ne parle pas de réessai quand un plateau est déjà affiché", async () => {
    const h = harness([ok(tournamentSnapshot()), new TypeError("Failed to fetch")]);
    await h.poller.start();
    await h.advance(SPECTATOR_RUNNING_POLL_MS);

    expect(h.last()).toMatchObject({ retrying: false, isLive: false });
    expect(h.last().detail).not.toBeNull();
  });

  it("retient l'âge maximal annoncé par le serveur", async () => {
    const reply = ok(tournamentSnapshot()) as { status: number; headers: Record<string, string>; body: unknown };
    reply.headers["x-bg-fresh-within-ms"] = "48000";
    const h = harness([reply]);
    await h.poller.start();

    expect(h.last().freshnessMs).toBe(48_000);
  });

  it("s'arrête sur un tournoi introuvable", async () => {
    const h = harness([{ status: 404, body: { error: "TOURNAMENT_NOT_FOUND" } }]);
    await h.poller.start();

    expect(h.last()).toMatchObject({ fatal: "TOURNAMENT_NOT_FOUND", isLive: false, cadenceMs: null });
    expect(h.timers.size).toBe(0);
  });

  it("recule après un refus du serveur, en suivant son Retry-After", async () => {
    const h = harness([ok(tournamentSnapshot()), { status: 503, headers: { "retry-after": "600" } }, notModified()]);
    await h.poller.start();
    await h.advance(SPECTATOR_RUNNING_POLL_MS);

    expect(h.last().isLive).toBe(false);
    // Le plateau reste affiché.
    expect(h.last().detail).not.toBeNull();
    await h.advance(599_999);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    await h.advance(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    expect(h.last().isLive).toBe(true);
  });

  it("double son attente quand chaque 503 redonne le même Retry-After", async () => {
    const unavailable = () => ({ status: 503, headers: { "retry-after": "60" } });
    const h = harness([ok(tournamentSnapshot()), unavailable(), unavailable(), unavailable(), notModified()]);
    await h.poller.start();
    await h.advance(SPECTATOR_RUNNING_POLL_MS);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);

    // 60 s (le Retry-After vaut le double des 30 s), puis 120 s, puis 240 s.
    await h.advance(60_000);
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    await h.advance(119_999);
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    await h.advance(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(4);
    await h.advance(239_999);
    expect(h.fetchMock).toHaveBeenCalledTimes(4);
    await h.advance(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(5);
    expect(h.last().isLive).toBe(true);
  });

  it("double son attente à chaque coupure réseau, puis revient à la cadence", async () => {
    const down = () => new TypeError("Failed to fetch");
    const h = harness([ok(tournamentSnapshot()), down(), down(), notModified(), notModified()]);
    await h.poller.start();
    await h.advance(SPECTATOR_RUNNING_POLL_MS);
    expect(h.last().isLive).toBe(false);

    // Premier recul : 2 × 30 s.
    await h.advance(2 * SPECTATOR_RUNNING_POLL_MS);
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    // Second recul : 2 × 60 s, et non 60 s de nouveau.
    await h.advance(4 * SPECTATOR_RUNNING_POLL_MS - 1);
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    await h.advance(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(4);
    expect(h.last().isLive).toBe(true);
    // Rétabli : la cadence accordée reprend.
    await h.advance(SPECTATOR_RUNNING_POLL_MS);
    expect(h.fetchMock).toHaveBeenCalledTimes(5);
  });

  it("ne relit rien onglet caché, et rattrape la lecture due au retour", async () => {
    const h = harness([ok(tournamentSnapshot()), notModified()]);
    await h.poller.start();

    h.setHidden(true);
    h.poller.attentionChanged();
    await h.advance(10 * SPECTATOR_RUNNING_POLL_MS);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);

    h.setHidden(false);
    h.poller.attentionChanged();
    await flush();
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("au retour avant l'échéance, attend seulement le reste du délai", async () => {
    const h = harness([ok(tournamentSnapshot()), notModified()]);
    await h.poller.start();
    h.setHidden(true);
    h.poller.attentionChanged();
    await h.advance(10_000);

    h.setHidden(false);
    h.poller.attentionChanged();
    await h.advance(SPECTATOR_RUNNING_POLL_MS - 10_000 - 1);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    await h.advance(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("n'arme aucune minuterie si l'onglet est déjà caché à la réponse", async () => {
    const h = harness([ok(tournamentSnapshot())], { hidden: true });
    await h.poller.start();

    expect(h.timers.size).toBe(0);
  });

  it("ne publie plus rien une fois démonté", async () => {
    const h = harness([ok(tournamentSnapshot())]);
    const pending = h.poller.start();
    h.poller.dispose();
    await pending;

    expect(h.states).toHaveLength(0);
    expect(h.timers.size).toBe(0);
  });

  it("coupe la lecture en vol au démontage", async () => {
    const h = harness([ok(tournamentSnapshot())]);
    const pending = h.poller.start();
    const signal = h.fetchMock.mock.calls[0][1].signal;
    expect(signal?.aborted).toBe(false);
    h.poller.dispose();
    await pending;

    expect(signal?.aborted).toBe(true);
  });
});
