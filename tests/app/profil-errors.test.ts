import { describe, expect, it } from "@jest/globals";
import {
  avatarDeleteErrorMessage,
  avatarUploadErrorMessage,
  invitationResponseErrorMessage,
  profileErrorMessage,
  profileLoadErrorMessage,
} from "@/app/(secured)/profil/profile-errors";
import { ACCOUNT_DELETED_WRITE_MESSAGE } from "@/lib/shared/account-deletion";
import { PSEUDO_MAX_LENGTH } from "@/lib/shared/pseudo";
import { discordVerificationErrorMessage } from "@/app/(secured)/profil/discord-errors";

/**
 * Le registre de la **sauvegarde du profil**, distinct de celui de la
 * certification.
 *
 * Router les erreurs du profil vers l'autre faisait annoncer « La certification
 * a échoué » à un pseudo déjà pris, à une coupure réseau, à tout ce qui n'était
 * pas prévu. Un repli ne doit jamais affirmer une cause qu'il ne connaît pas.
 */
describe("profileErrorMessage", () => {
  it("traduit le refus du tag verrouillé", () => {
    const message = profileErrorMessage("DISCORD_TAG_LOCKED");
    expect(message).toContain("rattaché");
    expect(message).toContain("retire-le");
  });

  it("traduit le pseudo déjà pris sans parler de Discord", () => {
    const message = profileErrorMessage("PSEUDO_ALREADY_USED");
    expect(message).toContain("pseudo");
    expect(message).not.toMatch(/discord/i);
  });

  it("reste vague sur un code inconnu plutôt que d'inventer une cause", () => {
    const message = profileErrorMessage("ER_LOCK_DEADLOCK");
    expect(message).toBe("La sauvegarde a échoué. Réessaie dans un instant.");
    expect(message).not.toMatch(/certification/i);
  });

  it("ne laisse jamais sortir le code brut", () => {
    for (const code of ["ER_LOCK_DEADLOCK", "BOOM", null, undefined, ""]) {
      expect(profileErrorMessage(code)).not.toMatch(/[A-Z]{4,}_[A-Z]{4,}/);
    }
  });

  it("ne recouvre pas le registre de la certification", () => {
    // Deux écrans, deux consignes : le repli de l'un ne doit pas servir l'autre.
    expect(profileErrorMessage("BOOM")).not.toBe(discordVerificationErrorMessage("BOOM"));
  });

  it("est le **seul** registre à connaître le verrou du tag", () => {
    // `DISCORD_TAG_LOCKED` ne sort que de `PATCH /api/profile` ; le dialogue de
    // certification ne parle qu'à `/api/profile/discord`. Une seconde entrée
    // serait morte, et figerait une copie de la phrase que le premier
    // ajustement ferait diverger.
    expect(discordVerificationErrorMessage("DISCORD_TAG_LOCKED")).toBe(
      discordVerificationErrorMessage("BOOM"),
    );
  });

  it("traduit un tag d'un type inattendu sans laisser sortir de TypeError", () => {
    // Le corps du `PATCH` n'est qu'annoté : `{"discordPseudo": 123}` faisait
    // lever `.trim()`, et le message interne du `TypeError` ressortait dans le
    // corps du 400.
    expect(profileErrorMessage("INVALID_DISCORD_PSEUDO")).toContain("tag Discord");
  });
});

describe("profileLoadErrorMessage", () => {
  /**
   * Le même registre, avec le repli d'une **lecture**. « La sauvegarde a
   * échoué » annonçait à un visiteur qui vient d'ouvrir la page l'échec d'un
   * geste qu'il n'a pas fait.
   */
  it("ne parle pas de sauvegarde sur un code inconnu", () => {
    const message = profileLoadErrorMessage("ER_LOCK_DEADLOCK");
    expect(message).not.toMatch(/sauvegarde/i);
    expect(message).toMatch(/charger/i);
  });

  it("partage les codes nommés avec les écritures — les dupliquer les ferait diverger", () => {
    for (const code of ["UNAUTHORIZED", "PROFILE_NOT_FOUND"]) {
      expect(profileLoadErrorMessage(code)).toBe(profileErrorMessage(code));
    }
  });

  it("et ces codes partagés ne nomment aucun geste", () => {
    // Le partage ne vaut que si la phrase convient des deux côtés :
    // « Reconnecte-toi pour **modifier** ton profil » annonçait au visiteur qui
    // vient d'ouvrir la page une action qu'il n'a pas faite — le défaut même
    // que la séparation corrige, revenu par le partage.
    for (const code of ["UNAUTHORIZED", "PROFILE_NOT_FOUND"]) {
      const message = profileLoadErrorMessage(code);
      expect(message).not.toMatch(/modifier|sauvegarde|enregistr/i);
    }
  });

  it("ne laisse jamais sortir le code brut", () => {
    for (const code of ["ER_LOCK_DEADLOCK", "BOOM", null, undefined, ""]) {
      expect(profileLoadErrorMessage(code)).not.toMatch(/[A-Z]{4,}_[A-Z]{4,}/);
    }
  });
});

describe("profileErrorMessage — pseudo et compte supprimé", () => {
  it("dit chacun des trois refus du pseudo", () => {
    expect(profileErrorMessage("PSEUDO_EMPTY")).toMatch(/vide/);
    expect(profileErrorMessage("PSEUDO_TOO_LONG")).toContain(String(PSEUDO_MAX_LENGTH));
    // Un formulaire n'envoie que du texte : le cas n'arrive que par un appel
    // direct, la phrase ne suppose donc rien de ce qui a été saisi.
    expect(profileErrorMessage("INVALID_PSEUDO")).toMatch(/pseudo/i);
  });

  it("dit le compte supprimé au lieu de « la sauvegarde a échoué »", () => {
    // La sauvegarde levait la phrase déjà traduite, que ce registre ne
    // reconnaissait pas : la seule explication juste était remplacée par le
    // repli.
    expect(profileErrorMessage("ACCOUNT_DELETED")).toBe(ACCOUNT_DELETED_WRITE_MESSAGE);
  });

  it("ramène le message anglais d'une coupure réseau à son repli", () => {
    // `fetch` lève un `TypeError` dont le message arrive dans le même `catch`
    // que les codes du serveur.
    expect(profileErrorMessage("Failed to fetch")).toBe(profileErrorMessage("BOOM"));
  });

  it("ne se laisse pas tromper par la chaîne de prototypes", () => {
    expect(profileErrorMessage("constructor")).toBe(profileErrorMessage("BOOM"));
  });
});

describe("avatarUploadErrorMessage", () => {
  it("dit ce qu'il faut changer au fichier, dans les mots du logo d'équipe", () => {
    expect(avatarUploadErrorMessage("IMAGE_TOO_LARGE")).toMatch(/trop lourde/);
    expect(avatarUploadErrorMessage("IMAGE_FORMAT_INVALID")).toMatch(/PNG, JPEG ou WebP/);
    expect(avatarUploadErrorMessage("IMAGE_ANIMATED_NOT_SUPPORTED")).toMatch(/animées/);
  });

  it("nomme le geste dans son repli, pas une sauvegarde", () => {
    const message = avatarUploadErrorMessage("AVATAR_UPLOAD_FAILED");
    expect(message).toMatch(/avatar/i);
    expect(message).not.toMatch(/sauvegarde/i);
  });

  it("partage les codes nommés du profil", () => {
    for (const code of ["UNAUTHORIZED", "ACCOUNT_DELETED"]) {
      expect(avatarUploadErrorMessage(code)).toBe(profileErrorMessage(code));
    }
  });

  it("ne laisse jamais sortir le code brut", () => {
    for (const code of ["AVATAR_UPLOAD_FAILED", "EACCES", "BOOM", null, undefined, ""]) {
      expect(avatarUploadErrorMessage(code)).not.toMatch(/[A-Z]{4,}_[A-Z]{4,}|^[A-Z]+$/);
    }
  });
});

describe("avatarDeleteErrorMessage", () => {
  it("parle d'un retrait, pas d'un envoi", () => {
    const message = avatarDeleteErrorMessage("AVATAR_DELETE_FAILED");
    expect(message).toMatch(/supprimé/);
    expect(message).not.toBe(avatarUploadErrorMessage("AVATAR_UPLOAD_FAILED"));
  });

  it("n'annonce aucun refus d'image — il n'y a pas de fichier en jeu", () => {
    expect(avatarDeleteErrorMessage("IMAGE_TOO_LARGE")).toBe(
      avatarDeleteErrorMessage("AVATAR_DELETE_FAILED"),
    );
  });

  it("dit le compte supprimé", () => {
    expect(avatarDeleteErrorMessage("ACCOUNT_DELETED")).toBe(ACCOUNT_DELETED_WRITE_MESSAGE);
  });
});

describe("invitationResponseErrorMessage", () => {
  it("parle au joueur qui répond, à la deuxième personne", () => {
    // C'est le joueur invité qui clique : « ce joueur appartient déjà à une
    // équipe » le laisserait chercher de qui il s'agit.
    expect(invitationResponseErrorMessage("USER_ALREADY_IN_TEAM")).toMatch(/^Tu appartiens/);
  });

  it("dit les refus du domaine des équipes", () => {
    expect(invitationResponseErrorMessage("INVITATION_NOT_PENDING")).toMatch(/réponse/);
    expect(invitationResponseErrorMessage("TEAM_DELETED")).toMatch(/dissoute/);
  });

  it("nomme le geste quand le serveur n'a rien dit", () => {
    for (const code of [undefined, null, ""]) {
      expect(invitationResponseErrorMessage(code)).toMatch(/invitation/);
    }
  });

  it("ne laisse jamais sortir le code brut", () => {
    for (const code of ["INVITATION_RESPOND_FAILED", "BOOM", "Failed to fetch"]) {
      expect(invitationResponseErrorMessage(code)).not.toMatch(/[A-Z]{4,}_[A-Z]{4,}/);
    }
  });
});

describe("profileLoadErrorMessage — seuls les codes sans geste sont partagés", () => {
  it("n'annonce pas une modification perdue à qui vient d'ouvrir la page", () => {
    // La phrase du compte supprimé dit que « la modification n'a pas été
    // enregistrée » : juste pour une écriture, fausse pour une lecture.
    expect(profileLoadErrorMessage("ACCOUNT_DELETED")).toBe(profileLoadErrorMessage("BOOM"));
    expect(profileLoadErrorMessage("PSEUDO_ALREADY_USED")).toBe(profileLoadErrorMessage("BOOM"));
  });
});

describe("invitationResponseErrorMessage — repli du geste", () => {
  it("nomme le geste aussi sur un code inconnu ou une coupure réseau", () => {
    const expected = invitationResponseErrorMessage(undefined);
    expect(expected).toMatch(/invitation/);
    for (const code of ["Failed to fetch", "BOOM", "constructor"]) {
      expect(invitationResponseErrorMessage(code)).toBe(expected);
    }
  });
});
