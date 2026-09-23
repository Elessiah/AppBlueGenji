import { describe, expect, it } from "@jest/globals";
import {
  activeMatchFocusUntil,
  isSlowFrameInterval,
  LOW_CORES_MAX,
  LOW_MEMORY_GB_MAX,
  MATCH_BACKGROUND_RENDER_DELAY_MS,
  MATCH_FOCUS_LEAD_MS,
  medianFrameInterval,
  nextViewerMatchFocusChangeAt,
  parseMatchFocusLeases,
  performanceLimits,
  powerModeAttribute,
  powerModeDescription,
  powerModeLabel,
  powerPolicy,
  powerReasonLabel,
  powerReasons,
  pruneMatchFocusLeases,
  QUIET_STREAM_AFTER_MS,
  RECOVERED_FRAME_INTERVAL_MS,
  resolvePowerMode,
  showsPowerBadge,
  SLOW_FRAME_INTERVAL_MS,
  UNKNOWN_PROBE,
  updateMatchFocusLease,
  viewerMatchFocus,
  type ClientPowerInput,
  type ClientPowerMode,
  type MatchFocusDetail,
  type PageAttention,
  type PowerReason,
} from "@/lib/shared/client-power";

const input = (overrides: Partial<ClientPowerInput> = {}): ClientPowerInput => ({
  attention: "FOCUSED",
  matchFocus: false,
  ...overrides,
});

describe("resolvePowerMode — le régime", () => {
  it("tourne à plein quand la page est regardée, sans match ni limite", () => {
    expect(resolvePowerMode(input())).toBe("FULL");
  });

  it("passe en éco sur un second écran", () => {
    expect(resolvePowerMode(input({ attention: "BACKGROUND" }))).toBe("ECO");
  });

  it("passe en éco sur une machine à la peine, même regardée", () => {
    expect(resolvePowerMode(input({ performanceLimited: true }))).toBe("ECO");
  });

  it("passe en éco quand le système demande de réduire les animations", () => {
    expect(resolvePowerMode(input({ reducedMotion: true }))).toBe("ECO");
  });

  it("passe en match, que la page ait le focus ou non", () => {
    expect(resolvePowerMode(input({ matchFocus: true }))).toBe("MATCH");
    expect(resolvePowerMode(input({ matchFocus: true, attention: "BACKGROUND" }))).toBe("MATCH");
    // Le match l'emporte sur les limites de la machine : il retire davantage.
    expect(resolvePowerMode(input({ matchFocus: true, performanceLimited: true }))).toBe("MATCH");
  });

  it("dort dès que l'onglet est caché, match ou pas", () => {
    expect(resolvePowerMode(input({ attention: "HIDDEN" }))).toBe("SLEEP");
    expect(resolvePowerMode(input({ attention: "HIDDEN", matchFocus: true }))).toBe("SLEEP");
  });
});

describe("powerPolicy — ce que chaque régime autorise", () => {
  it("anime tout en régime complet", () => {
    expect(powerPolicy(input())).toEqual({
      mode: "FULL",
      decorativeMotion: true,
      canvas: "ANIMATE",
      snapshotRenderDelayMs: 0,
      clocks: true,
      quietStreamAfterMs: null,
    });
  });

  it("fige les décorations en éco mais rend toute donnée sans attendre", () => {
    // Sur un second écran, c'est justement là qu'on guette le début de son match.
    const policy = powerPolicy(input({ attention: "BACKGROUND" }));
    expect(policy.decorativeMotion).toBe(false);
    expect(policy.canvas).toBe("STILL");
    expect(policy.snapshotRenderDelayMs).toBe(0);
    expect(policy.clocks).toBe(true);
    expect(policy.quietStreamAfterMs).toBeNull();
  });

  it("rend la mémoire du fond en match", () => {
    expect(powerPolicy(input({ matchFocus: true })).canvas).toBe("RELEASE");
  });

  it("rend tout de suite à un joueur en match qui regarde la page", () => {
    // Il vient rapporter son score : il doit voir ce qu'il fait.
    expect(powerPolicy(input({ matchFocus: true })).snapshotRenderDelayMs).toBe(0);
  });

  it("regroupe les rendus d'un joueur en match qui regarde son jeu", () => {
    expect(
      powerPolicy(input({ matchFocus: true, attention: "BACKGROUND" })).snapshotRenderDelayMs,
    ).toBe(MATCH_BACKGROUND_RENDER_DELAY_MS);
  });

  it("ne rend rien onglet caché, et coupe les horloges", () => {
    const policy = powerPolicy(input({ attention: "HIDDEN" }));
    expect(policy.snapshotRenderDelayMs).toBeNull();
    expect(policy.clocks).toBe(false);
    expect(policy.canvas).toBe("RELEASE");
  });

  it("descend au palier spectateur onglet caché hors match seulement", () => {
    expect(powerPolicy(input({ attention: "HIDDEN" })).quietStreamAfterMs).toBe(QUIET_STREAM_AFTER_MS);
    // En match, « score à confirmer » doit sonner à la seconde.
    expect(powerPolicy(input({ attention: "HIDDEN", matchFocus: true })).quietStreamAfterMs).toBeNull();
  });

  it("ne déclasse jamais le flux d'une page visible", () => {
    const visible: PageAttention[] = ["FOCUSED", "BACKGROUND"];
    for (const attention of visible) {
      for (const matchFocus of [true, false]) {
        expect(powerPolicy(input({ attention, matchFocus })).quietStreamAfterMs).toBeNull();
      }
    }
  });

  it("n'anime rien hors du régime complet", () => {
    const modes: ClientPowerInput[] = [
      input({ attention: "BACKGROUND" }),
      input({ matchFocus: true }),
      input({ attention: "HIDDEN" }),
      input({ performanceLimited: true }),
      input({ reducedMotion: true }),
    ];
    for (const situation of modes) {
      const policy = powerPolicy(situation);
      expect(policy.decorativeMotion).toBe(false);
      expect(policy.canvas).not.toBe("ANIMATE");
    }
  });

  it("nomme le régime en minuscules pour l'attribut de `<html>`", () => {
    expect(powerModeAttribute("MATCH")).toBe("match");
    expect(powerModeAttribute("FULL")).toBe("full");
  });
});

// ---------------------------------------------------------------------------

type M = MatchFocusDetail["matches"][number];

const match = (overrides: Partial<M> = {}): M => ({
  status: "READY",
  team1Id: 1,
  team2Id: 2,
  startAt: null,
  ...overrides,
});

const detail = (matches: M[], overrides: Partial<MatchFocusDetail> = {}): MatchFocusDetail => ({
  card: { state: "RUNNING" },
  myTeamId: 1,
  matches,
  ...overrides,
});

const NOW = Date.parse("2026-09-23T20:00:00Z");

describe("viewerMatchFocus — le lecteur a-t-il un match en cours ?", () => {
  it("oui dès qu'une rencontre à lui est prête, sans horaire", () => {
    expect(viewerMatchFocus(detail([match()]), NOW)).toBe(true);
  });

  it("oui jusqu'au résultat, confirmation comprise", () => {
    expect(viewerMatchFocus(detail([match({ status: "AWAITING_CONFIRMATION" })]), NOW)).toBe(true);
    expect(viewerMatchFocus(detail([match({ status: "COMPLETED" })]), NOW)).toBe(false);
  });

  it("non tant que l'adversaire n'est pas connu, ni sur une exemption", () => {
    expect(viewerMatchFocus(detail([match({ status: "PENDING", team2Id: null })]), NOW)).toBe(false);
    expect(viewerMatchFocus(detail([match({ team2Id: null })]), NOW)).toBe(false);
  });

  it("non pour les rencontres des autres", () => {
    expect(viewerMatchFocus(detail([match({ team1Id: 3, team2Id: 4 })]), NOW)).toBe(false);
  });

  it("non pour un spectateur ou un arbitre", () => {
    expect(viewerMatchFocus(detail([match()], { myTeamId: null }), NOW)).toBe(false);
  });

  it("non hors d'un tournoi en cours", () => {
    expect(viewerMatchFocus(detail([match()], { card: { state: "FINISHED" } }), NOW)).toBe(false);
    expect(viewerMatchFocus(null, NOW)).toBe(false);
  });

  it("part dix minutes avant l'horaire annoncé", () => {
    const soon = new Date(NOW + MATCH_FOCUS_LEAD_MS).toISOString();
    const later = new Date(NOW + MATCH_FOCUS_LEAD_MS + 1).toISOString();
    expect(viewerMatchFocus(detail([match({ startAt: soon })]), NOW)).toBe(true);
    expect(viewerMatchFocus(detail([match({ startAt: later })]), NOW)).toBe(false);
  });

  it("traite un horaire illisible comme absent", () => {
    expect(viewerMatchFocus(detail([match({ startAt: "demain soir" })]), NOW)).toBe(true);
  });
});

describe("nextViewerMatchFocusChangeAt — la bascule sans instantané", () => {
  it("donne l'approche du plus proche horaire à venir", () => {
    const inOneHour = NOW + 3_600_000;
    const inTwoHours = NOW + 7_200_000;
    const at = nextViewerMatchFocusChangeAt(
      detail([
        match({ startAt: new Date(inTwoHours).toISOString() }),
        match({ startAt: new Date(inOneHour).toISOString() }),
      ]),
      NOW,
    );
    expect(at).toBe(inOneHour - MATCH_FOCUS_LEAD_MS);
  });

  it("rien quand tout est déjà en cours ou sans horaire", () => {
    expect(nextViewerMatchFocusChangeAt(detail([match()]), NOW)).toBeNull();
    expect(nextViewerMatchFocusChangeAt(null, NOW)).toBeNull();
  });
});

describe("baux inter-onglets", () => {
  it("lit une valeur stockée en ignorant ce qui n'est pas un bail", () => {
    expect(parseMatchFocusLeases(JSON.stringify({ a: 10, b: "x", c: null, d: 20 }))).toEqual({ a: 10, d: 20 });
    expect(parseMatchFocusLeases("pas du json")).toEqual({});
    expect(parseMatchFocusLeases("[1,2]")).toEqual({});
    expect(parseMatchFocusLeases(null)).toEqual({});
  });

  it("pose, renouvelle et rend le bail d'un onglet sans toucher aux autres", () => {
    let leases = updateMatchFocusLease({}, "a", 100, 0);
    leases = updateMatchFocusLease(leases, "b", 200, 0);
    expect(leases).toEqual({ a: 100, b: 200 });
    leases = updateMatchFocusLease(leases, "a", null, 0);
    expect(leases).toEqual({ b: 200 });
  });

  it("purge les baux échus à chaque écriture", () => {
    expect(updateMatchFocusLease({ vieux: 5, b: 200 }, "a", 100, 10)).toEqual({ b: 200, a: 100 });
    expect(pruneMatchFocusLeases({ a: 10, b: 11 }, 10)).toEqual({ b: 11 });
  });

  it("reste en match tant qu'un onglet tient un bail valide", () => {
    expect(activeMatchFocusUntil({ a: 100, b: 300 }, 50)).toBe(300);
    expect(activeMatchFocusUntil({ a: 100 }, 100)).toBeNull();
    expect(activeMatchFocusUntil({}, 0)).toBeNull();
  });
});

describe("performances limitées", () => {
  const frames = (interval: number, count = 91) => Array.from({ length: count }, (_, i) => i * interval);

  it("mesure l'intervalle médian, insensible à une image longue", () => {
    const stamps = frames(16.7);
    stamps.push(stamps[stamps.length - 1] + 500); // une hydratation
    expect(medianFrameInterval(stamps)).toBeCloseTo(16.7, 5);
  });

  it("ne conclut pas sur trop peu d'images", () => {
    expect(medianFrameInterval(frames(16, 10))).toBeNull();
    expect(medianFrameInterval(frames(16, 11))).toBeCloseTo(16, 5);
    expect(medianFrameInterval([])).toBeNull();
  });

  it("écarte les horodatages incohérents", () => {
    expect(medianFrameInterval([0, 0, 0, ...frames(20, 12).map((t) => t + 1)])).toBeCloseTo(20, 5);
  });

  it("repère un affichage bridé à 30 images/s, pas un écran à 60 Hz", () => {
    expect(isSlowFrameInterval(1000 / 30, false)).toBe(true);
    expect(isSlowFrameInterval(1000 / 60, false)).toBe(false);
    expect(isSlowFrameInterval(SLOW_FRAME_INTERVAL_MS, false)).toBe(false);
  });

  it("ne ressort du ralenti qu'une fois nettement revenu (hystérésis)", () => {
    // Entre les deux seuils, l'état précédent tient : pas de va-et-vient.
    const between = (SLOW_FRAME_INTERVAL_MS + RECOVERED_FRAME_INTERVAL_MS) / 2;
    expect(isSlowFrameInterval(between, true)).toBe(true);
    expect(isSlowFrameInterval(between, false)).toBe(false);
    expect(isSlowFrameInterval(RECOVERED_FRAME_INTERVAL_MS - 1, true)).toBe(false);
  });

  it("garde l'état précédent tant qu'aucune mesure n'est venue", () => {
    expect(isSlowFrameInterval(null, true)).toBe(true);
    expect(isSlowFrameInterval(null, false)).toBe(false);
  });

  it("nomme les limites de la machine", () => {
    expect(performanceLimits({ cores: LOW_CORES_MAX, memoryGb: 8, frameIntervalMs: 16 }, false)).toEqual([
      "LOW_CORES",
    ]);
    expect(performanceLimits({ cores: 8, memoryGb: LOW_MEMORY_GB_MAX, frameIntervalMs: null }, false)).toEqual([
      "LOW_MEMORY",
    ]);
    expect(performanceLimits({ cores: 8, memoryGb: 8, frameIntervalMs: 40 }, true)).toEqual(["SLOW_FRAMES"]);
    expect(performanceLimits({ cores: 16, memoryGb: 8, frameIntervalMs: 7 }, false)).toEqual([]);
  });

  it("ne suppose rien de ce que le navigateur ne dit pas", () => {
    expect(performanceLimits(UNKNOWN_PROBE, false)).toEqual([]);
    expect(performanceLimits({ cores: 0, memoryGb: 0, frameIntervalMs: null }, false)).toEqual([]);
  });
});

describe("témoin", () => {
  it("ne s'affiche que quand la page retire quelque chose et qu'on peut le voir", () => {
    const expected: Record<ClientPowerMode, boolean> = { FULL: false, ECO: true, MATCH: true, SLEEP: false };
    for (const [mode, shown] of Object.entries(expected)) {
      expect(showsPowerBadge(mode as ClientPowerMode, ["LOW_CORES"])).toBe(shown);
    }
  });

  it("se tait quand la seule raison est l'absence de focus", () => {
    // Le cliquer rendrait le focus, donc le régime complet : il disparaîtrait
    // sous le pointeur.
    expect(showsPowerBadge("ECO", ["BACKGROUND"])).toBe(false);
    expect(showsPowerBadge("ECO", [])).toBe(false);
    expect(showsPowerBadge("ECO", ["BACKGROUND", "SLOW_FRAMES"])).toBe(true);
    expect(showsPowerBadge("ECO", ["REDUCED_MOTION"])).toBe(true);
    expect(showsPowerBadge("MATCH", ["MATCH", "BACKGROUND"])).toBe(true);
  });

  it("dit pourquoi, dans l'ordre où cela décide", () => {
    expect(
      powerReasons(input({ attention: "BACKGROUND", matchFocus: true, performanceLimited: true }), [
        "LOW_CORES",
        "SLOW_FRAMES",
      ]),
    ).toEqual(["MATCH", "BACKGROUND", "LOW_CORES", "SLOW_FRAMES"]);
  });

  it("tait les limites quand la détection est ignorée", () => {
    expect(powerReasons(input({ attention: "BACKGROUND", performanceLimited: false }), ["LOW_CORES"])).toEqual([
      "BACKGROUND",
    ]);
  });

  it("annonce le mouvement réduit demandé par le système", () => {
    expect(powerReasons(input({ reducedMotion: true }), [])).toEqual(["REDUCED_MOTION"]);
  });

  it("donne la cadence mesurée en images par seconde", () => {
    const probe = { cores: 2, memoryGb: 2, frameIntervalMs: 33.3 };
    expect(powerReasonLabel("SLOW_FRAMES", probe)).toContain("≈ 30 images/s");
    expect(powerReasonLabel("LOW_CORES", probe)).toBe("Processeur modeste (2 cœurs)");
    expect(powerReasonLabel("LOW_CORES", { ...probe, cores: 1 })).toBe("Processeur modeste (1 cœur)");
    expect(powerReasonLabel("LOW_MEMORY", probe)).toBe("Mémoire modeste (2 Go)");
    expect(powerReasonLabel("SLOW_FRAMES", UNKNOWN_PROBE)).toBe("Affichage ralenti");
  });

  it("a un libellé et une phrase pour chaque raison et chaque régime", () => {
    const reasons: PowerReason[] = [
      "HIDDEN",
      "MATCH",
      "BACKGROUND",
      "REDUCED_MOTION",
      "LOW_CORES",
      "LOW_MEMORY",
      "SLOW_FRAMES",
    ];
    for (const reason of reasons) expect(powerReasonLabel(reason, UNKNOWN_PROBE)).not.toBe("");
    const modes: ClientPowerMode[] = ["FULL", "ECO", "MATCH", "SLEEP"];
    for (const mode of modes) {
      expect(powerModeLabel(mode)).not.toBe("");
      expect(powerModeDescription(mode)).not.toBe("");
    }
    expect(powerModeLabel("ECO")).toBe("Éco");
  });
});
