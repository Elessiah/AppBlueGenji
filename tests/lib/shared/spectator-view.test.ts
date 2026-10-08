import { describe, expect, it } from "@jest/globals";
import {
  jitteredDelayMs,
  memberTournamentPath,
  parsePollAfterMs,
  parseTournamentId,
  SPECTATOR_CACHE_TTL_MS,
  SPECTATOR_LOAD_THRESHOLDS,
  SPECTATOR_MAX_POLL_MS,
  SPECTATOR_MIN_POLL_MS,
  SPECTATOR_PRE_LAUNCH_POLL_MS,
  SPECTATOR_RUNNING_POLL_MS,
  SPECTATOR_VIEWER_CONTEXT,
  spectatorCacheTtlMs,
  spectatorLoadLevel,
  spectatorPollIntervalMs,
  spectatorRetryDelayMs,
  spectatorSnapshot,
  spectatorTournamentPath,
  tournamentIdFromMemberPath,
  type SpectatorLoadSignals,
} from "@/lib/shared/spectator-view";
import { REFRESH_CADENCE } from "@/lib/shared/refresh-tiers";
import { bracketMatch } from "../../helpers/bracket-match";
import { tournamentSnapshot } from "../../helpers/tournament-detail";

const calm: SpectatorLoadSignals = { eventLoopDelayMs: 5, openStreams: 10, spectatorReadsPerMinute: 30 };

describe("chemins de la fiche", () => {
  it("nomme la page sans compte et la fiche connectée, sans préfixe de langue", () => {
    expect(spectatorTournamentPath(12)).toBe("/suivre/tournois/12");
    expect(memberTournamentPath(12)).toBe("/tournois/12");
  });

  it("n'accepte qu'un entier strictement positif, comme la fiche connectée (`Number(params.id)`)", () => {
    expect(parseTournamentId("42")).toBe(42);
    // Même lecture que la fiche connectée : un lien qu'elle ouvre est redirigé pareil.
    expect(parseTournamentId("12.0")).toBe(12);
    expect(parseTournamentId("0")).toBeNull();
    expect(parseTournamentId("-3")).toBeNull();
    expect(parseTournamentId("4.2")).toBeNull();
    expect(parseTournamentId("../secrets")).toBeNull();
    expect(parseTournamentId("")).toBeNull();
    expect(parseTournamentId("9007199254740993")).toBeNull();
  });

  it("ne reconnaît que la fiche d'un tournoi dans l'espace connecté", () => {
    expect(tournamentIdFromMemberPath("/tournois/7")).toBe(7);
    expect(tournamentIdFromMemberPath("/tournois/7/")).toBe(7);
    expect(tournamentIdFromMemberPath("/tournois/7.0")).toBe(7);
    // Liste, création, édition : restent derrière la connexion.
    expect(tournamentIdFromMemberPath("/tournois")).toBeNull();
    expect(tournamentIdFromMemberPath("/tournois/creer")).toBeNull();
    expect(tournamentIdFromMemberPath("/tournois/7/modifier")).toBeNull();
    expect(tournamentIdFromMemberPath("/equipes/7")).toBeNull();
    expect(tournamentIdFromMemberPath(null)).toBeNull();
    expect(tournamentIdFromMemberPath(undefined)).toBeNull();
  });
});

describe("niveau de charge", () => {
  it("reste calme sous tous les seuils, et quand la boucle n'est pas encore mesurée", () => {
    expect(spectatorLoadLevel(calm)).toBe(0);
    expect(spectatorLoadLevel({ ...calm, eventLoopDelayMs: null })).toBe(0);
  });

  it("monte d'un cran à chaque seuil franchi, signal par signal", () => {
    const [l1, l2, l3] = SPECTATOR_LOAD_THRESHOLDS.eventLoopDelayMs;
    expect(spectatorLoadLevel({ ...calm, eventLoopDelayMs: l1 - 1 })).toBe(0);
    expect(spectatorLoadLevel({ ...calm, eventLoopDelayMs: l1 })).toBe(1);
    expect(spectatorLoadLevel({ ...calm, eventLoopDelayMs: l2 })).toBe(2);
    expect(spectatorLoadLevel({ ...calm, eventLoopDelayMs: l3 })).toBe(3);
    expect(spectatorLoadLevel({ ...calm, openStreams: SPECTATOR_LOAD_THRESHOLDS.openStreams[1] })).toBe(2);
    expect(
      spectatorLoadLevel({ ...calm, spectatorReadsPerMinute: SPECTATOR_LOAD_THRESHOLDS.spectatorReadsPerMinute[2] }),
    ).toBe(3);
  });

  it("retient le plus haut des signaux : un seul suffit à ralentir", () => {
    expect(
      spectatorLoadLevel({
        eventLoopDelayMs: SPECTATOR_LOAD_THRESHOLDS.eventLoopDelayMs[0],
        openStreams: SPECTATOR_LOAD_THRESHOLDS.openStreams[2],
        spectatorReadsPerMinute: 0,
      }),
    ).toBe(3);
  });

  it("ignore une mesure aberrante plutôt que de s'y fier", () => {
    expect(spectatorLoadLevel({ ...calm, eventLoopDelayMs: Number.NaN })).toBe(0);
  });
});

describe("cadence de relecture", () => {
  it("passe toujours après le palier spectateur connecté", () => {
    expect(SPECTATOR_RUNNING_POLL_MS).toBeGreaterThan(REFRESH_CADENCE.STANDARD.pushCoalesceMs);
  });

  it("suit l'état du tournoi au calme", () => {
    expect(spectatorPollIntervalMs("RUNNING", 0)).toBe(SPECTATOR_RUNNING_POLL_MS);
    expect(spectatorPollIntervalMs("REGISTRATION", 0)).toBe(SPECTATOR_PRE_LAUNCH_POLL_MS);
    expect(spectatorPollIntervalMs("UPCOMING", 0)).toBe(SPECTATOR_PRE_LAUNCH_POLL_MS);
  });

  it("relit un tournoi terminé au plafond : le staff peut encore le rouvrir", () => {
    expect(spectatorPollIntervalMs("FINISHED", 0)).toBe(SPECTATOR_MAX_POLL_MS);
    expect(spectatorPollIntervalMs("FINISHED", 3)).toBe(SPECTATOR_MAX_POLL_MS);
  });

  it("s'allonge avec la charge, sans dépasser le plafond", () => {
    expect(spectatorPollIntervalMs("RUNNING", 1)).toBe(2 * SPECTATOR_RUNNING_POLL_MS);
    expect(spectatorPollIntervalMs("RUNNING", 2)).toBe(4 * SPECTATOR_RUNNING_POLL_MS);
    expect(spectatorPollIntervalMs("RUNNING", 3)).toBe(10 * SPECTATOR_RUNNING_POLL_MS);
    expect(spectatorPollIntervalMs("REGISTRATION", 3)).toBe(SPECTATOR_MAX_POLL_MS);
  });

  it("allonge aussi la durée de vie de la réponse partagée", () => {
    expect(spectatorCacheTtlMs(0)).toBe(SPECTATOR_CACHE_TTL_MS);
    expect(spectatorCacheTtlMs(3)).toBe(10 * SPECTATOR_CACHE_TTL_MS);
    // Une réponse ne vit jamais plus longtemps que l'attente d'un visiteur au calme ne le justifie.
    expect(spectatorCacheTtlMs(0)).toBeLessThan(SPECTATOR_RUNNING_POLL_MS);
  });
});

describe("relecture côté client", () => {
  it("lit l'intervalle accordé, borné des deux côtés", () => {
    expect(parsePollAfterMs("30000")).toBe(30_000);
    expect(parsePollAfterMs("0")).toBe(SPECTATOR_MIN_POLL_MS);
    expect(parsePollAfterMs("-5")).toBe(SPECTATOR_MIN_POLL_MS);
    expect(parsePollAfterMs("99999999")).toBe(SPECTATOR_MAX_POLL_MS);
  });

  it("retombe sur la cadence de base devant un en-tête absent ou illisible", () => {
    expect(parsePollAfterMs(null)).toBe(SPECTATOR_RUNNING_POLL_MS);
    expect(parsePollAfterMs("bientôt")).toBe(SPECTATOR_RUNNING_POLL_MS);
  });

  it("recule après un échec : Retry-After d'abord, sinon le double de la dernière attente", () => {
    expect(spectatorRetryDelayMs(30_000, "120")).toBe(120_000);
    expect(spectatorRetryDelayMs(30_000, null)).toBe(60_000);
    expect(spectatorRetryDelayMs(60_000, null)).toBe(120_000);
    expect(spectatorRetryDelayMs(30_000, "n'importe")).toBe(60_000);
    expect(spectatorRetryDelayMs(500_000, null)).toBe(SPECTATOR_MAX_POLL_MS);
  });

  it("étale les relectures de ±10 %", () => {
    expect(jitteredDelayMs(30_000, () => 0)).toBe(27_000);
    expect(jitteredDelayMs(30_000, () => 0.5)).toBe(30_000);
    expect(jitteredDelayMs(30_000, () => 1)).toBe(33_000);
  });
});

describe("ce que lit le visiteur sans compte", () => {
  const maps = [
    { mapNumber: 1, replayCode: "ABC123", team1Score: 2, team2Score: 1 },
    { mapNumber: 2, replayCode: "", team1Score: 0, team2Score: 2 },
  ];
  const report = { team1Score: 1, team2Score: 0, reportedAt: "2026-10-01T10:00:00.000Z", maps };

  it("retire les codes de replay, réservés aux membres connectés", () => {
    const snapshot = tournamentSnapshot({
      matches: [bracketMatch({ id: 1, maps, team1Report: report, team2Report: null })],
    });
    const out = spectatorSnapshot(snapshot);
    expect(out.matches[0].maps.map((map) => map.replayCode)).toEqual(["", ""]);
    // Les scores restent : c'est le résultat du match.
    expect(out.matches[0].maps.map((map) => [map.team1Score, map.team2Score])).toEqual([[2, 1], [0, 2]]);
    expect(out.matches[0].team1Report?.maps).toEqual([]);
    expect(out.matches[0].team2Report).toBeNull();
    expect(JSON.stringify(out)).not.toContain("ABC123");
  });

  it("retire les identifiants de comptes : la page n'affiche que des noms", () => {
    const snapshot = tournamentSnapshot({
      soloUserIds: { 4: 9 },
      matches: [bracketMatch({ id: 1, casterUserId: 33, casterPseudo: "Caster" })],
    });
    const out = spectatorSnapshot(snapshot);
    expect(out.soloUserIds).toEqual({});
    expect(out.matches[0].casterUserId).toBeNull();
    // Le pseudo du caster reste : il est à l'antenne.
    expect(out.matches[0].casterPseudo).toBe("Caster");
  });

  it("ne touche pas l'instantané partagé avec les membres", () => {
    const snapshot = tournamentSnapshot({ matches: [bracketMatch({ maps })] });
    spectatorSnapshot(snapshot);
    expect(snapshot.matches[0].maps[0].replayCode).toBe("ABC123");
  });

  it("garde la version, qui sert d'empreinte à la relecture", () => {
    expect(spectatorSnapshot(tournamentSnapshot({ version: "v9" })).version).toBe("v9");
  });

  it("ne donne aucun droit au lecteur", () => {
    expect(SPECTATOR_VIEWER_CONTEXT).toMatchObject({
      preview: null,
      canRegister: false,
      canRegisterEntrant: false,
      registrationBlock: null,
      myTeamId: null,
      canCreateReportsForTeamIds: [],
      isAdmin: false,
      canDelete: false,
      canCancelForfeit: false,
      canManageLive: false,
      castBlock: "NOT_CASTER",
      matchProposals: [],
    });
    // Aucun compte ne porte l'identifiant 0 : personne n'est reconnu caster.
    expect(SPECTATOR_VIEWER_CONTEXT.viewerUserId).toBe(0);
    expect(Object.isFrozen(SPECTATOR_VIEWER_CONTEXT)).toBe(true);
  });
});
