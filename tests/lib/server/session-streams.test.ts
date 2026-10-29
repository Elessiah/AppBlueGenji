import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  closeSessionStreams,
  closeUserStreams,
  reconnectUserStreams,
  registerSessionStream,
  registeredStreamCount,
  resetSessionStreams,
  REVOCATION_MEMORY_MS,
  revocationMark,
  revokedSince,
} from "@/lib/server/session-streams";

const cleanups: (() => void)[] = [];
function register(userId: number, tokenHash: string, close: () => void = jest.fn()): () => void {
  const unregister = registerSessionStream(userId, tokenHash, close);
  cleanups.push(unregister);
  return unregister;
}

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  resetSessionStreams();
  jest.useRealTimers();
});

describe("session-streams", () => {
  it("ferme tous les flux d'un compte, et seulement les siens", () => {
    const a1 = jest.fn();
    const a2 = jest.fn();
    const b = jest.fn();
    register(1, "h1", a1);
    register(1, "h2", a2);
    register(2, "h3", b);

    expect(closeUserStreams(1)).toBe(2);
    expect(a1).toHaveBeenCalledTimes(1);
    expect(a2).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(registeredStreamCount()).toBe(1);
  });

  it("garde les flux de la session courante", () => {
    const current = jest.fn();
    const other = jest.fn();
    register(1, "courante", current);
    register(1, "autre", other);

    expect(closeUserStreams(1, { keepTokenHash: "courante" })).toBe(1);
    expect(current).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("garde l'empreinte vide quand c'est elle qu'on garde (contournement de développement)", () => {
    const dev = jest.fn();
    const real = jest.fn();
    register(1, "", dev);
    register(1, "vraie", real);

    closeUserStreams(1, { keepTokenHash: "" });
    expect(dev).not.toHaveBeenCalled();
    expect(real).toHaveBeenCalledTimes(1);
  });

  it("ferme les flux d'une session, tous comptes confondus", () => {
    const same = jest.fn();
    const other = jest.fn();
    register(1, "h", same);
    register(1, "h2", other);

    expect(closeSessionStreams("h")).toBe(1);
    expect(same).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("une empreinte vide ne désigne aucune session", () => {
    const dev = jest.fn();
    register(1, "", dev);
    expect(closeSessionStreams("")).toBe(0);
    expect(dev).not.toHaveBeenCalled();
  });

  it("ne ferme un flux qu'une fois, même révoqué deux fois", () => {
    const close = jest.fn();
    register(1, "h", close);
    closeUserStreams(1);
    closeUserStreams(1);
    closeSessionStreams("h");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("continue de fermer les suivants quand une fermeture lève", () => {
    const broken = jest.fn(() => {
      throw new Error("déjà fermé");
    });
    const next = jest.fn();
    register(1, "a", broken);
    register(1, "b", next);

    expect(closeUserStreams(1)).toBe(2);
    expect(next).toHaveBeenCalledTimes(1);
    expect(registeredStreamCount()).toBe(0);
  });

  it("la désinscription est idempotente et retire le flux", () => {
    const close = jest.fn();
    const unregister = register(1, "h", close);
    unregister();
    unregister();
    expect(registeredStreamCount()).toBe(0);
    expect(closeUserStreams(1)).toBe(0);
    expect(close).not.toHaveBeenCalled();
  });

  it("supporte qu'une fermeture désinscrive son propre flux pendant le parcours", () => {
    let unregister: () => void = () => undefined;
    const close = jest.fn(() => unregister());
    unregister = register(1, "h", close);
    register(1, "h2");

    expect(closeUserStreams(1)).toBe(2);
    expect(registeredStreamCount()).toBe(0);
  });
});

describe("revokedSince", () => {
  it("ne voit que les révocations postérieures au repère", () => {
    closeUserStreams(1);
    const mark = revocationMark();
    expect(revokedSince(1, "h", mark)).toBe(false);
    closeUserStreams(1);
    expect(revokedSince(1, "h", mark)).toBe(true);
    expect(revokedSince(2, "h", mark)).toBe(false);
  });

  it("respecte la session gardée", () => {
    const mark = revocationMark();
    closeUserStreams(1, { keepTokenHash: "garde" });
    expect(revokedSince(1, "garde", mark)).toBe(false);
    expect(revokedSince(1, "autre", mark)).toBe(true);
  });

  it("relie une déconnexion à sa session, quel que soit le compte", () => {
    const mark = revocationMark();
    closeSessionStreams("h");
    expect(revokedSince(1, "h", mark)).toBe(true);
    expect(revokedSince(1, "h2", mark)).toBe(false);
  });

  it("ne retient pas une déconnexion sans session", () => {
    const mark = revocationMark();
    closeSessionStreams("");
    expect(revokedSince(1, "", mark)).toBe(false);
  });

  it("oublie les révocations au-delà de la mémoire", () => {
    jest.useFakeTimers();
    const mark = revocationMark();
    closeUserStreams(1);
    jest.advanceTimersByTime(REVOCATION_MEMORY_MS);
    expect(revokedSince(1, "h", mark)).toBe(false);
  });
});

describe("reconnectUserStreams (EF-04)", () => {
  it("ferme tous les flux du compte, seulement les siens, sans noter de révocation", () => {
    const a1 = jest.fn();
    const a2 = jest.fn();
    const b = jest.fn();
    register(1, "h1", a1);
    register(1, "h2", a2);
    register(2, "h3", b);
    const mark = revocationMark();
    expect(reconnectUserStreams(1)).toBe(2);
    expect([a1, a2].every((close) => close.mock.calls.length === 1)).toBe(true);
    expect(b).not.toHaveBeenCalled();
    // Un flux en cours d'ouverture de cette session n'est pas refusé (401).
    expect(revokedSince(1, "h1", mark)).toBe(false);
    expect(registeredStreamCount()).toBe(1);
  });

  it("reconnectUserStreams_anyStream_closesWithReconnectReason (EF-23)", () => {
    const close = jest.fn();
    register(1, "h1", close);

    reconnectUserStreams(1);

    expect(close).toHaveBeenCalledWith("RECONNECT");
  });

  it("closeUserStreams_revocation_closesWithRevokedReason (EF-23)", () => {
    const close = jest.fn();
    register(1, "h1", close);

    closeUserStreams(1);

    expect(close).toHaveBeenCalledWith("REVOKED");
  });

  it("reconnectUserStreams_tournamentFilter_closesOnlyThoseTournamentsStreams (EF-23)", () => {
    const inScope = jest.fn();
    const otherTournament = jest.fn();
    const noTournament = jest.fn();
    cleanups.push(registerSessionStream(1, "h1", inScope, 40));
    cleanups.push(registerSessionStream(1, "h2", otherTournament, 99));
    cleanups.push(registerSessionStream(1, "h3", noTournament));

    expect(reconnectUserStreams(1, { tournamentIds: new Set([40, 41]) })).toBe(1);

    expect(inScope).toHaveBeenCalledTimes(1);
    expect(otherTournament).not.toHaveBeenCalled();
    expect(noTournament).not.toHaveBeenCalled();
  });

  it("reconnectUserStreams_severalAccounts_closesEachOnesStreams (EF-23)", () => {
    const a = jest.fn();
    const b = jest.fn();
    const c = jest.fn();
    register(1, "h1", a);
    register(2, "h2", b);
    register(3, "h3", c);

    expect(reconnectUserStreams(new Set([1, 2]))).toBe(2);

    expect(c).not.toHaveBeenCalled();
  });

  it("reconnectUserStreams_noAccount_closesNothing (EF-23)", () => {
    const close = jest.fn();
    register(1, "h1", close);

    expect(reconnectUserStreams([])).toBe(0);
    expect(close).not.toHaveBeenCalled();
  });
});
