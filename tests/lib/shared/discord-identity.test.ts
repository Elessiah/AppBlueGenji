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
  isCertifiableDiscordHandle,
  isDiscordNumericId,
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

describe("canViewDiscordTag — parties d'un même match (lancement)", () => {
  it("ouvre le tag certifié aux parties du match, sans aucun rôle", () => {
    // Joueurs des deux engagées et caster : c'est par ce tag qu'ils s'ajoutent
    // et créent le salon (`lib/shared/match-launch.ts`).
    expect(canViewDiscordTag(viewer([]), { ...verifiedSubject, sharesMatchLobby: true })).toBe(true);
    expect(
      canViewDiscordTag(viewer(["CASTER"]), { ...verifiedSubject, sharesMatchLobby: true }),
    ).toBe(true);
  });

  it("ne l'ouvre jamais sur un tag non certifié : la clause passe avant", () => {
    for (const roles of [[], ["ADMIN"], [...PLATFORM_ROLES]] as PlatformRole[][]) {
      expect(
        canViewDiscordTag(viewer(roles), { ...unverifiedSubject, sharesMatchLobby: true }),
      ).toBe(false);
    }
  });

  it("refuse un lecteur absent, même partie supposée d'un match", () => {
    expect(canViewDiscordTag(null, { ...verifiedSubject, sharesMatchLobby: true })).toBe(false);
  });

  it("ne vaut rien sans le fait : un joueur quelconque ne voit toujours rien", () => {
    expect(canViewDiscordTag(viewer([]), { ...verifiedSubject, sharesMatchLobby: false })).toBe(false);
  });
});

describe("canViewDiscordTag — rendu visible des autres joueurs", () => {
  it("ouvre le tag certifié à tout joueur connecté, sans aucun rôle", () => {
    expect(canViewDiscordTag(viewer([]), { ...verifiedSubject, visible: true })).toBe(true);
    expect(canViewDiscordTag(viewer(["CASTER"]), { ...verifiedSubject, visible: true })).toBe(true);
  });

  it("ouvre sans tournoi : le réglage ne dépend pas de l'arbitrage", () => {
    expect(
      canViewDiscordTag(viewer(["ARBITRE"]), {
        ...verifiedSubject,
        visible: true,
        inActiveTournament: false,
      }),
    ).toBe(true);
  });

  it("n'ouvre jamais un tag non certifié : la clause passe avant", () => {
    // Publier un tag que personne n'a prouvé ferait écrire à un inconnu au nom
    // d'un autre — la case cochée n'y change rien.
    for (const roles of [[], ["ADMIN"], [...PLATFORM_ROLES]] as PlatformRole[][]) {
      expect(canViewDiscordTag(viewer(roles), { ...unverifiedSubject, visible: true })).toBe(false);
    }
  });

  it("n'ouvre jamais au visiteur sans compte", () => {
    expect(canViewDiscordTag(null, { ...verifiedSubject, visible: true })).toBe(false);
    expect(canViewDiscordTag(undefined, { ...verifiedSubject, visible: true })).toBe(false);
  });

  it("case décochée : un joueur quelconque ne voit rien, l'organisation garde son accès", () => {
    const hidden = { ...verifiedSubject, visible: false };
    expect(canViewDiscordTag(viewer([]), hidden)).toBe(false);
    expect(canViewDiscordTag(viewer(["ADMIN"]), hidden)).toBe(true);
    expect(canViewDiscordTag(viewer(["ARBITRE"]), { ...hidden, inActiveTournament: true })).toBe(true);
  });

  it("visibleDiscordTag rend le tag au joueur quelconque seulement si la case est cochée", () => {
    expect(visibleDiscordTag("tag", viewer([]), { ...verifiedSubject, visible: true })).toBe("tag");
    expect(visibleDiscordTag("tag", viewer([]), verifiedSubject)).toBeNull();
    expect(visibleDiscordTag(null, viewer([]), { ...verifiedSubject, visible: true })).toBeNull();
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

  it("nomment les parties d'un match et la durée de l'exposition", () => {
    const joined = DISCORD_VERIFICATION_EXPOSURE.join(" ").toLowerCase();
    expect(joined).toContain("caster de ton match");
    expect(joined).toContain("le temps de la rencontre");
  });

  it("disent que rien n'est public", () => {
    const joined = DISCORD_VERIFICATION_EXPOSURE.join(" ").toLowerCase();
    expect(joined).toContain("publique");
  });

  it("disent que les autres joueurs ne le voient que sur choix du joueur", () => {
    // La certification ouvre le tag à l'organisation, pas aux joueurs : la
    // phrase qui disait « ni pour les autres joueurs du site » serait devenue
    // fausse le jour où la case existe.
    const joined = DISCORD_VERIFICATION_EXPOSURE.join(" ").toLowerCase();
    expect(joined).toContain("autres joueurs");
    expect(joined).toContain("rends visible");
    expect(joined).not.toContain("ni pour les autres joueurs");
  });

  it("donnent une raison, pas seulement une liste", () => {
    expect(DISCORD_VERIFICATION_PURPOSE.length).toBeGreaterThan(20);
    expect(DISCORD_VERIFICATION_PURPOSE.toLowerCase()).toContain("tournoi");
  });
});

/**
 * Un identifiant numérique n'est pas un tag.
 *
 * Le prédicat a **deux** appelants de part et d'autre de la frontière :
 * `normalizeDiscordHandle` (serveur, qui décide ce qui s'écrit en base) et la
 * deuxième étape de `/connexion` (client, qui annonce l'exposition). C'est la
 * raison de le sortir ici : deux copies auraient divergé en une **phrase
 * fausse** — l'écran promettant une certification que le serveur refuse.
 */
describe("isDiscordNumericId / isCertifiableDiscordHandle", () => {
  it("reconnaît un identifiant Discord, `@` et espaces compris", () => {
    for (const raw of ["123456789012345678", " 123456789012345678 ", "@123456789012345678"]) {
      expect(isDiscordNumericId(raw)).toBe(true);
      expect(isCertifiableDiscordHandle(raw)).toBe(false);
    }
  });

  it("laisse passer un pseudo, même chiffré à moitié", () => {
    for (const raw of ["keryan", "@keryan", "n0va", "1234"]) {
      // « 1234 » : quatre chiffres sont sous le plancher d'un identifiant Discord,
      // c'est donc un pseudo — improbable, mais certifiable.
      expect(isDiscordNumericId(raw)).toBe(false);
      expect(isCertifiableDiscordHandle(raw)).toBe(true);
    }
  });

  it("ne certifie pas le vide", () => {
    for (const raw of ["", "   ", "@", null, undefined]) {
      expect(isCertifiableDiscordHandle(raw)).toBe(false);
    }
  });
});
