import { describe, expect, it } from "@jest/globals";
import {
  FIRST_MAP_MAX_LENGTH,
  firstBanTeamId,
  matchHostTeamId,
  normalizeFirstMap,
  refereeBlockReason,
  refereeDecision,
} from "@/lib/shared/match-referee";
import { allPartiesReady, readyCount } from "@/lib/shared/match-launch";
import { noRefereeAlertKey, refereeAlertKey } from "@/lib/server/tournaments/bot-logs";
import { botEventChannel, formatNoRefereeAlert } from "@/lib/shared/referee-alerts";
import { formatRefereeChangeLog, formatRoundSelfManagementLog } from "@/lib/shared/bot-logs";
import {
  firstBanTeamName,
  launchStripControls,
  refereeStripState,
  type LaunchStripViewer,
} from "@/app/(secured)/tournois/[id]/_lib/launch-strip";
import {
  refereeConfirmTone,
  refereeDialogActions,
  refereeFocusTarget,
  type RefereePanelView,
} from "@/app/(secured)/tournois/[id]/_lib/referee-dialog";
import { bracketMatch } from "../../helpers/bracket-match";

/**
 * Arbitre désigné, autogestion, hôte et premier ban (`lib/shared/match-referee.ts`,
 * `docs/features/MATCH_REFEREE.md`) : règles pures, et ce que la carte en montre.
 */

const VERIFIED = { discordVerified: true, blizzardLinked: true };

describe("refereeBlockReason", () => {
  it("demande la permission `tournaments`, puis l'identité d'un caster", () => {
    expect(refereeBlockReason(false, VERIFIED)).toBe("NOT_REFEREE");
    expect(refereeBlockReason(true, { discordVerified: false, blizzardLinked: true })).toBe("REFEREE_IDENTITY_REQUIRED");
    expect(refereeBlockReason(true, { discordVerified: true, blizzardLinked: false })).toBe("REFEREE_IDENTITY_REQUIRED");
    expect(refereeBlockReason(true, VERIFIED)).toBeNull();
  });
});

describe("refereeDecision", () => {
  it("arbitre d'abord, autogestion ensuite, sinon sans décision — jamais d'autogestion d'office", () => {
    expect(refereeDecision({ refereeAssigned: true, selfManaged: true })).toBe("REFEREE");
    expect(refereeDecision({ refereeAssigned: false, selfManaged: true })).toBe("SELF_MANAGED");
    expect(refereeDecision({ refereeAssigned: false, selfManaged: false })).toBe("UNDECIDED");
  });
});

describe("normalizeFirstMap", () => {
  it("rend la forme affichable, vide ou absente = aucune", () => {
    expect(normalizeFirstMap("  Ilios  ")).toBe("Ilios");
    expect(normalizeFirstMap("")).toBeNull();
    expect(normalizeFirstMap("   ")).toBeNull();
    expect(normalizeFirstMap(null)).toBeNull();
    expect(normalizeFirstMap(undefined)).toBeNull();
  });

  it("accepte la longueur maximale, refuse au-delà ou ce qui n'est pas un texte", () => {
    expect(normalizeFirstMap("x".repeat(FIRST_MAP_MAX_LENGTH))).toHaveLength(FIRST_MAP_MAX_LENGTH);
    expect(() => normalizeFirstMap("x".repeat(FIRST_MAP_MAX_LENGTH + 1))).toThrow("INVALID_FIRST_MAP");
    expect(() => normalizeFirstMap(3)).toThrow("INVALID_FIRST_MAP");
  });
});

describe("matchHostTeamId / firstBanTeamId", () => {
  it("l'hôte choisi par le staff, s'il joue encore le match", () => {
    expect(matchHostTeamId(20, 10, 20)).toBe(20);
    expect(matchHostTeamId(30, 10, 20)).toBe(10);
  });

  it("BlueGenji Survie : la meilleure tête de série héberge (rang le plus petit)", () => {
    expect(matchHostTeamId(null, 10, 20, { team1: 4, team2: 1 })).toBe(20);
    expect(matchHostTeamId(null, 10, 20, { team1: 1, team2: 4 })).toBe(10);
    // Rang inconnu : l'équipe 1, comme ailleurs. Le choix du staff passe devant le rang.
    expect(matchHostTeamId(null, 10, 20, { team1: null, team2: 1 })).toBe(10);
    expect(matchHostTeamId(10, 10, 20, { team1: 4, team2: 1 })).toBe(10);
  });

  it("l'autre équipe bannit la première ; personne tant qu'un adversaire manque", () => {
    expect(firstBanTeamId(10, 10, 20)).toBe(20);
    expect(firstBanTeamId(20, 10, 20)).toBe(10);
    expect(firstBanTeamId(10, 10, null)).toBeNull();
    expect(firstBanTeamId(null, 10, 20)).toBeNull();
  });
});

describe("« Prêt » de l'arbitre : une 4e partie", () => {
  const base = { team1Ready: true, team2Ready: true, casters: [] };
  it("attendu quand un arbitre est désigné, absent sinon", () => {
    expect(readyCount({ ...base, referee: { ready: false } })).toEqual({ ready: 2, expected: 3 });
    expect(allPartiesReady({ ...base, referee: { ready: false } })).toBe(false);
    expect(allPartiesReady({ ...base, referee: { ready: true } })).toBe(true);
    expect(readyCount({ ...base, referee: null })).toEqual({ ready: 2, expected: 2 });
  });

  it("readyCount_refereeAlsoCaster_countedOnce", () => {
    const count = readyCount({ ...base, casters: [{ userId: 5, ready: false }], referee: { userId: 5, ready: false } });
    expect(count).toEqual({ ready: 2, expected: 3 });
  });

  it("readyCount_refereeNotCaster_countedSeparately", () => {
    const count = readyCount({ ...base, casters: [{ userId: 5, ready: true }], referee: { userId: 6, ready: false } });
    expect(count).toEqual({ ready: 3, expected: 4 });
  });
});

describe("alerte « sans arbitre »", () => {
  it("une réservation par appariement, au canal des arbitres", () => {
    expect(noRefereeAlertKey("10:20")).toBe("NO_REFEREE:10:20");
    expect(noRefereeAlertKey("1".repeat(60))).toHaveLength(32);
    expect(refereeAlertKey({ kind: "match_no_referee", matchId: 42, pairing: "10:20" })).toBe("NO_REFEREE:10:20");
    expect(refereeAlertKey({ kind: "match_no_referee", matchId: 42, pairing: "10:30" })).not.toBe("NO_REFEREE:10:20");
    // Manche sans horaire : la clé de son premier match, la même qu'un match planifié.
    expect(refereeAlertKey({ kind: "match_no_referee", matchId: 42, pairing: "10:20", roundMatchIds: [42, 43] })).toBe(
      "NO_REFEREE:10:20",
    );
    expect(botEventChannel("match_no_referee")).toBe(botEventChannel("score_conflict"));
  });

  it("dit qu'une décision est attendue, sans basculer en autogestion", () => {
    const line = formatNoRefereeAlert({
      tournament: { id: 7, name: "Coupe" },
      tournamentUrl: null,
      matchId: 42,
      bracket: "UPPER",
      roundNumber: 1,
      team1: { name: "Renards", participantType: "TEAM" },
      team2: { name: "Nova", participantType: "TEAM" },
    });
    expect(line).toContain("sans arbitre ni autogestion");
    expect(line).toContain("une décision est attendue");
  });
});

describe("journal de l'arbitrage", () => {
  it("ne nomme ni l'arbitre ni le staff", () => {
    const line = formatRefereeChangeLog({
      tournament: { id: 7, name: "Coupe" },
      matchId: 42,
      bracket: "UPPER",
      roundNumber: 1,
      team1: { name: "Renards", participantType: "TEAM" },
      team2: { name: "Nova", participantType: "TEAM" },
      change: "RELEASED_BY_STAFF",
    });
    expect(line).toContain("Arbitre retiré");
    expect(line).toContain("le staff");
  });

  it("une ligne par manche, au pluriel près", () => {
    const tournament = { id: 7, name: "Coupe" };
    expect(formatRoundSelfManagementLog({ tournament, roundLabel: "Manche 2", enabled: true, count: 3 })).toContain(
      "Autogestion activée",
    );
    expect(formatRoundSelfManagementLog({ tournament, roundLabel: "Manche 2", enabled: true, count: 3 })).toContain("3 matchs");
    expect(formatRoundSelfManagementLog({ tournament, roundLabel: "Manche 2", enabled: false, count: 1 })).toContain(
      "1 match,",
    );
  });
});

describe("bandeau de la carte : ce qu'il dit de l'arbitrage", () => {
  const match = bracketMatch({ status: "READY", team1Id: 10, team2Id: 20, team1Name: "Alpha", team2Name: "Bravo", hostTeamId: 10, firstBanTeamId: 20 });

  it("« Arbitre désigné » ou « Autogestion » pour tous, « Sans arbitre » au staff seul", () => {
    expect(refereeStripState({ ...match, refereeAssigned: true }, "LOBBY", false)).toBe("REFEREE");
    expect(refereeStripState({ ...match, selfManaged: true }, "SCHEDULED", false)).toBe("SELF_MANAGED");
    expect(refereeStripState(match, "LOBBY", false)).toBeNull();
    expect(refereeStripState(match, "LOBBY", true)).toBe("UNDECIDED");
  });

  it("rien sur un match joué ou sans phase", () => {
    expect(refereeStripState({ ...match, status: "COMPLETED", refereeAssigned: true }, "LAUNCHED", true)).toBeNull();
    expect(refereeStripState({ ...match, refereeAssigned: true }, "NONE", true)).toBeNull();
  });

  it("nomme l'équipe qui bannit la première", () => {
    expect(firstBanTeamName(match)).toBe("Bravo");
    expect(firstBanTeamName({ ...match, firstBanTeamId: null })).toBeNull();
  });

  it("« Arbitrage » : permission `tournaments`, match à jouer, jamais un bye", () => {
    const viewer: LaunchStripViewer = { canManage: false, canSchedule: true, viewerUserId: 1, myTeamId: null };
    expect(launchStripControls(match, "LOBBY", viewer).showReferee).toBe(true);
    expect(launchStripControls(match, "LOBBY", { ...viewer, canSchedule: false }).showReferee).toBe(false);
    expect(launchStripControls({ ...match, status: "COMPLETED" }, "LAUNCHED", viewer).showReferee).toBe(false);
    expect(launchStripControls({ ...match, team2Id: null }, "NONE", viewer).showReferee).toBe(false);
  });
});

describe("fenêtre « Arbitrage » : gestes offerts", () => {
  const panel = (referee: RefereePanelView["referee"]): RefereePanelView => ({
    matchId: 42,
    referee,
    selfManaged: false,
    firstMap: null,
    viewerBlock: null,
    round: { phaseId: 0, roundNumber: 1, bracket: "UPPER", open: 2, selfManaged: 0, refereed: 0 },
    roundSlots: [],
    candidates: [
      { userId: 1, pseudo: "Moi" },
      { userId: 2, pseudo: "Autre" },
    ],
    objections: [],
    objectable: [],
  });

  it("sans arbitre : prendre le match, tout compte désignable", () => {
    const actions = refereeDialogActions(panel(null), 1);
    expect(actions).toMatchObject({ take: true, releaseSelf: false, removeOther: false });
    expect(actions.candidates.map((c) => c.userId)).toEqual([1, 2]);
  });

  it("arbitre du match : s'en retirer, sans se proposer à soi-même", () => {
    const actions = refereeDialogActions(panel({ userId: 1, pseudo: "Moi", eligible: true, reason: null }), 1);
    expect(actions).toMatchObject({ take: false, releaseSelf: true, removeOther: false });
    expect(actions.candidates.map((c) => c.userId)).toEqual([2]);
  });

  it("un autre arbitre : le retirer ; le reprendre seulement s'il ne peut plus arbitrer", () => {
    expect(refereeDialogActions(panel({ userId: 2, pseudo: "Autre", eligible: true, reason: null }), 1)).toMatchObject({
      take: false,
      removeOther: true,
    });
    expect(refereeDialogActions(panel({ userId: 2, pseudo: "Autre", eligible: false, reason: "NOT_REFEREE" }), 1).take).toBe(true);
  });

  it("refereeDialogActions_viewerObjectionUpheld_hidesTake", () => {
    const view = { ...panel(null), objections: [{ userId: 1, pseudo: "Moi" }] };
    expect(refereeDialogActions(view, 1).take).toBe(false);
  });

  it("refereeDialogActions_objectionListedOnly_takeBlockedObjection", () => {
    const view = { ...panel(null), objections: [{ userId: 1, pseudo: "Moi" }] };
    expect(refereeDialogActions(view, 1).takeBlocked).toBe("REFEREE_OBJECTION");
  });

  it("refereeDialogActions_viewerBlockPlayer_hidesTakeAndReportsReason", () => {
    const actions = refereeDialogActions({ ...panel(null), viewerBlock: "REFEREE_IS_PLAYER" }, 1);
    expect(actions).toMatchObject({ take: false, takeBlocked: "REFEREE_IS_PLAYER" });
  });

  it("refereeDialogActions_viewerIdentityRequired_hidesTake", () => {
    const actions = refereeDialogActions({ ...panel(null), viewerBlock: "REFEREE_IDENTITY_REQUIRED" }, 1);
    expect(actions).toMatchObject({ take: false, takeBlocked: "REFEREE_IDENTITY_REQUIRED" });
  });

  it("refereeDialogActions_viewerFree_noTakeBlocked", () => {
    expect(refereeDialogActions(panel(null), 1)).toMatchObject({ take: true, takeBlocked: null });
  });

  it("refereeDialogActions_eligibleRefereeInPlace_noTakeBlocked", () => {
    const view = { ...panel({ userId: 2, pseudo: "Autre", eligible: true, reason: null }), viewerBlock: "REFEREE_IS_PLAYER" as const };
    expect(refereeDialogActions(view, 1)).toMatchObject({ take: false, takeBlocked: null });
  });

  it("refereeDialogActions_roundAllOpenSelfManaged_offersOffOnly", () => {
    const view = { ...panel(null), round: { ...panel(null).round, open: 3, selfManaged: 3 } };
    expect(refereeDialogActions(view, 1)).toMatchObject({ roundOn: false, roundOff: true });
  });

  it("refereeDialogActions_roundNoneSelfManaged_offersOnOnly", () => {
    const view = { ...panel(null), round: { ...panel(null).round, open: 3, selfManaged: 0 } };
    expect(refereeDialogActions(view, 1)).toMatchObject({ roundOn: true, roundOff: false });
  });

  it("refereeDialogActions_roundMixed_offersBoth", () => {
    const view = { ...panel(null), round: { ...panel(null).round, open: 3, selfManaged: 1 } };
    expect(refereeDialogActions(view, 1)).toMatchObject({ roundOn: true, roundOff: true });
  });

  it("refereeDialogActions_roundNoOpenMatch_offersNeither", () => {
    const view = { ...panel(null), round: { ...panel(null).round, open: 0, selfManaged: 0 } };
    expect(refereeDialogActions(view, 1)).toMatchObject({ roundOn: false, roundOff: false });
  });
});

describe("refereeConfirmTone (fenêtre « Arbitrage »)", () => {
  const round = { phaseId: 0, roundNumber: 1, bracket: "UPPER", open: 2, selfManaged: 0, refereed: 0 };
  const referee = { userId: 2, pseudo: "Autre", eligible: true, reason: null };

  it("refereeConfirmTone_removeAndObjection_danger", () => {
    expect(refereeConfirmTone("removeReferee", { referee, round })).toBe("danger");
    expect(refereeConfirmTone("objection", { referee: null, round })).toBe("danger");
  });

  it("refereeConfirmTone_selfOnWithoutReferee_primary", () => {
    expect(refereeConfirmTone("selfOn", { referee: null, round })).toBe("primary");
  });

  it("refereeConfirmTone_selfOnWithReferee_danger", () => {
    expect(refereeConfirmTone("selfOn", { referee, round })).toBe("danger");
  });

  it("refereeConfirmTone_roundOnWithRefereed_danger", () => {
    expect(refereeConfirmTone("roundOn", { referee: null, round: { ...round, refereed: 1 } })).toBe("danger");
  });

  it("refereeConfirmTone_roundOnWithoutRefereed_primary", () => {
    expect(refereeConfirmTone("roundOn", { referee: null, round })).toBe("primary");
  });

  it("refereeConfirmTone_roundOffAndLift_primary", () => {
    expect(refereeConfirmTone("roundOff", { referee, round })).toBe("primary");
    expect(refereeConfirmTone("liftObjection", { referee, round })).toBe("primary");
  });
});

describe("refereeFocusTarget (fenêtre « Arbitrage »)", () => {
  const node = (name: string, isConnected = true) => ({ name, isConnected });
  const body = node("body");
  const status = node("status");

  it("ne touche à rien quand le focus est encore sur un élément vivant", () => {
    expect(refereeFocusTarget({ active: node("champ"), body, trigger: node("bouton"), status })).toBeNull();
  });

  it("rend le focus au contrôle du geste, lâché pendant l'envoi, s'il existe encore", () => {
    const trigger = node("Enregistrer la carte");
    expect(refereeFocusTarget({ active: body, body, trigger, status })).toBe(trigger);
    expect(refereeFocusTarget({ active: null, body, trigger, status })).toBe(trigger);
  });

  it("se rabat sur la phrase d'état quand le geste a retiré son bouton", () => {
    expect(refereeFocusTarget({ active: body, body, trigger: node("Arbitrer ce match", false), status })).toBe(status);
    expect(refereeFocusTarget({ active: node("retiré", false), body, trigger: null, status })).toBe(status);
  });

  it("n'adopte jamais la page comme déclencheur", () => {
    expect(refereeFocusTarget({ active: body, body, trigger: body, status })).toBe(status);
  });

  it("sans phrase d'état montée, rien", () => {
    expect(refereeFocusTarget({ active: body, body, trigger: null, status: null })).toBeNull();
  });

  it("refereeFocusTarget_firstArrival_focusesStatusEvenWhenCloseFocused", () => {
    expect(refereeFocusTarget({ active: node("Fermer"), body, trigger: null, status, firstArrival: true })).toBe(status);
  });

  it("refereeFocusTarget_firstArrivalWithoutStatus_fallsBackToNormalRule", () => {
    expect(refereeFocusTarget({ active: node("Fermer"), body, trigger: null, status: null, firstArrival: true })).toBeNull();
  });
});
