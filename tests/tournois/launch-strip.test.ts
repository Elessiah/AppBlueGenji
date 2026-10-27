import { describe, expect, it } from "@jest/globals";
import {
  hostTeamName,
  launchStripControls,
  type LaunchStripViewer,
} from "@/app/(secured)/tournois/[id]/_lib/launch-strip";
import type { MatchLaunchPhase } from "@/lib/shared/match-launch";
import { bracketMatch, matchCaster } from "../helpers/bracket-match";

const match = bracketMatch({
  status: "READY",
  team1Id: 10,
  team2Id: 20,
  team1Name: "Alpha",
  team2Name: "Bravo",
  hostTeamId: 20,
  casters: [],
});
const nobody: LaunchStripViewer = { canManage: false, canSchedule: false, viewerUserId: 1, myTeamId: null };
const referee: LaunchStripViewer = { ...nobody, canSchedule: true };

describe("launchStripControls", () => {
  it("offre « Planifier » et « Forcer » à l'arbitrage sur un match à planifier", () => {
    const controls = launchStripControls(match, "TO_PLAN", referee);
    expect(controls.showPlan).toBe(true);
    expect(controls.showForce).toBe(true);
    expect(controls.showOpen).toBe(false);
  });

  it.each<[MatchLaunchPhase, boolean]>([
    ["TO_PLAN", true],
    ["SCHEDULED", true],
    ["LOBBY", true],
    ["LAUNCHED", false],
    ["NONE", false],
  ])("ne laisse forcer qu'avant le départ effectif (%s)", (phase, expected) => {
    expect(launchStripControls(match, phase, referee).showForce).toBe(expected);
  });

  it("ne donne aucun bouton d'arbitrage sans la permission", () => {
    const controls = launchStripControls(match, "TO_PLAN", nobody);
    expect(controls.showPlan || controls.showForce || controls.showHostSwap).toBe(false);
  });

  it("ouvre la modale aux parties du match en lancement ou lancé seulement", () => {
    const player = { ...nobody, myTeamId: 10 };
    expect(launchStripControls(match, "LOBBY", player).showOpen).toBe(true);
    expect(launchStripControls(match, "LAUNCHED", player).showOpen).toBe(true);
    expect(launchStripControls(match, "TO_PLAN", player).showOpen).toBe(false);
    expect(launchStripControls(match, "SCHEDULED", player).showOpen).toBe(false);
  });

  it("reconnaît le caster, qui peut se retirer — co-caster compris", () => {
    const casted = bracketMatch({ ...match, casters: [matchCaster({ userId: 5 }), matchCaster({ userId: 1 })] });
    const controls = launchStripControls(casted, "LOBBY", nobody);
    expect(controls.isCaster).toBe(true);
    expect(controls.showRelease).toBe(true);
    // Déjà caster : rien de plus à rejoindre.
    expect(launchStripControls(casted, "LOBBY", { ...nobody, canManage: true }).showClaim).toBe(false);
  });

  it("laisse caster un match déjà casté, sans plafond", () => {
    const caster = { ...nobody, canManage: true };
    const casted = bracketMatch({
      ...match,
      casters: [matchCaster({ userId: 5 }), matchCaster({ userId: 6 }), matchCaster({ userId: 7, streamId: 2 })],
    });
    expect(launchStripControls(casted, "LOBBY", caster).showClaim).toBe(true);
  });

  it("offre le retrait d'un caster à l'arbitrage seulement, et jamais sans caster", () => {
    const casted = bracketMatch({ ...match, casters: [matchCaster({ userId: 5 })] });
    expect(launchStripControls(casted, "LOBBY", referee).showRelease).toBe(true);
    expect(launchStripControls(casted, "LOBBY", nobody).showRelease).toBe(false);
    expect(launchStripControls(match, "LOBBY", referee).showRelease).toBe(false);
    expect(launchStripControls(bracketMatch({ ...casted, status: "COMPLETED" }), "NONE", referee).showRelease).toBe(false);
  });

  it("n'offre pas de caster un bye ni son propre match", () => {
    const caster = { ...nobody, canManage: true };
    const bye = bracketMatch({ ...match, team2Id: null });
    expect(launchStripControls(bye, "NONE", caster).showClaim).toBe(false);
    expect(launchStripControls(match, "LOBBY", { ...caster, myTeamId: 10 }).showClaim).toBe(false);
    expect(launchStripControls(match, "LOBBY", caster).showClaim).toBe(true);
  });

  it("n'annonce aucun hôte hors du cycle de lancement", () => {
    expect(launchStripControls(match, "NONE", referee).showHost).toBe(false);
    expect(launchStripControls(match, "TO_PLAN", referee).showHostSwap).toBe(true);
  });
});

describe("hostTeamName", () => {
  it("nomme l'hôte désigné, et rien sans hôte", () => {
    expect(hostTeamName(match)).toBe("Bravo");
    expect(hostTeamName(bracketMatch({ ...match, hostTeamId: 10 }))).toBe("Alpha");
    expect(hostTeamName(bracketMatch({ ...match, hostTeamId: null }))).toBeNull();
  });
});
