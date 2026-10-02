import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  createLiveRenderGate,
  createQuietStream,
} from "@/app/(secured)/tournois/[id]/_lib/live-render-gate";
import type { LiveState } from "@/app/(secured)/tournois/[id]/_lib/live-state";
import type { TournamentDetail } from "@/lib/shared/types";
import { tournamentDetail } from "../helpers/tournament-detail";

/**
 * Régime de charge du suivi en direct (`_lib/live-render-gate.ts`,
 * `docs/features/CLIENT_POWER_MODES.md`) : ce qui est reçu n'est rendu que si
 * quelqu'un peut le voir, et un onglet caché hors match passe le flux au
 * palier spectateur.
 */

const detail: TournamentDetail = tournamentDetail();
const filled: LiveState = { detail, tier: "STANDARD" };

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

/** Porte dont le rendu publie `filled`, comme le hook publie l'état reçu. */
function gate() {
  const render = jest.fn<() => LiveState>(() => filled);
  return { gate: createLiveRenderGate(render), render };
}

/** Porte qui a déjà rendu une page remplie. */
function warmGate() {
  const harness = gate();
  harness.gate.flush();
  harness.render.mockClear();
  return harness;
}

describe("rendu d'un état reçu", () => {
  it("rend tout de suite quand la page est regardée", () => {
    const { gate: g, render } = warmGate();
    g.received(0, detail, detail);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("regroupe pour un joueur qui regarde son jeu, en un seul rendu", () => {
    const { gate: g, render } = warmGate();
    g.received(5_000, detail, { ...detail });
    g.received(5_000, detail, { ...detail });
    jest.advanceTimersByTime(4_999);
    expect(render).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("ne fait jamais patienter une page encore vide", () => {
    const { gate: g, render } = gate();
    g.received(5_000, detail, detail);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("ne regroupe pas un premier détail", () => {
    const { gate: g, render } = warmGate();
    g.received(5_000, null, detail);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("n'affiche rien onglet caché, puis rend au retour", () => {
    const { gate: g, render } = warmGate();
    g.received(null, detail, detail);
    jest.advanceTimersByTime(600_000);
    expect(render).not.toHaveBeenCalled();
    g.policyChanged(0);
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("changement de régime", () => {
  it("ne rend rien quand rien n'attend", () => {
    const { gate: g, render } = warmGate();
    g.policyChanged(0);
    expect(render).not.toHaveBeenCalled();
  });

  it("désarme le regroupement quand l'onglet passe en veille, sans perdre le rendu dû", () => {
    const { gate: g, render } = warmGate();
    g.received(5_000, detail, { ...detail });
    g.policyChanged(null);
    jest.advanceTimersByTime(60_000);
    expect(render).not.toHaveBeenCalled();
    g.policyChanged(5_000);
    jest.advanceTimersByTime(5_000);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("rend aussitôt une page vide qui redevient visible, même en match", () => {
    const { gate: g, render } = gate();
    g.received(null, null, detail);
    g.policyChanged(5_000);
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("remise à zéro et démontage", () => {
  it("oublie le rendu dû et la page rendue en changeant de tournoi", () => {
    const { gate: g, render } = warmGate();
    g.received(5_000, detail, { ...detail });
    g.reset();
    jest.advanceTimersByTime(60_000);
    expect(render).not.toHaveBeenCalled();
    // Rien n'est plus rendu : le prochain état passe sans attendre.
    g.received(5_000, detail, { ...detail });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("ne laisse aucun minuteur au démontage", () => {
    const { gate: g, render } = warmGate();
    g.received(5_000, detail, { ...detail });
    g.dispose();
    jest.advanceTimersByTime(60_000);
    expect(render).not.toHaveBeenCalled();
  });
});

describe("palier spectateur", () => {
  it("se déclasse après le délai du régime, et se reclasse au retour", () => {
    const reconnect = jest.fn();
    const quiet = createQuietStream(reconnect);
    quiet.policyChanged(null, 60_000);
    jest.advanceTimersByTime(59_999);
    expect(quiet.isQuiet()).toBe(false);
    jest.advanceTimersByTime(1);
    expect(quiet.isQuiet()).toBe(true);
    expect(reconnect).toHaveBeenCalledTimes(1);

    quiet.policyChanged(60_000, null);
    expect(quiet.isQuiet()).toBe(false);
    expect(reconnect).toHaveBeenCalledTimes(2);
  });

  it("ne rouvre rien au retour d'un onglet qui n'a pas eu le temps de se déclasser", () => {
    const reconnect = jest.fn();
    const quiet = createQuietStream(reconnect);
    quiet.policyChanged(null, 60_000);
    quiet.policyChanged(60_000, null);
    jest.advanceTimersByTime(120_000);
    expect(reconnect).not.toHaveBeenCalled();
    expect(quiet.isQuiet()).toBe(false);
  });

  it("ignore un régime dont le seuil ne change pas", () => {
    const reconnect = jest.fn();
    const quiet = createQuietStream(reconnect);
    quiet.policyChanged(null, 60_000);
    jest.advanceTimersByTime(30_000);
    quiet.policyChanged(60_000, 60_000);
    jest.advanceTimersByTime(30_000);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("repart au palier normal sur un autre tournoi, et rien ne survit au démontage", () => {
    const reconnect = jest.fn();
    const quiet = createQuietStream(reconnect);
    quiet.policyChanged(null, 1_000);
    jest.advanceTimersByTime(1_000);
    quiet.reset();
    expect(quiet.isQuiet()).toBe(false);

    quiet.policyChanged(1_000, 2_000);
    quiet.dispose();
    jest.advanceTimersByTime(10_000);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });
});
