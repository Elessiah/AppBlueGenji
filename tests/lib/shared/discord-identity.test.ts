import { describe, expect, it } from "@jest/globals";
import {
  canSeeDiscordVerification,
  canViewDiscordTag,
  tournamentGrantsContactAccess,
  discordVerificationNeedsCode,
  DISCORD_VERIFICATION_EXPOSURE,
  DISCORD_VERIFICATION_PURPOSE,
  visibleDiscordTag,
  type DiscordTagViewer,
} from "@/lib/shared/discord-identity";
import { PLATFORM_ROLES, type PlatformRole } from "@/lib/shared/permissions";

/**
 * Le public du tag Discord.
 *
 * Deux propriétés portent tout le reste, et ce sont elles que ces tests
 * défendent : **un tag non certifié n'est visible de personne** (c'est la clause
 * qui protège les comptes ayant saisi leur tag sous le régime « visible de moi
 * seul »), et **l'arbitrage ne le voit que pendant un tournoi vivant**.
 *
 * La première est vérifiée sur *tous* les rôles de la plateforme, pas seulement
 * sur l'administrateur : la panne qu'on redoute est un rôle ajouté demain qui
 * passerait devant la clause. Voir `docs/AUTHORIZATION_RULES.md` §2.4.
 */

const OWNER_ID = 7;
const READER_ID = 99;

function viewer(roles: PlatformRole[], overrides: Partial<DiscordTagViewer> = {}): DiscordTagViewer {
  return { id: READER_ID, roles, isAdmin: roles.includes("ADMIN"), ...overrides };
}

const verifiedSubject = { userId: OWNER_ID, verified: true };
const unverifiedSubject = { userId: OWNER_ID, verified: false };

describe("canViewDiscordTag — le titulaire", () => {
  it("voit son tag, certifié ou non", () => {
    for (const verified of [true, false]) {
      expect(
        canViewDiscordTag({ id: OWNER_ID }, { userId: OWNER_ID, verified }),
      ).toBe(true);
    }
  });

  it("ne dépend d'aucun rôle : un compte sans rôle voit le sien", () => {
    expect(canViewDiscordTag({ id: OWNER_ID, roles: [] }, verifiedSubject)).toBe(true);
  });
});

describe("canViewDiscordTag — un tag non certifié n'est visible de personne", () => {
  it.each(PLATFORM_ROLES)("refuse le rôle %s", (role) => {
    expect(canViewDiscordTag(viewer([role]), unverifiedSubject)).toBe(false);
  });

  it("refuse l'administrateur même sur un joueur engagé dans un tournoi", () => {
    // Le cas qui compte : l'administrateur a tous les droits, et pourtant non.
    // C'est la promesse faite aux comptes d'avant la certification.
    expect(
      canViewDiscordTag(viewer(["ADMIN"]), {
        userId: OWNER_ID,
        verified: false,
        inActiveTournament: true,
      }),
    ).toBe(false);
  });

  it("refuse le cumul de tous les rôles à la fois", () => {
    expect(canViewDiscordTag(viewer([...PLATFORM_ROLES]), unverifiedSubject)).toBe(false);
  });
});

describe("canViewDiscordTag — tag certifié", () => {
  it("accorde l'administrateur en tout temps, tournoi ou pas", () => {
    expect(canViewDiscordTag(viewer(["ADMIN"]), verifiedSubject)).toBe(true);
    expect(
      canViewDiscordTag(viewer(["ADMIN"]), { ...verifiedSubject, inActiveTournament: true }),
    ).toBe(true);
  });

  it("n'accorde l'arbitre que pendant un tournoi vivant", () => {
    expect(canViewDiscordTag(viewer(["ARBITRE"]), verifiedSubject)).toBe(false);
    expect(
      canViewDiscordTag(viewer(["ARBITRE"]), { ...verifiedSubject, inActiveTournament: true }),
    ).toBe(true);
  });

  it("refuse le cast, même pendant un tournoi : diffuser n'est pas joindre", () => {
    expect(
      canViewDiscordTag(viewer(["CASTER"]), { ...verifiedSubject, inActiveTournament: true }),
    ).toBe(false);
  });

  it("refuse les rôles sans rapport et le compte sans rôle", () => {
    for (const roles of [["COMMUNITY_MANAGER"], ["RECRUTEUR"], []] as PlatformRole[][]) {
      expect(
        canViewDiscordTag(viewer(roles), { ...verifiedSubject, inActiveTournament: true }),
      ).toBe(false);
    }
  });

  it("refuse un lecteur absent", () => {
    expect(canViewDiscordTag(null, verifiedSubject)).toBe(false);
    expect(canViewDiscordTag(undefined, verifiedSubject)).toBe(false);
  });

  it("suit `isAdmin` même si la liste de rôles ne le dit pas", () => {
    // `can()` tient l'invariant « admin = tous les droits » indépendamment de
    // `roles` ; la règle du tag doit en hériter, pas le réimplémenter.
    expect(canViewDiscordTag({ id: READER_ID, isAdmin: true }, verifiedSubject)).toBe(true);
  });
});

describe("visibleDiscordTag", () => {
  it("rend le tag à qui y a droit", () => {
    expect(visibleDiscordTag("keryan", viewer(["ADMIN"]), verifiedSubject)).toBe("keryan");
  });

  it("rend null à qui n'y a pas droit, plutôt que de laisser l'appelant décider", () => {
    expect(visibleDiscordTag("keryan", viewer(["CASTER"]), verifiedSubject)).toBeNull();
  });

  it("rend null sur un tag absent, sans consulter la règle", () => {
    for (const tag of [null, undefined, ""]) {
      expect(visibleDiscordTag(tag, viewer(["ADMIN"]), verifiedSubject)).toBeNull();
    }
  });

  it("rend son tag au titulaire même non certifié", () => {
    expect(visibleDiscordTag("keryan", { id: OWNER_ID }, unverifiedSubject)).toBe("keryan");
  });
});

describe("discordVerificationNeedsCode", () => {
  it("demande un code quand aucun identifiant Discord n'est rattaché", () => {
    // Le compte Google : rien n'a été prouvé, il faut le faire.
    for (const linked of [null, undefined, ""]) {
      expect(discordVerificationNeedsCode(linked)).toBe(true);
    }
  });

  it("n'en demande pas quand la preuve existe déjà", () => {
    // Le compte né par Discord a prouvé son identifiant en ouvrant sa session :
    // redemander un code rejouerait une preuve qu'on détient.
    expect(discordVerificationNeedsCode("900000000000000001")).toBe(false);
  });
});

describe("canSeeDiscordVerification", () => {
  /**
   * Deux faits, deux publics — et c'est la distinction qui porte tout : le
   * **tag** dit comment joindre le joueur (coordonnée, filtrée), la
   * **certification** dit seulement qu'il est joignable (état, annonçable).
   */
  it("s'annonce à tout le monde : elle ne nomme personne", () => {
    expect(canSeeDiscordVerification()).toBe(true);
  });

  it("ne rend pas le tag pour autant", () => {
    // La garde du tag reste entière : « Masqué ✅ » montre l'état, pas la
    // coordonnée.
    expect(visibleDiscordTag("keryan", viewer([]), verifiedSubject)).toBeNull();
  });
});

describe("tournamentGrantsContactAccess", () => {
  it("ouvre l'accès tant que le tournoi n'est pas clos", () => {
    for (const state of ["UPCOMING", "REGISTRATION", "RUNNING"] as const) {
      expect(tournamentGrantsContactAccess(state)).toBe(true);
    }
  });

  it("le ferme à la clôture : le besoin naît du tournoi et s'éteint avec lui", () => {
    expect(tournamentGrantsContactAccess("FINISHED")).toBe(false);
  });
});

describe("les textes de consentement", () => {
  it("énoncent les deux publics et la façon d'annuler", () => {
    const joined = DISCORD_VERIFICATION_EXPOSURE.join(" ").toLowerCase();
    expect(joined).toContain("administrateur");
    expect(joined).toContain("arbitre");
    // Le joueur doit lire comment revenir en arrière avant d'avancer : la
    // certification se défait en modifiant le tag, et nulle part ailleurs.
    expect(joined).toContain("modifiant ton tag");
  });

  it("disent que rien n'est public", () => {
    const joined = DISCORD_VERIFICATION_EXPOSURE.join(" ").toLowerCase();
    expect(joined).toContain("publique");
  });

  it("donnent une raison, pas seulement une liste", () => {
    expect(DISCORD_VERIFICATION_PURPOSE.length).toBeGreaterThan(20);
    expect(DISCORD_VERIFICATION_PURPOSE.toLowerCase()).toContain("tournoi");
  });
});
