import { describe, expect, it } from "@jest/globals";
import {
  canPlayersReportScore,
  isScoreEntryOpen,
  matchLaunchPhase,
  nextLaunchPhaseChangeAt,
  type MatchLaunchInput,
} from "@/lib/shared/match-launch";
import { matchSectionOf, sectionRoundMatches } from "@/lib/shared/match-sections";
import { launchStripControls, type LaunchStripViewer } from "@/app/(secured)/tournois/[id]/_lib/launch-strip";
import { groupMatchCardActions, matchCardActionList } from "@/app/(secured)/tournois/[id]/_lib/match-card-actions";
import { editableFieldsForWindow, RESTRICTED_FIELDS } from "@/lib/shared/tournament-edit";
import { bracketMatch } from "../../helpers/bracket-match";
import frActions from "@/messages/fr/tournamentActions.json";
import enActions from "@/messages/en/tournamentActions.json";
import frLaunch from "@/messages/fr/launchModal.json";
import enLaunch from "@/messages/en/launchModal.json";
import frForm from "@/messages/fr/tournamentForm.json";
import enForm from "@/messages/en/tournamentForm.json";

/**
 * Phase de lancement devenue une option du tournoi (`docs/features/MATCH_LAUNCH.md`
 * § Option du tournoi) : éteinte, un match part dès son heure ; allumée, la
 * règle d'origine ; absente, allumée.
 */

const NOW = Date.parse("2026-10-19T20:00:00.000Z");
const PAST = "2026-10-19T19:00:00.000Z";
const FUTURE = "2026-10-19T21:00:00.000Z";

function input(overrides: Partial<MatchLaunchInput> = {}): MatchLaunchInput {
  return {
    status: "READY",
    team1Id: 10,
    team2Id: 20,
    startAt: PAST,
    launchedAt: null,
    refereeScheduling: false,
    ...overrides,
  };
}

describe("matchLaunchPhase — option éteinte", () => {
  it("lance d'emblée un match jouable à l'heure passée ou sans heure", () => {
    expect(matchLaunchPhase(input({ launchPhase: false }), NOW)).toBe("LAUNCHED");
    expect(matchLaunchPhase(input({ launchPhase: false, startAt: null }), NOW)).toBe("LAUNCHED");
  });

  it("laisse « en attente de départ » un match programmé plus tard", () => {
    expect(matchLaunchPhase(input({ launchPhase: false, startAt: FUTURE }), NOW)).toBe("SCHEDULED");
    expect(nextLaunchPhaseChangeAt(input({ launchPhase: false, startAt: FUTURE }), NOW)).toBe(Date.parse(FUTURE));
  });

  it("ne touche ni à la planification par l'arbitrage, ni aux matchs finis ou incomplets", () => {
    expect(matchLaunchPhase(input({ launchPhase: false, startAt: null, refereeScheduling: true }), NOW)).toBe("TO_PLAN");
    expect(matchLaunchPhase(input({ launchPhase: false, status: "COMPLETED" }), NOW)).toBe("NONE");
    expect(matchLaunchPhase(input({ launchPhase: false, team2Id: null }), NOW)).toBe("NONE");
  });

  it("ouvre le report d'un score dès l'heure, sans « Prêt »", () => {
    expect(canPlayersReportScore({ ...input(), launchPhase: false }, NOW)).toBe(true);
    expect(canPlayersReportScore({ ...input(), launchPhase: false, startAt: FUTURE }, NOW)).toBe(false);
    expect(isScoreEntryOpen(input({ launchPhase: false }), NOW)).toBe(true);
  });

  it("planification par l'arbitrage : un match sans date attend sa date, pas de score", () => {
    const undated = { ...input(), launchPhase: false, startAt: null };
    expect(canPlayersReportScore({ ...undated, refereeScheduling: true }, NOW)).toBe(false);
    expect(canPlayersReportScore({ ...undated, refereeScheduling: false }, NOW)).toBe(true);
    expect(canPlayersReportScore(undated, NOW)).toBe(true);
    // Lancé par écriture : la planification ne le referme pas.
    expect(canPlayersReportScore({ ...undated, refereeScheduling: true, launchedAt: PAST }, NOW)).toBe(true);
  });
});

describe("matchLaunchPhase — option allumée, ou absente", () => {
  it("garde le lancement d'origine", () => {
    expect(matchLaunchPhase(input({ launchPhase: true }), NOW)).toBe("LOBBY");
    expect(matchLaunchPhase(input(), NOW)).toBe("LOBBY");
    expect(matchLaunchPhase(input({ launchPhase: true, launchedAt: PAST }), NOW)).toBe("LAUNCHED");
    expect(canPlayersReportScore(input({ launchPhase: true }), NOW)).toBe(false);
  });
});

describe("sections de la ronde", () => {
  it("éteinte, aucun match ne tombe sous « Lancement »", () => {
    const match = bracketMatch({ status: "READY", team1Id: 10, team2Id: 20, startAt: PAST, launchedAt: null });
    expect(matchSectionOf(match, false, NOW)).toBe("LOBBY");
    expect(matchSectionOf(match, false, NOW, false)).toBe("PLAYING");
    const sections = sectionRoundMatches([match], { refereeScheduling: false, launchPhase: false, now: NOW, seeds: {} });
    expect(sections.map((s) => s.key)).toEqual(["PLAYING"]);
  });
});

describe("bouton « Contacts » de la carte", () => {
  const match = bracketMatch({ status: "READY", team1Id: 10, team2Id: 20, casterUserId: 900 });
  const viewer = (overrides: Partial<LaunchStripViewer> = {}): LaunchStripViewer => ({
    canManage: false,
    canSchedule: false,
    viewerUserId: 1,
    myTeamId: 10,
    ...overrides,
  });

  it("offert aux joueurs du match programmé, en lancement ou lancé", () => {
    for (const phase of ["SCHEDULED", "LOBBY", "LAUNCHED"] as const) {
      expect(launchStripControls(match, phase, viewer()).showContacts).toBe(true);
    }
  });

  it("offert au caster inscrit le temps du match seulement", () => {
    const caster = viewer({ viewerUserId: 900, myTeamId: null });
    for (const phase of ["LOBBY", "LAUNCHED"] as const) {
      expect(launchStripControls(match, phase, caster).showContacts).toBe(true);
      expect(launchStripControls(match, phase, { ...caster, launchPhase: false }).showContacts).toBe(true);
    }
    for (const phase of ["TO_PLAN", "SCHEDULED", "NONE"] as const) {
      expect(launchStripControls(match, phase, caster).showContacts).toBe(false);
    }
  });

  it("jamais offert à qui n'est ni partie du match ni arbitre", () => {
    expect(launchStripControls(match, "LAUNCHED", viewer({ myTeamId: 30 })).showContacts).toBe(false);
    // Permission `live` seule (caster potentiel) : pas d'arbitrage, pas de contacts.
    expect(launchStripControls(match, "LAUNCHED", viewer({ myTeamId: null, canManage: true })).showContacts).toBe(false);
  });

  // Décision du 2026-10-19 : l'arbitre lit les contacts comme un joueur du match.
  it("offert à l'arbitre aux mêmes phases qu'aux joueurs, à planifier compris", () => {
    const referee = viewer({ myTeamId: null, canSchedule: true });
    for (const phase of ["TO_PLAN", "SCHEDULED", "LOBBY", "LAUNCHED"] as const) {
      expect(launchStripControls(match, phase, referee).showContacts).toBe(true);
      expect(launchStripControls(match, phase, { ...referee, launchPhase: false }).showContacts).toBe(true);
    }
    expect(launchStripControls(match, "NONE", referee).showContacts).toBe(false);
    // Arbitre et caster du même match : la règle de l'arbitre l'emporte.
    expect(launchStripControls(match, "TO_PLAN", { ...referee, viewerUserId: 900 }).showContacts).toBe(true);
  });

  it("offert dès que les deux adversaires sont connus (à planifier compris), jamais sur un match fini", () => {
    expect(launchStripControls(match, "NONE", viewer()).showContacts).toBe(false);
    expect(launchStripControls(match, "TO_PLAN", viewer()).showContacts).toBe(true);
    expect(launchStripControls(match, "TO_PLAN", viewer({ launchPhase: false })).showContacts).toBe(true);
  });

  it("option éteinte : « Infos du match » disparaît, « Contacts » reste", () => {
    const off = launchStripControls(match, "LAUNCHED", viewer({ launchPhase: false }));
    expect(off.showOpen).toBe(false);
    expect(off.showContacts).toBe(true);
    expect(launchStripControls(match, "LAUNCHED", viewer()).showOpen).toBe(true);
  });

  it("devient l'action principale d'un joueur sans lancement à suivre", () => {
    const launch = launchStripControls(match, "SCHEDULED", viewer({ launchPhase: false }));
    const actions = matchCardActionList({
      playerScoreLabel: null,
      launch,
      inLobby: false,
      adminScoreLabel: null,
      showSchedule: false,
      hasStartAt: true,
      showOnAir: false,
      onAir: false,
      showLiveConfig: false,
      liveConfigured: false,
      showReplay: false,
      hasReplay: false,
      canReport: true,
    });
    expect(groupMatchCardActions(actions).primary).toMatchObject({ id: "contacts", label: "Contacts" });
  });
});

describe("fenêtre d'édition", () => {
  it("modifiable jusqu'au départ, figée une fois le tournoi en cours", () => {
    expect(editableFieldsForWindow("FULL").has("launchPhase")).toBe(true);
    expect(RESTRICTED_FIELDS).toContain("launchPhase");
    expect(editableFieldsForWindow("LOCKED").has("launchPhase")).toBe(false);
  });
});

describe("textes FR et EN", () => {
  it("chaque nouvelle clé existe dans les deux langues", () => {
    expect(frActions.cardActions.contacts).toBe("Contacts");
    expect(enActions.cardActions.contacts).toBe("Contacts");
    expect(Object.keys(enLaunch.contacts).sort()).toEqual(Object.keys(frLaunch.contacts).sort());
    expect(Object.keys(enForm.form.launchPhase).sort()).toEqual(Object.keys(frForm.form.launchPhase).sort());
    expect(enForm.edit.fields.launchPhase).toBe("Match launch phase");
    expect(frForm.edit.fields.launchPhase).toBe("Phase de lancement des matchs");
  });
});
