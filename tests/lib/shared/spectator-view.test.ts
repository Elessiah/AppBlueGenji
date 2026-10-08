import { describe, expect, it } from "@jest/globals";
import {
  forwardedSearch,
  jitteredDelayMs,
  joinHrefFor,
  spectatorUnavailableRetryMs,
  withRedirectAnchor,
  memberTournamentPath,
  parsePollAfterMs,
  parseTournamentId,
  SPECTATOR_CACHE_TTL_MS,
  SPECTATOR_HIDDEN_USER_ID,
  SPECTATOR_LOAD_THRESHOLDS,
  SPECTATOR_MAX_POLL_MS,
  SPECTATOR_MIN_POLL_MS,
  SPECTATOR_NOT_FOUND_RECHECK_MINUTES,
  SPECTATOR_NOT_FOUND_RETRY_MS,
  SPECTATOR_PRE_LAUNCH_POLL_MS,
  SPECTATOR_RUNNING_POLL_MS,
  SPECTATOR_VIEWER_CONTEXT,
  spectatorCacheTtlMs,
  spectatorFreshnessMs,
  spectatorLoadLevel,
  spectatorPollIntervalMs,
  spectatorRetryDelayMs,
  spectatorSnapshot,
  spectatorTournamentPath,
  tournamentIdFromMemberPath,
  tournamentIdFromSpectatorPath,
  type SpectatorLoadSignals,
} from "@/lib/shared/spectator-view";
import { REFRESH_CADENCE } from "@/lib/shared/refresh-tiers";
import type { MatchMapResult } from "@/lib/shared/match-maps";
import type {
  BracketMatch,
  EnduranceMeta,
  EndurancePenaltyRow,
  MatchScoreReport,
  TournamentSnapshot,
} from "@/lib/shared/types";
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
    expect(tournamentIdFromMemberPath("/tournois/")).toBeNull();
    expect(tournamentIdFromMemberPath("/tournois/7//")).toBeNull();
    expect(tournamentIdFromMemberPath("/xtournois/7")).toBeNull();
    // Liste, création, édition : restent derrière la connexion.
    expect(tournamentIdFromMemberPath("/tournois")).toBeNull();
    expect(tournamentIdFromMemberPath("/tournois/creer")).toBeNull();
    expect(tournamentIdFromMemberPath("/tournois/7/modifier")).toBeNull();
    expect(tournamentIdFromMemberPath("/equipes/7")).toBeNull();
    expect(tournamentIdFromMemberPath(null)).toBeNull();
    expect(tournamentIdFromMemberPath(undefined)).toBeNull();
  });
});

describe("retour vers l'espace connecté", () => {
  it("reconnaît la page sans compte d'un tournoi, et elle seule", () => {
    expect(tournamentIdFromSpectatorPath("/suivre/tournois/12")).toBe(12);
    expect(tournamentIdFromSpectatorPath("/suivre/tournois/12/")).toBe(12);
    expect(tournamentIdFromSpectatorPath("/tournois/12")).toBeNull();
    expect(tournamentIdFromSpectatorPath("/suivre/tournois/abc")).toBeNull();
    expect(tournamentIdFromSpectatorPath(null)).toBeNull();
  });

  it("fait ramener « Rejoindre » à la fiche connectée depuis la page sans compte", () => {
    expect(joinHrefFor("/suivre/tournois/12")).toBe("/connexion?redirect=%2Ftournois%2F12");
  });

  it("fait suivre la requête, jamais un fragment de chemin", () => {
    expect(joinHrefFor("/suivre/tournois/12", "?utm=x")).toBe("/connexion?redirect=%2Ftournois%2F12%3Futm%3Dx");
    expect(joinHrefFor("/suivre/tournois/12", "//evil.test")).toBe("/connexion?redirect=%2Ftournois%2F12");
  });

  it("ajoute l'ancre du match à la destination, côté navigateur", () => {
    const href = joinHrefFor("/suivre/tournois/12");
    expect(withRedirectAnchor(href, "#match-5")).toBe("/connexion?redirect=%2Ftournois%2F12%23match-5");
    expect(withRedirectAnchor(href, "")).toBe(href);
    expect(withRedirectAnchor(href, "#")).toBe(href);
    // Hors page sans compte, la connexion seule ne prend pas d'ancre.
    expect(withRedirectAnchor("/connexion", "#match-5")).toBe("/connexion");
  });

  it("garde la page de connexion seule partout ailleurs", () => {
    expect(joinHrefFor("/")).toBe("/connexion");
    expect(joinHrefFor("/classement")).toBe("/connexion");
    expect(joinHrefFor(null)).toBe("/connexion");
  });
});

describe("attente après une base injoignable", () => {
  it("double la cadence d'un tournoi en cours, au niveau de charge du moment", () => {
    expect(spectatorUnavailableRetryMs(0)).toBe(2 * SPECTATOR_RUNNING_POLL_MS);
    expect(spectatorUnavailableRetryMs(1)).toBe(4 * SPECTATOR_RUNNING_POLL_MS);
    expect(spectatorUnavailableRetryMs(3)).toBe(SPECTATOR_MAX_POLL_MS);
  });
});

describe("requête qui suit une redirection", () => {
  it("reprend une requête", () => {
    expect(forwardedSearch("?utm_source=discord")).toBe("?utm_source=discord");
  });

  it("ignore tout ce qui n'en est pas une", () => {
    expect(forwardedSearch("//evil.test")).toBe("");
    expect(forwardedSearch("")).toBe("");
    expect(forwardedSearch(null)).toBe("");
    expect(forwardedSearch(undefined)).toBe("");
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

  it("annonce un âge maximal qui compte la gigue et le cache partagé", () => {
    expect(spectatorFreshnessMs(30_000, SPECTATOR_CACHE_TTL_MS)).toBe(33_000 + SPECTATOR_CACHE_TTL_MS);
    // La durée de vie est celle de la réponse servie, reçue peut-être sous une charge plus forte.
    expect(spectatorFreshnessMs(30_000, spectatorCacheTtlMs(3))).toBe(33_000 + 10 * SPECTATOR_CACHE_TTL_MS);
  });

  it("allonge aussi la durée de vie de la réponse partagée", () => {
    expect(spectatorCacheTtlMs(0)).toBe(SPECTATOR_CACHE_TTL_MS);
    expect(spectatorCacheTtlMs(3)).toBe(10 * SPECTATOR_CACHE_TTL_MS);
    // Une réponse ne vit jamais plus longtemps que l'attente d'un visiteur au calme ne le justifie.
    expect(spectatorCacheTtlMs(0)).toBeLessThan(SPECTATOR_RUNNING_POLL_MS);
  });
});

describe("tournoi introuvable", () => {
  it("est relu au plafond, et l'attente annoncée couvre la gigue", () => {
    expect(SPECTATOR_NOT_FOUND_RETRY_MS).toBe(SPECTATOR_MAX_POLL_MS);
    // 10 min + 10 % de gigue au plus : la page promet 11 minutes, pas 10.
    expect(SPECTATOR_NOT_FOUND_RECHECK_MINUTES).toBe(11);
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

  it("recule après un échec : le double de la dernière attente, jamais moins que Retry-After", () => {
    expect(spectatorRetryDelayMs(30_000, "120")).toBe(120_000);
    // Un Retry-After répété à l'identique ne fige pas le recul.
    expect(spectatorRetryDelayMs(60_000, "60")).toBe(120_000);
    expect(spectatorRetryDelayMs(120_000, "60")).toBe(240_000);
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

  it("ne publie que le lien de rediffusion que l'interface montre", () => {
    const url = "https://www.youtube.com/watch?v=abcdefghijk";
    const snapshot = tournamentSnapshot({
      matches: [
        // Rouvert par un retour en arrière : plus joué, le lien est masqué.
        bracketMatch({ id: 1, status: "READY", team1Id: 1, team2Id: 2, replayUrl: url }),
        bracketMatch({ id: 2, status: "COMPLETED", team1Id: 1, team2Id: 2, winnerTeamId: 1, replayUrl: url }),
      ],
    });
    const [reopened, played] = spectatorSnapshot(snapshot).matches;
    expect(reopened.replayUrl).toBeNull();
    expect(played.replayUrl).toBe(url);
  });

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

  it("masque qui caste sans masquer qu'un caster est inscrit, garde les entrées solo", () => {
    const snapshot = tournamentSnapshot({
      soloUserIds: { 4: 9 },
      matches: [bracketMatch({ id: 1, casterUserId: 33, casterPseudo: "Caster" })],
    });
    const out = spectatorSnapshot(snapshot);
    // Le podium est public : un joueur solo garde sa marche sur la page sans compte.
    expect(out.soloUserIds).toEqual({ 4: 9 });
    // Un caster est inscrit (le lancement le compte dans les « prêts »), sans dire qui.
    expect(out.matches[0].casterUserId).toBe(SPECTATOR_HIDDEN_USER_ID);
    expect(SPECTATOR_HIDDEN_USER_ID).not.toBe(SPECTATOR_VIEWER_CONTEXT.viewerUserId);
    expect(spectatorSnapshot(tournamentSnapshot({ matches: [bracketMatch({ casterUserId: null })] })).matches[0].casterUserId).toBeNull();
    // Le pseudo du caster reste : il est à l'antenne.
    expect(out.matches[0].casterPseudo).toBe("Caster");
  });

  it("garde les sanctions, sans leur arbitre ni leur motif", () => {
    const penalty = {
      id: 1,
      teamId: 4,
      teamName: "Alpha",
      round: 2,
      points: 3,
      reason: "Retard de Nova",
      authorPseudo: "Arbitre",
      createdAt: null,
      removable: false,
    };
    const endurance: EnduranceMeta = {
      startPoints: 9,
      winDelta: 1,
      lossDelta: 1,
      forfeitMaps: 3,
      playoffSize: 8,
      maxRounds: null,
      currentRound: 2,
      playoffsStarted: false,
      rounds: [1, 2],
      penalties: [penalty],
      standings: [],
    };
    const snapshot = tournamentSnapshot({ endurance });
    const out = spectatorSnapshot(snapshot).endurance!.penalties[0];
    expect(out).toMatchObject({ teamId: 4, teamName: "Alpha", round: 2, points: 3, reason: "", authorPseudo: null });
    expect(spectatorSnapshot(tournamentSnapshot({ endurance: null })).endurance).toBeNull();
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

/**
 * Inventaire des champs de la réponse publique : `spectatorSnapshot` recopie
 * l'instantané des membres et n'efface que ce qu'il connaît. Chaque champ doit
 * donc être classé ici — un champ ajouté à l'un de ces types casse le contrôle
 * de types tant qu'on n'a pas décidé s'il part en public ou s'il est retiré.
 */
type Disposition = "public" | "retiré" | "parcouru";

const SNAPSHOT_FIELDS = {
  card: "public",
  currentPhaseId: "public",
  endurance: "parcouru",
  matches: "parcouru",
  phaseStandings: "public",
  phases: "public",
  registrations: "public",
  seedingSource: "public",
  // Marche du podium d'une entrée solo (public, déclaré au RGPD).
  soloUserIds: "public",
  survival: "public",
  swiss: "public",
  version: "public",
} as const satisfies Record<keyof TournamentSnapshot, Disposition>;

const MATCH_FIELDS = {
  bracket: "public",
  casterPseudo: "public",
  casterReady: "public",
  casterUserId: "retiré",
  doubleForfeit: "public",
  forfeitTeamId: "public",
  hostTeamId: "public",
  id: "public",
  launchedAt: "public",
  liveStartedAt: "public",
  liveTrigger: "public",
  liveUrl: "public",
  lobbyOpenedAt: "public",
  loserTeamId: "public",
  maps: "parcouru",
  matchNumber: "public",
  nextLoserMatchId: "public",
  nextLoserSlot: "public",
  nextWinnerMatchId: "public",
  nextWinnerSlot: "public",
  phaseId: "public",
  phasePosition: "public",
  replayUrl: "public",
  roundNumber: "public",
  scoreDeadlineAt: "public",
  startAt: "public",
  status: "public",
  team1Id: "public",
  team1Name: "public",
  team1Placeholder: "public",
  team1Ready: "public",
  team1Report: "parcouru",
  team1Score: "public",
  team2Id: "public",
  team2Name: "public",
  team2Placeholder: "public",
  team2Ready: "public",
  team2Report: "parcouru",
  team2Score: "public",
  tournamentId: "public",
  updatedAt: "public",
  winnerTeamId: "public",
} as const satisfies Record<keyof BracketMatch, Disposition>;

const MAP_FIELDS = {
  mapNumber: "public",
  replayCode: "retiré",
  team1Score: "public",
  team2Score: "public",
} as const satisfies Record<keyof MatchMapResult, Disposition>;

const REPORT_FIELDS = {
  maps: "retiré",
  reportedAt: "public",
  team1Score: "public",
  team2Score: "public",
} as const satisfies Record<keyof MatchScoreReport, Disposition>;

const PENALTY_FIELDS = {
  authorPseudo: "retiré",
  createdAt: "public",
  id: "public",
  points: "public",
  reason: "retiré",
  removable: "public",
  round: "public",
  teamId: "public",
  teamName: "public",
} as const satisfies Record<keyof EndurancePenaltyRow, Disposition>;

describe("inventaire des champs publics", () => {
  it("couvre exactement les champs des fabriques de test", () => {
    expect(Object.keys(SNAPSHOT_FIELDS).sort()).toEqual(Object.keys(tournamentSnapshot()).sort());
    expect(Object.keys(MATCH_FIELDS).sort()).toEqual(Object.keys(bracketMatch()).sort());
  });

  it("n'ajoute aucun champ, à aucun niveau", () => {
    const maps: MatchMapResult[] = [{ mapNumber: 1, replayCode: "ABC123", team1Score: 2, team2Score: 1 }];
    const report: MatchScoreReport = { team1Score: 2, team2Score: 1, reportedAt: "2026-01-01T00:00:00.000Z", maps };
    const snapshot = tournamentSnapshot({
      matches: [bracketMatch({ maps, casterUserId: 7, team1Report: report, team2Report: report })],
    });
    const out = spectatorSnapshot(snapshot);
    expect(Object.keys(out).sort()).toEqual(Object.keys(snapshot).sort());
    const match = out.matches[0];
    expect(Object.keys(match).sort()).toEqual(Object.keys(snapshot.matches[0]).sort());
    expect(Object.keys(match.maps[0]).sort()).toEqual(Object.keys(MAP_FIELDS).sort());
    expect(Object.keys(match.team1Report!).sort()).toEqual(Object.keys(REPORT_FIELDS).sort());
  });

  it("garde la forme d'une sanction", () => {
    const penalty: EndurancePenaltyRow = {
      id: 1,
      teamId: 4,
      teamName: "Alpha",
      round: 2,
      points: 3,
      reason: "Motif",
      authorPseudo: "Arbitre",
      createdAt: null,
      removable: false,
    };
    const endurance: EnduranceMeta = {
      startPoints: 9,
      winDelta: 1,
      lossDelta: 1,
      forfeitMaps: 3,
      playoffSize: 8,
      maxRounds: null,
      currentRound: 2,
      playoffsStarted: false,
      rounds: [1, 2],
      penalties: [penalty],
      standings: [],
    };
    const out = spectatorSnapshot(tournamentSnapshot({ endurance })).endurance!.penalties[0];
    expect(Object.keys(out).sort()).toEqual(Object.keys(PENALTY_FIELDS).sort());
  });
});
