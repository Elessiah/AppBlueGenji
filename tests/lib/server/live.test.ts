import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
  publishTournamentEvent,
  subscribeTournament,
  getSubscribersCount,
  type TournamentLiveEvent,
} from "@/lib/server/live";

describe("live", () => {
  beforeEach(() => {
    // Reset global emitter
    const global = globalThis as any;
    delete global.__bgTournamentEmitter;
  });

  afterEach(() => {
    const global = globalThis as any;
    delete global.__bgTournamentEmitter;
  });

  describe("publishTournamentEvent", () => {
    it("does not throw when publishing event", () => {
      const event: TournamentLiveEvent = {
        type: "updated",
        tournamentId: 1,
        emittedAt: "2026-01-01T00:00:00Z",
      };
      expect(() => publishTournamentEvent(event)).not.toThrow();
    });

    it("can publish multiple events in sequence", () => {
      const event1: TournamentLiveEvent = {
        type: "updated",
        tournamentId: 1,
        emittedAt: "2026-01-01T00:00:00Z",
      };
      const event2: TournamentLiveEvent = {
        type: "score_reported",
        tournamentId: 2,
        matchId: 5,
        emittedAt: "2026-01-01T00:00:01Z",
      };
      expect(() => {
        publishTournamentEvent(event1);
        publishTournamentEvent(event2);
      }).not.toThrow();
    });
  });

  describe("subscribeTournament", () => {
    it("receives published events", (done) => {
      const tournamentId = 1;
      const event: TournamentLiveEvent = {
        type: "updated",
        tournamentId,
        emittedAt: "2026-01-01T00:00:00Z",
      };

      const callback = jest.fn();
      subscribeTournament(tournamentId, callback);
      publishTournamentEvent(event);

      // Use setImmediate to allow event to be processed
      setImmediate(() => {
        expect(callback).toHaveBeenCalledWith(event);
        done();
      });
    });

    it("returns unsubscribe function", () => {
      const unsubscribe = subscribeTournament(1, () => {});
      expect(typeof unsubscribe).toBe("function");
    });

    it("unsubscribe stops receiving events", (done) => {
      const callback = jest.fn();
      const unsubscribe = subscribeTournament(1, callback);
      unsubscribe();

      const event: TournamentLiveEvent = {
        type: "updated",
        tournamentId: 1,
        emittedAt: "2026-01-01T00:00:00Z",
      };
      publishTournamentEvent(event);

      setImmediate(() => {
        expect(callback).not.toHaveBeenCalled();
        done();
      });
    });

    it("isolates subscribers by tournament ID", (done) => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      subscribeTournament(1, callback1);
      subscribeTournament(2, callback2);

      const event1: TournamentLiveEvent = {
        type: "updated",
        tournamentId: 1,
        emittedAt: "2026-01-01T00:00:00Z",
      };
      publishTournamentEvent(event1);

      setImmediate(() => {
        expect(callback1).toHaveBeenCalledWith(event1);
        expect(callback2).not.toHaveBeenCalled();
        done();
      });
    });

    it("supports multiple subscribers for same tournament", (done) => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      subscribeTournament(1, callback1);
      subscribeTournament(1, callback2);

      const event: TournamentLiveEvent = {
        type: "score_resolved",
        tournamentId: 1,
        matchId: 3,
        emittedAt: "2026-01-01T00:00:00Z",
      };
      publishTournamentEvent(event);

      setImmediate(() => {
        expect(callback1).toHaveBeenCalledWith(event);
        expect(callback2).toHaveBeenCalledWith(event);
        done();
      });
    });
  });

  describe("getSubscribersCount", () => {
    it("returns 0 when no subscribers", () => {
      expect(getSubscribersCount(1)).toBe(0);
    });

    it("returns correct count for tournament", () => {
      subscribeTournament(1, () => {});
      expect(getSubscribersCount(1)).toBe(1);

      subscribeTournament(1, () => {});
      expect(getSubscribersCount(1)).toBe(2);
    });

    it("does not count subscribers for other tournaments", () => {
      subscribeTournament(1, () => {});
      subscribeTournament(2, () => {});

      expect(getSubscribersCount(1)).toBe(1);
      expect(getSubscribersCount(2)).toBe(1);
    });

    it("decrements count on unsubscribe", () => {
      const unsub = subscribeTournament(1, () => {});
      expect(getSubscribersCount(1)).toBe(1);

      unsub();
      expect(getSubscribersCount(1)).toBe(0);
    });
  });

  describe("event types", () => {
    it("handles 'updated' event type", (done) => {
      const callback = jest.fn();
      subscribeTournament(1, callback);

      const event: TournamentLiveEvent = {
        type: "updated",
        tournamentId: 1,
        emittedAt: "2026-01-01T00:00:00Z",
      };
      publishTournamentEvent(event);

      setImmediate(() => {
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ type: "updated" }));
        done();
      });
    });

    it("handles 'score_reported' event type", (done) => {
      const callback = jest.fn();
      subscribeTournament(1, callback);

      const event: TournamentLiveEvent = {
        type: "score_reported",
        tournamentId: 1,
        matchId: 5,
        emittedAt: "2026-01-01T00:00:00Z",
      };
      publishTournamentEvent(event);

      setImmediate(() => {
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ type: "score_reported", matchId: 5 }));
        done();
      });
    });

    it("handles 'score_resolved' event type", (done) => {
      const callback = jest.fn();
      subscribeTournament(1, callback);

      const event: TournamentLiveEvent = {
        type: "score_resolved",
        tournamentId: 1,
        matchId: 7,
        emittedAt: "2026-01-01T00:00:00Z",
      };
      publishTournamentEvent(event);

      setImmediate(() => {
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ type: "score_resolved", matchId: 7 }));
        done();
      });
    });
  });
});
