import { describe, expect, it } from "@jest/globals";

import { loginErrorMessage } from "@/app/connexion/_lib/login-errors";
import { membershipErrorMessage } from "@/app/(secured)/equipes/_lib/membership-errors";

/**
 * **Aucun jeton du serveur ne doit atteindre un toast.**
 *
 * Les deux registres traduisent les refus d'une route en une phrase française.
 * Ils sont nés du même défaut — un `return errorCode` en repli, qui affichait
 * `USER_ALREADY_IN_TEAM` ou `TOO_MANY_CODE_REQUESTS` en capitales — et se
 * vérifient de la même façon : **tout** code que la route peut rendre a sa
 * phrase, et l'inconnu retombe sur une phrase, jamais sur lui-même.
 *
 * La liste des codes est recopiée à la main, et c'est le but : elle vient des
 * routes, pas du registre, sinon le test ne dirait que « le registre contient ce
 * qu'il contient ».
 */

/** Tout ce que `/api/auth/discord/{request,verify}` peut rendre. */
const LOGIN_CODES = [
  "BOT_INTERNAL_UNREACHABLE",
  "BOT_INTERNAL_UNAUTHORIZED",
  "DISCORD_USER_NOT_FOUND",
  "DISCORD_DM_FAILED",
  "TOO_MANY_CODE_REQUESTS",
  "TOO_MANY_REQUESTS",
  "FAILED_TO_SEND_CODE",
  "INVALID_DISCORD_HANDLE",
  "INVALID_DISCORD_ID",
  "INVALID_CODE",
  "CODE_INVALID_OR_EXPIRED",
  "DISCORD_AUTH_FAILED",
];

/** Tout ce que `teams/[id]/{join,leave}` et `invitations/[id]` peuvent rendre. */
const MEMBERSHIP_CODES = [
  "UNAUTHORIZED",
  "INVALID_TEAM_ID",
  "INVALID_INVITATION_ID",
  "TEAM_NOT_FOUND",
  "TEAM_DELETED",
  "TEAM_NOT_JOINABLE",
  "USER_ALREADY_IN_TEAM",
  "ALREADY_REQUESTED",
  "NOT_A_MEMBER",
  "OWNER_MUST_TRANSFER",
  "FORBIDDEN",
  "INVITATION_NOT_FOUND",
  "INVITATION_NOT_PENDING",
  "TEAM_JOIN_FAILED",
  "TEAM_LEAVE_FAILED",
  "INVITATION_RESPOND_FAILED",
];

/** Un jeton se reconnaît à sa forme : capitales, chiffres et tirets bas. */
const looksLikeToken = (message: string) => /^[A-Z][A-Z0-9_]*$/.test(message.trim());

/** Un code absent du registre rend cette phrase-ci, et elle ne dit rien. */
const UNKNOWN_CODE = "UN_CODE_QUE_PERSONNE_NE_CONNAIT";

describe.each([
  ["connexion", loginErrorMessage, LOGIN_CODES] as const,
  ["adhésion à une équipe", membershipErrorMessage, MEMBERSHIP_CODES] as const,
])("registre des refus — %s", (_label, translate, codes) => {
  it.each(codes)("traduit %s par une phrase qui lui est propre", (code) => {
    const message = translate(code);

    expect(message).not.toBe(code);
    expect(looksLikeToken(message)).toBe(false);
    // **Et pas le repli générique.** Les deux registres retombent déjà sur une
    // phrase française : « ce n'est pas un jeton » est donc vrai d'un code
    // oublié comme d'un code traduit, et ne distingue rien. Ce qu'on exige ici,
    // c'est que le code soit réellement dans le registre — sans quoi retirer
    // `UNAUTHORIZED` laisserait ce fichier vert pendant qu'un joueur déconnecté
    // lit « L'opération a échoué » sans savoir qu'il doit se reconnecter.
    expect(message).not.toBe(translate(UNKNOWN_CODE));
    // Une phrase, pas une étiquette : lisible.
    expect(message.length).toBeGreaterThan(10);
  });

  it("retombe sur une phrase pour un code inconnu, jamais sur le code", () => {
    // Le repli d'origine rendait le code lui-même : le jour où le serveur en
    // ajoutait un, le joueur lisait un jeton.
    const message = translate(UNKNOWN_CODE);

    expect(message).not.toContain("UN_CODE");
    expect(looksLikeToken(message)).toBe(false);
  });

  it("retombe sur une phrase quand il n'y a pas de code du tout", () => {
    expect(looksLikeToken(translate(null))).toBe(false);
    expect(looksLikeToken(translate(undefined))).toBe(false);
    expect(looksLikeToken(translate(""))).toBe(false);
  });
});
