import { describe, expect, it } from "@jest/globals";
import {
  MAX_CAST_BATTLETAG_LENGTH,
  casterStreamEditable,
  isValidCastBattletag,
  offersCastRelease,
  offersCastSettings,
  parseCastBattletagInput,
} from "@/lib/shared/cast-settings";
import type { MatchStatus } from "@/lib/shared/types";

/**
 * Règles pures des réglages du cast (`docs/features/CAST_SETTINGS.md`) : le
 * serveur refuse et l'interface désarme sur les mêmes mots.
 */

/** Un match vu par les règles de diffusion et de rediff. */
const match = (over: Partial<Parameters<typeof offersCastSettings>[0]> = {}) => ({
  status: "READY" as MatchStatus,
  team1Id: 10,
  team2Id: 20,
  forfeitTeamId: null,
  liveTrigger: null,
  liveStartedAt: null,
  launchedAt: null,
  replayUrl: null,
  ...over,
});

describe("parseCastBattletagInput", () => {
  it("rogne la saisie et rend `null` quand il n'y a rien", () => {
    expect(parseCastBattletagInput("  Voix#2100  ")).toBe("Voix#2100");
    expect(parseCastBattletagInput("")).toBeNull();
    expect(parseCastBattletagInput("   ")).toBeNull();
    expect(parseCastBattletagInput(null)).toBeNull();
    expect(parseCastBattletagInput(undefined)).toBeNull();
  });

  it("retire les caractères invisibles, et refuse ce qui n'en laisse aucun visible", () => {
    expect(parseCastBattletagInput("Vo​ix#2100")).toBe("Voix#2100");
    expect(() => parseCastBattletagInput("​​")).toThrow("INVALID_CAST_BATTLETAG");
  });

  it("refuse une saisie plus longue que la colonne, au lieu de la rogner en silence", () => {
    const long = "a".repeat(MAX_CAST_BATTLETAG_LENGTH + 1);
    expect(() => parseCastBattletagInput(long)).toThrow("INVALID_CAST_BATTLETAG");
    expect(parseCastBattletagInput("a".repeat(MAX_CAST_BATTLETAG_LENGTH))).toHaveLength(
      MAX_CAST_BATTLETAG_LENGTH,
    );
  });

  it("isValidCastBattletag dit la même chose sans lever", () => {
    expect(isValidCastBattletag("Voix#2100")).toBe(true);
    expect(isValidCastBattletag("")).toBe(true);
    expect(isValidCastBattletag("a".repeat(MAX_CAST_BATTLETAG_LENGTH + 1))).toBe(false);
  });
});

describe("casterStreamEditable", () => {
  it("le stream qu'un caster tient, jamais celui du staff", () => {
    expect(casterStreamEditable({ staff: false })).toBe(true);
    expect(casterStreamEditable({ staff: true })).toBe(false);
    expect(casterStreamEditable(null)).toBe(false);
    expect(casterStreamEditable(undefined)).toBe(false);
  });
});

describe("offersCastSettings", () => {
  it("rien à qui ne caste pas le match", () => {
    expect(offersCastSettings(match(), false, true)).toBe(false);
  });

  it("offerte au caster d'un match encore castable", () => {
    expect(offersCastSettings(match(), true, true)).toBe(true);
  });

  it("offersCastSettings_awaitingConfirmationUncast_stillOffersForRelease", () => {
    // Plus rien à régler, mais « Ne plus caster » vit dans la fenêtre : le
    // caster d'un match pas encore joué doit pouvoir se retirer.
    const awaiting = match({ status: "AWAITING_CONFIRMATION" as MatchStatus });
    expect(offersCastSettings(awaiting, true, false)).toBe(true);
  });

  it("offerte au caster d'un match joué tant qu'il reste la rediff", () => {
    const played = match({ status: "COMPLETED" as MatchStatus });
    expect(offersCastSettings(played, true, true)).toBe(true);
    // Sans la permission de diffusion, plus de rediff — et plus rien à régler.
    expect(offersCastSettings(played, true, false)).toBe(false);
  });

  it("offersCastSettings_noLivePermissionMatchToPlay_offersForReleaseOnly", () => {
    // Sans `live`, la fenêtre ne sert plus qu'au retrait — encore possible avant le match.
    expect(offersCastSettings(match({ liveTrigger: "AUTO" }), true, false)).toBe(true);
  });

  it("offersCastSettings_noLivePermissionPlayedStillMarked_notOffered", () => {
    // Joué et encore marqué : le staff y règlerait la diffusion, le caster sans `live` n'y peut rien.
    const marked = match({ status: "COMPLETED" as MatchStatus, forfeitTeamId: 10, liveTrigger: "MANUAL" });
    expect(offersCastSettings(marked, true, false)).toBe(false);
  });

  it("rien sur un match joué par forfait et jamais casté : aucune diffusion, aucune rediff", () => {
    const forfeit = match({ status: "COMPLETED" as MatchStatus, forfeitTeamId: 10 });
    expect(offersCastSettings(forfeit, true, true)).toBe(false);
  });

  it("offerte sur un match joué qui porte encore une diffusion, pour la retirer", () => {
    const configured = match({ status: "COMPLETED" as MatchStatus, forfeitTeamId: 10, liveTrigger: "MANUAL" });
    expect(offersCastSettings(configured, true, true)).toBe(true);
  });
});

describe("offersCastRelease", () => {
  it("« Ne plus caster » sauf sur un match terminé, que le serveur refuse de réécrire", () => {
    expect(offersCastRelease({ status: "READY" })).toBe(true);
    expect(offersCastRelease({ status: "AWAITING_CONFIRMATION" })).toBe(true);
    expect(offersCastRelease({ status: "COMPLETED" })).toBe(false);
  });
});
