import { describe, expect, it } from "@jest/globals";
import {
  CERTIFICATION_PROMPT_CLOSED_KEY,
  CERTIFICATION_PROMPT_OFF_KEY,
  battletagRelevantFor,
  certificationPromptFor,
  certificationProfileHref,
  certificationPromptStep,
  liveCertificationPrompt,
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
  };
}

describe("certificationPromptFor", () => {
  it("invite un manager à qui manque l'une des deux, même si l'équipe a un contact", () => {
    for (const viewer of [NONE, DISCORD_ONLY, BATTLETAG_ONLY]) {
      expect(certificationPromptFor({ isManager: true, viewer, teamHasContact: true, battletagRelevant: true })).toEqual({
        reason: "MANAGER",
        ...viewer,
        battletagRelevant: true,
      });
    }
  });

  it("invite un joueur dont l'équipe n'a aucun contact", () => {
    expect(certificationPromptFor({ isManager: false, viewer: NONE, teamHasContact: false, battletagRelevant: true })).toEqual({
      reason: "TEAM_WITHOUT_CONTACT",
      ...NONE,
      battletagRelevant: true,
    });
  });

  it("le motif manager passe devant l'équipe sans contact", () => {
    expect(certificationPromptFor({ isManager: true, viewer: NONE, teamHasContact: false, battletagRelevant: true })?.reason).toBe("MANAGER");
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
    ).toEqual({ reason: "MANAGER", ...BATTLETAG_ONLY, battletagRelevant: false });
  });

  it("invite le joueur d'une équipe sans contact, sans Discord certifié", () => {
    expect(
      certificationPromptFor({ isManager: false, viewer: NONE, teamHasContact: false, battletagRelevant: false })?.reason,
    ).toBe("TEAM_WITHOUT_CONTACT");
  });
});

describe("certificationPromptStep", () => {
  const ready = { allowed: true, otherModalOpen: false };

  it("ouvre une invitation due, sans autre modale", () => {
    expect(certificationPromptStep(ready)).toBe("OPEN");
  });

  it("une autre modale déjà ouverte l'écarte (pas d'attente qui la ferait surgir au départ d'un match)", () => {
    expect(certificationPromptStep({ ...ready, otherModalOpen: true })).toBe("SKIP");
  });

  it("se décide sans ouvrir après « Ne plus voir » ou une fermeture dans l'onglet", () => {
    expect(certificationPromptStep({ ...ready, allowed: false })).toBe("SKIP");
    expect(certificationPromptStep({ allowed: false, otherModalOpen: true })).toBe("SKIP");
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

describe("« Ne plus voir » et fermeture", () => {
  it("s'ouvre sur un navigateur vierge", () => {
    expect(shouldOpenCertificationPrompt(memoryStorage(), memoryStorage())).toBe(true);
  });

  it("une fermeture simple la tait pour l'onglet seulement", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    rememberCertificationPromptClosed(local, session, false);
    expect(session.values.get(CERTIFICATION_PROMPT_CLOSED_KEY)).toBe("1");
    expect(local.values.has(CERTIFICATION_PROMPT_OFF_KEY)).toBe(false);
    expect(shouldOpenCertificationPrompt(local, session)).toBe(false);
    // Un nouvel onglet (session vierge) la rouvre.
    expect(shouldOpenCertificationPrompt(local, memoryStorage())).toBe(true);
  });

  it("« Ne plus voir » la tait pour de bon, nouvel onglet compris", () => {
    const local = memoryStorage();
    rememberCertificationPromptClosed(local, memoryStorage(), true);
    expect(local.values.get(CERTIFICATION_PROMPT_OFF_KEY)).toBe("1");
    expect(shouldOpenCertificationPrompt(local, memoryStorage())).toBe(false);
  });

  it("ne garde que la valeur « 1 », sans identifiant de personne", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    rememberCertificationPromptClosed(local, session, true);
    expect([...local.values.values(), ...session.values.values()]).toEqual(["1", "1"]);
  });

  it("un stockage bloqué ou absent ne casse rien : la modale s'ouvre, la fermeture passe", () => {
    const blocked = memoryStorage({}, true);
    expect(shouldOpenCertificationPrompt(blocked, blocked)).toBe(true);
    expect(shouldOpenCertificationPrompt(null, null)).toBe(true);
    expect(() => rememberCertificationPromptClosed(blocked, blocked, true)).not.toThrow();
    expect(() => rememberCertificationPromptClosed(null, null, true)).not.toThrow();
  });

  it("ignore une valeur inattendue", () => {
    expect(shouldOpenCertificationPrompt(memoryStorage({ [CERTIFICATION_PROMPT_OFF_KEY]: "0" }), memoryStorage())).toBe(true);
  });
});

it("mène à la section « Discord » si le tag manque, sinon à « Applications connectées »", () => {
  expect(certificationProfileHref({ discordVerified: false })).toBe("/profil#discord");
  expect(certificationProfileHref({ discordVerified: true })).toBe("/profil#connexions");
});

describe("liveCertificationPrompt", () => {
  const prompt = { reason: "MANAGER", discordVerified: false, battletagVerified: true, battletagRelevant: true } as const;
  const detail = (state: TournamentState, registered: boolean, certificationPrompt: typeof prompt | null = prompt) =>
    tournamentDetail({
      card: tournamentCard({ state }),
      myTeamId: 42,
      certificationPrompt,
      registrations: registered
        ? [{ teamId: 42, teamName: "Équipe", logoUrl: null, seed: null, registeredAt: "2026-10-01T10:00:00.000Z", finalRank: null }]
        : [],
    });

  it("rejoue l'invitation tant que l'équipe est engagée dans un tournoi non clos", () => {
    expect(liveCertificationPrompt(detail("RUNNING", true))).toEqual(prompt);
  });

  it("la tait pour un tournoi clos depuis, ou une équipe retirée", () => {
    expect(liveCertificationPrompt(detail("FINISHED", true))).toBeNull();
    expect(liveCertificationPrompt(detail("RUNNING", false))).toBeNull();
    expect(liveCertificationPrompt(detail("RUNNING", true, null))).toBeNull();
  });

  it("fiche pas encore lue : rien de décidé", () => {
    expect(liveCertificationPrompt(undefined)).toBeUndefined();
    expect(liveCertificationPrompt(null)).toBeUndefined();
  });
});
