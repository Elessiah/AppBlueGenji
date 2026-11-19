import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  closeSessionStreams,
  closeUserStreams,
  reconnectRequestedSince,
  reconnectSessionStreams,
  reconnectUserStreams,
  registerSessionStream,
  registeredStreamCount,
  resetSessionStreams,
  RECONNECT_MEMORY_MAX,
  RECONNECT_MEMORY_PER_USER,
  REVOCATION_MEMORY_MS,
  revocationMark,
  revokedSince,
} from "@/lib/server/session-streams";
import { PLAYER_VIEW_EXIT_RULE } from "@/lib/server/api-guard";

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

describe("reconnectSessionStreams (ADMIN_ROLE_IMPERSONATION.md)", () => {
  it("reconnectSessionStreams_oneSession_closesOnlyThatSessionStreams", () => {
    const here = jest.fn();
    const otherDevice = jest.fn();
    const otherUser = jest.fn();
    register(1, "ici", here);
    register(1, "ailleurs", otherDevice);
    register(2, "ici", otherUser);

    expect(reconnectSessionStreams(1, "ici")).toBe(1);
    expect(here).toHaveBeenCalledTimes(1);
    expect(otherDevice).not.toHaveBeenCalled();
    expect(otherUser).not.toHaveBeenCalled();
  });

  it("reconnectSessionStreams_switch_isNotARevocation", () => {
    register(1, "ici");
    const mark = revocationMark();

    reconnectSessionStreams(1, "ici");

    expect(revokedSince(1, "ici", mark)).toBe(false);
  });

  it("reconnectSessionStreams_nullHash_closesEveryStreamOfTheAccount", () => {
    const cookieless = jest.fn();
    const staleCookie = jest.fn();
    const otherUser = jest.fn();
    register(1, "", cookieless);
    register(1, "vraie", staleCookie);
    register(2, "", otherUser);

    expect(reconnectSessionStreams(1, null)).toBe(2);
    expect(otherUser).not.toHaveBeenCalled();
  });
});

describe("reconnectRequestedSince (ADMIN_ROLE_IMPERSONATION.md)", () => {
  it("reconnectRequestedSince_switchAfterMark_isTrueForThatSessionOnly", () => {
    const mark = revocationMark();

    reconnectSessionStreams(1, "ici");

    expect(reconnectRequestedSince(1, "ici", mark)).toBe(true);
    expect(reconnectRequestedSince(1, "ailleurs", mark)).toBe(false);
    expect(reconnectRequestedSince(2, "ici", mark)).toBe(false);
  });

  it("reconnectRequestedSince_switchBeforeMark_isFalse", () => {
    reconnectSessionStreams(1, "ici");
    const mark = revocationMark();

    expect(reconnectRequestedSince(1, "ici", mark)).toBe(false);
  });

  it("reconnectRequestedSince_nullHashSwitch_matchesAnySessionOfTheAccount", () => {
    const mark = revocationMark();

    reconnectSessionStreams(1, null);

    expect(reconnectRequestedSince(1, "", mark)).toBe(true);
    expect(reconnectRequestedSince(1, "cookie", mark)).toBe(true);
  });

  it("reconnectRequestedSince_revocation_isNotAReconnect", () => {
    const mark = revocationMark();

    closeUserStreams(1);

    expect(reconnectRequestedSince(1, "ici", mark)).toBe(false);
  });
});

describe("mémoire des changements de contexte (perf)", () => {
  it("reconnectRequestedSince_otherAccountFloodsBeyondPerUserCap_pendingEntryOfFirstAccountKept", () => {
    const mark = revocationMark();
    reconnectSessionStreams(1, "premiere");
    for (let i = 0; i < RECONNECT_MEMORY_PER_USER * 2; i += 1) reconnectSessionStreams(2, `s${i}`);

    expect(reconnectRequestedSince(1, "premiere", mark)).toBe(true);
  });

  it("RECONNECT_MEMORY_PER_USER_coversTwoFullWindowsOfEveryToggle", () => {
    // Toute bascule (entrée ou retour) passe la règle large, à fenêtre fixe :
    // deux fenêtres jointives tiennent dans la minute de mémoire.
    expect(RECONNECT_MEMORY_PER_USER).toBeGreaterThanOrEqual(2 * PLAYER_VIEW_EXIT_RULE.limit);
    expect(RECONNECT_MEMORY_MAX).toBeGreaterThan(RECONNECT_MEMORY_PER_USER);
  });

  it("reconnectRequestedSince_fortyTogglesInAMinute_firstStillPending", () => {
    const mark = revocationMark();
    for (let i = 0; i < 40; i += 1) reconnectSessionStreams(2, `s${i}`);

    expect(reconnectRequestedSince(2, "s0", mark)).toBe(true);
  });

  it("reconnectRequestedSince_ownEntriesBeyondPerUserCap_oldestOwnForgottenNewestKept", () => {
    const mark = revocationMark();
    for (let i = 0; i <= RECONNECT_MEMORY_PER_USER; i += 1) reconnectSessionStreams(2, `s${i}`);

    expect(reconnectRequestedSince(2, "s0", mark)).toBe(false);
    expect(reconnectRequestedSince(2, `s${RECONNECT_MEMORY_PER_USER}`, mark)).toBe(true);
  });

  it("reconnectRequestedSince_globalBackstopExceeded_oldestDropped", () => {
    const mark = revocationMark();
    for (let user = 1; user <= RECONNECT_MEMORY_MAX + 1; user += 1) reconnectSessionStreams(user, "ici");

    expect(reconnectRequestedSince(1, "ici", mark)).toBe(false);
    expect(reconnectRequestedSince(RECONNECT_MEMORY_MAX + 1, "ici", mark)).toBe(true);
  });

  it("revokedSince_manyReconnectMarks_realRevocationStillFound", () => {
    const mark = revocationMark();
    closeSessionStreams("revoquee");
    for (let i = 0; i < RECONNECT_MEMORY_MAX * 2; i += 1) reconnectSessionStreams(2, `s${i}`);

    expect(revokedSince(1, "revoquee", mark)).toBe(true);
  });

  it("reconnectRequestedSince_afterMemoryDelay_isFalse", () => {
    jest.useFakeTimers();
    const mark = revocationMark();
    reconnectSessionStreams(1, "ici");

    jest.advanceTimersByTime(REVOCATION_MEMORY_MS + 1);

    expect(reconnectRequestedSince(1, "ici", mark)).toBe(false);
  });
});
