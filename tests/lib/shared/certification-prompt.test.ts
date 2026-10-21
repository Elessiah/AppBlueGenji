import { describe, expect, it } from "@jest/globals";
import {
  CERTIFICATION_PROFILE_HREF,
  CERTIFICATION_PROMPT_CLOSED_KEY,
  CERTIFICATION_PROMPT_OFF_KEY,
  certificationPromptFor,
  rememberCertificationPromptClosed,
  shouldOpenCertificationPrompt,
  teamHasContact,
} from "@/lib/shared/certification-prompt";

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
      expect(certificationPromptFor({ isManager: true, viewer, teamHasContact: true })).toEqual({
        reason: "MANAGER",
        ...viewer,
      });
    }
  });

  it("invite un joueur dont l'équipe n'a aucun contact", () => {
    expect(certificationPromptFor({ isManager: false, viewer: NONE, teamHasContact: false })).toEqual({
      reason: "TEAM_WITHOUT_CONTACT",
      ...NONE,
    });
  });

  it("le motif manager passe devant l'équipe sans contact", () => {
    expect(certificationPromptFor({ isManager: true, viewer: NONE, teamHasContact: false })?.reason).toBe("MANAGER");
  });

  it("n'invite pas un joueur dont l'équipe a déjà un contact", () => {
    expect(certificationPromptFor({ isManager: false, viewer: NONE, teamHasContact: true })).toBeNull();
  });

  it("n'invite personne qui a déjà les deux certifications", () => {
    expect(certificationPromptFor({ isManager: true, viewer: BOTH, teamHasContact: false })).toBeNull();
    expect(certificationPromptFor({ isManager: false, viewer: BOTH, teamHasContact: false })).toBeNull();
  });
});

describe("teamHasContact", () => {
  it("vaut vrai dès qu'un membre a l'une des deux certifications", () => {
    expect(teamHasContact([NONE, DISCORD_ONLY])).toBe(true);
    expect(teamHasContact([BATTLETAG_ONLY])).toBe(true);
  });

  it("vaut faux pour un roster sans rien de certifié, ou vide", () => {
    expect(teamHasContact([NONE, NONE])).toBe(false);
    expect(teamHasContact([])).toBe(false);
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

it("mène à « Applications connectées » du profil", () => {
  expect(CERTIFICATION_PROFILE_HREF).toBe("/profil#connexions");
});
