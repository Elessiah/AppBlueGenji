import { describe, expect, it } from "@jest/globals";
import {
  CERTIFICATION_PROMPT_CLOSED_KEY,
  CERTIFICATION_PROMPT_OFF_PATH,
  LEGACY_CERTIFICATION_PROMPT_OFF_KEY,
  battletagRelevantFor,
  certificationPromptFor,
  certificationProfileHref,
  liveCertificationPrompt,
  forgetLegacyCertificationPromptOff,
  rememberCertificationPromptClosed,
  shouldOpenCertificationPrompt,
  teamHasContact,
} from "@/lib/shared/certification-prompt";
import type { TournamentState } from "@/lib/shared/types";
import { tournamentDetail } from "../../helpers/tournament-detail";
import { tournamentCard } from "../../helpers/tournament-card";

/**
 * Invitation à certifier Discord et BattleTag sur la fiche d'un tournoi
 * (`docs/features/CERTIFICATION_PROMPT.md`) : qui la reçoit, et le « Ne plus
 * voir » qui la tait.
 */

const NONE = { discordVerified: false, battletagVerified: false };
const BOTH = { discordVerified: true, battletagVerified: true };
const DISCORD_ONLY = { discordVerified: true, battletagVerified: false };
const BATTLETAG_ONLY = { discordVerified: false, battletagVerified: true };

/** Stockage en mémoire ; `failing` imite un stockage bloqué (navigation privée). */
function memoryStorage(initial: Record<string, string> = {}, failing = false) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key: string) {
      if (failing) throw new Error("SecurityError");
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (failing) throw new Error("QuotaExceededError");
      values.set(key, value);
    },
    removeItem(key: string) {
      if (failing) throw new Error("SecurityError");
      values.delete(key);
    },
  };
}

describe("certificationPromptFor", () => {
  it("invite un manager à qui manque l'une des deux, même si l'équipe a un contact", () => {
    for (const viewer of [NONE, DISCORD_ONLY, BATTLETAG_ONLY]) {
      expect(certificationPromptFor({ isManager: true, viewer, teamHasContact: true, battletagRelevant: true })).toEqual({
        reason: "MANAGER",
        ...viewer,
        battletagRelevant: true,
        teamHasContact: true,
      });
    }
  });

  it("invite un joueur dont l'équipe n'a aucun contact", () => {
    expect(certificationPromptFor({ isManager: false, viewer: NONE, teamHasContact: false, battletagRelevant: true })).toEqual({
      reason: "TEAM_WITHOUT_CONTACT",
      ...NONE,
      battletagRelevant: true,
      teamHasContact: false,
    });
  });

  it("le motif manager passe devant l'équipe sans contact", () => {
    expect(certificationPromptFor({ isManager: true, viewer: NONE, teamHasContact: false, battletagRelevant: true })?.reason).toBe("MANAGER");
  });

  it("certificationPromptFor_managerTeamWithoutContact_carriesTeamHasContactFalse : la modale peut dire au meneur que l'équipe est injoignable", () => {
    expect(
      certificationPromptFor({ isManager: true, viewer: NONE, teamHasContact: false, battletagRelevant: true })?.teamHasContact,
    ).toBe(false);
  });

  it("n'invite pas un joueur dont l'équipe a déjà un contact", () => {
    expect(certificationPromptFor({ isManager: false, viewer: NONE, teamHasContact: true, battletagRelevant: true })).toBeNull();
  });

  it("n'invite personne qui a déjà les deux certifications", () => {
    expect(certificationPromptFor({ isManager: true, viewer: BOTH, teamHasContact: false, battletagRelevant: true })).toBeNull();
    expect(certificationPromptFor({ isManager: false, viewer: BOTH, teamHasContact: false, battletagRelevant: true })).toBeNull();
  });
});

describe("Marvel Rivals : Discord seul", () => {
  it("le BattleTag ne compte qu'en Overwatch", () => {
    expect(battletagRelevantFor("OW")).toBe(true);
    expect(battletagRelevantFor("MR")).toBe(false);
  });

  it("n'invite pas un manager au Discord certifié, BattleTag absent", () => {
    expect(
      certificationPromptFor({ isManager: true, viewer: DISCORD_ONLY, teamHasContact: true, battletagRelevant: false }),
    ).toBeNull();
  });

  it("invite un manager sans Discord certifié, et le dit à la modale", () => {
    expect(
      certificationPromptFor({ isManager: true, viewer: BATTLETAG_ONLY, teamHasContact: true, battletagRelevant: false }),
    ).toEqual({ reason: "MANAGER", ...BATTLETAG_ONLY, battletagRelevant: false, teamHasContact: true });
  });

  it("invite le joueur d'une équipe sans contact, sans Discord certifié", () => {
    expect(
      certificationPromptFor({ isManager: false, viewer: NONE, teamHasContact: false, battletagRelevant: false })?.reason,
    ).toBe("TEAM_WITHOUT_CONTACT");
  });
});

describe("teamHasContact", () => {
  it("vaut vrai dès qu'un membre a l'une des deux certifications", () => {
    expect(teamHasContact([NONE, DISCORD_ONLY], true)).toBe(true);
    expect(teamHasContact([BATTLETAG_ONLY], true)).toBe(true);
  });

  it("vaut faux pour un roster sans rien de certifié, ou vide", () => {
    expect(teamHasContact([NONE, NONE], true)).toBe(false);
    expect(teamHasContact([], true)).toBe(false);
  });

  it("en Marvel Rivals, un BattleTag vérifié ne fait pas un contact : Discord seul", () => {
    expect(teamHasContact([BATTLETAG_ONLY], false)).toBe(false);
    expect(teamHasContact([BATTLETAG_ONLY, DISCORD_ONLY], false)).toBe(true);
  });
});

describe("fermeture pour l'onglet, et « Ne plus voir » qui vit sur le compte (EF-04)", () => {
  it("s'ouvre sur un onglet vierge", () => {
    expect(shouldOpenCertificationPrompt(memoryStorage())).toBe(true);
  });

  it("une fermeture la tait pour l'onglet seulement, valeur « 1 » sans identifiant", () => {
    const session = memoryStorage();
    rememberCertificationPromptClosed(session);
    expect([...session.values.entries()]).toEqual([[CERTIFICATION_PROMPT_CLOSED_KEY, "1"]]);
    expect(shouldOpenCertificationPrompt(session)).toBe(false);
    // Un nouvel onglet (session vierge) la rouvre.
    expect(shouldOpenCertificationPrompt(memoryStorage())).toBe(true);
  });

  it("l'ancienne clé locale du « Ne plus voir » n'est plus lue : elle ne tait plus rien", () => {
    expect(shouldOpenCertificationPrompt(memoryStorage({ [LEGACY_CERTIFICATION_PROMPT_OFF_KEY]: "1" }))).toBe(true);
  });

  it("efface l'ancienne clé locale, commune à tous les comptes du navigateur, sans toucher au reste", () => {
    const local = memoryStorage({ [LEGACY_CERTIFICATION_PROMPT_OFF_KEY]: "1", bg_other: "x" });
    forgetLegacyCertificationPromptOff(local);
    expect([...local.values.keys()]).toEqual(["bg_other"]);
    // Absente : sans effet.
    expect(() => forgetLegacyCertificationPromptOff(local)).not.toThrow();
  });

  it("le « Ne plus voir » se garde par la route du compte", () => {
    expect(CERTIFICATION_PROMPT_OFF_PATH).toBe("/api/profile/certification-prompt");
  });

  it("un stockage bloqué ou absent ne casse rien : la modale s'ouvre, la fermeture et l'effacement passent", () => {
    const blocked = memoryStorage({}, true);
    expect(shouldOpenCertificationPrompt(blocked)).toBe(true);
    expect(shouldOpenCertificationPrompt(null)).toBe(true);
    expect(() => rememberCertificationPromptClosed(blocked)).not.toThrow();
    expect(() => rememberCertificationPromptClosed(null)).not.toThrow();
    expect(() => forgetLegacyCertificationPromptOff(blocked)).not.toThrow();
    expect(() => forgetLegacyCertificationPromptOff(null)).not.toThrow();
  });

  it("ignore une valeur inattendue", () => {
    expect(shouldOpenCertificationPrompt(memoryStorage({ [CERTIFICATION_PROMPT_CLOSED_KEY]: "0" }))).toBe(true);
  });
});

it("mène au dialogue de certification Discord si le tag manque, sinon à « Applications connectées »", () => {
  expect(certificationProfileHref({ discordVerified: false })).toBe("/profil?certifier=discord");
  expect(certificationProfileHref({ discordVerified: true })).toBe("/profil#connexions");
});

describe("liveCertificationPrompt", () => {
  const prompt = { reason: "MANAGER", discordVerified: false, battletagVerified: true, battletagRelevant: true, teamHasContact: true } as const;
  const detail = (state: TournamentState, registered: boolean, certificationPrompt: typeof prompt | null = prompt) =>
    tournamentDetail({
      card: tournamentCard({ id: 5, state }),
      myTeamId: 42,
      certificationPrompt,
      registrations: registered
        ? [{ teamId: 42, teamName: "Équipe", logoUrl: null, seed: null, registeredAt: "2026-10-01T10:00:00.000Z", finalRank: null }]
        : [],
    });

  it("rejoue l'invitation tant que l'équipe est engagée dans un tournoi non clos", () => {
    expect(liveCertificationPrompt(detail("RUNNING", true), 5)).toEqual(prompt);
  });

  it("la tait pour un tournoi clos depuis, ou une équipe retirée", () => {
    expect(liveCertificationPrompt(detail("FINISHED", true), 5)).toBeNull();
    expect(liveCertificationPrompt(detail("RUNNING", false), 5)).toBeNull();
    expect(liveCertificationPrompt(detail("RUNNING", true, null), 5)).toBeNull();
  });

  it("fiche pas encore lue : rien de décidé", () => {
    expect(liveCertificationPrompt(undefined, 5)).toBeUndefined();
    expect(liveCertificationPrompt(null, 5)).toBeUndefined();
  });

  it("détail encore celui du tournoi précédent : rien de décidé", () => {
    expect(liveCertificationPrompt(detail("RUNNING", true), 6)).toBeUndefined();
  });
});
