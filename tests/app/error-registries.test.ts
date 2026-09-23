import { describe, expect, it } from "@jest/globals";

import { loginErrorMessage, oauthErrorMessage } from "@/app/connexion/_lib/login-errors";
import { connectionErrorMessage } from "@/app/(secured)/profil/connection-errors";
import { membershipErrorMessage, teamErrorMessage } from "@/app/(secured)/equipes/_lib/team-errors";
import { OAUTH_PROVIDERS, OAUTH_PROVIDER_SLUGS } from "@/lib/shared/oauth-providers";
import { LINK_REFUSALS } from "@/lib/shared/account-connections";

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
  "BOT_RESOLVE_TIMEOUT",
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

/**
 * Tout ce que les routes de **gestion** d'une équipe peuvent rendre :
 * `teams`, `teams/[id]` (+ `members`, `invitations`, `logo`, `claim`,
 * `transfer-ownership`), `invitations/[id]` (réponse et retrait), plus le code
 * que pose le client quand la requête n'aboutit pas.
 */
const TEAM_CODES = [
  ...MEMBERSHIP_CODES,
  "NETWORK_ERROR",
  "TEAM_ALREADY_DELETED",
  "MISSING_PSEUDO",
  "INVALID_PSEUDO",
  "USER_NOT_FOUND",
  "ALREADY_INVITED",
  "MISSING_USER_ID",
  "MEMBER_NOT_FOUND",
  "MISSING_ROLE",
  "CANNOT_KICK_OWNER",
  "OWNER_CANNOT_LEAVE",
  "INVALID_TEAM_NAME",
  "TEAM_NAME_ALREADY_USED",
  "INVALID_TEAM_FIELDS",
  "PLAYER_ACCOUNT_DELETED",
  "MEMBER_ACCOUNT_DELETED",
  "TEAM_TAG_TOO_SHORT",
  "TEAM_TAG_TOO_LONG",
  "TEAM_TAG_NOT_ALPHANUMERIC",
  "TEAM_TAG_ALREADY_USED",
  "TRANSFER_TO_SELF",
  "NOT_A_GHOST_TEAM",
  "FILE_MISSING",
  "IMAGE_TOO_LARGE",
  "IMAGE_FORMAT_INVALID",
  "IMAGE_DIMENSIONS_INVALID",
  "IMAGE_ANIMATED_NOT_SUPPORTED",
  "INVITATION_CANCEL_FAILED",
  "INVITATIONS_LOAD_FAILED",
  "TEAM_MEMBER_ADD_FAILED",
  "TEAM_INVITE_FAILED",
  "TEAM_MEMBER_REMOVE_FAILED",
  "TEAM_MEMBER_UPDATE_FAILED",
  "TEAM_UPDATE_FAILED",
  "TEAM_CREATE_FAILED",
  "GHOST_TEAM_CREATE_FAILED",
  "TEAMS_LOAD_FAILED",
  "TEAM_DELETE_FAILED",
  "TEAM_CLAIM_FAILED",
  "TEAM_OWNERSHIP_TRANSFER_FAILED",
  "LOGO_UPLOAD_FAILED",
  "LOGO_DELETE_FAILED",
];

/** Tout ce que `/api/profile/connections[/:provider]` et le rappel OAuth peuvent rendre. */
const CONNECTION_CODES = [
  "PROVIDER_ALREADY_LINKED",
  "IDENTITY_ALREADY_LINKED",
  "LAST_CONNECTION",
  "NOT_LINKED",
  "UNKNOWN_PROVIDER",
  "OAUTH_FAILED",
  "NOT_CONFIGURED",
  "LINK_FAILED",
  "PROFILE_NOT_FOUND",
  "UNAUTHORIZED",
];

/** Tous les motifs de refus que `lib/server/oauth-flow.ts` met dans `?error=`. */
const OAUTH_ERROR_KINDS = ["not_configured", "unavailable", "params", "state", "oauth", "session"];

/** Un jeton se reconnaît à sa forme : capitales, chiffres et tirets bas. */
const looksLikeToken = (message: string) => /^[A-Z][A-Z0-9_]*$/.test(message.trim());

/** Un code absent du registre rend cette phrase-ci, et elle ne dit rien. */
const UNKNOWN_CODE = "UN_CODE_QUE_PERSONNE_NE_CONNAIT";

describe.each([
  ["connexion", loginErrorMessage, LOGIN_CODES] as const,
  ["adhésion à une équipe", membershipErrorMessage, MEMBERSHIP_CODES] as const,
  ["gestion d'une équipe", teamErrorMessage, TEAM_CODES] as const,
  ["applications connectées", connectionErrorMessage, CONNECTION_CODES] as const,
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

/**
 * **Le registre OAuth prend deux entrées, pas une.**
 *
 * Le motif du refus (`?error=`) et le fournisseur (`?provider=`) arrivent
 * séparément, justement pour qu'il n'y ait pas une table par porte : la page
 * portait cinq codes écrits en dur, tous préfixés `google_`, soit quinze
 * phrases à tenir à jour le jour où la troisième porte s'ouvre. Le nom du
 * fournisseur doit donc apparaître dans la phrase, sans quoi le joueur ne sait
 * pas laquelle a échoué.
 */
describe("registre des refus — aller-retour OAuth", () => {
  it.each(OAUTH_ERROR_KINDS)("traduit « %s » par une phrase", (kind) => {
    const message = oauthErrorMessage(kind, "discord");

    expect(message).not.toBeNull();
    expect(looksLikeToken(message!)).toBe(false);
    expect(message!.length).toBeGreaterThan(10);
  });

  it.each([...OAUTH_PROVIDERS])("nomme le fournisseur %s dans le refus", (provider) => {
    const message = oauthErrorMessage("not_configured", OAUTH_PROVIDER_SLUGS[provider]);
    expect(message).toContain(provider === "GOOGLE" ? "Google" : provider === "DISCORD" ? "Discord" : "Blizzard");
  });

  it("reste lisible quand le fournisseur manque ou est inconnu", () => {
    // Un vieux lien, un paramètre perdu : la phrase ne doit pas s'en trouver
    // amputée.
    for (const slug of [null, undefined, "", "facebook"]) {
      const message = oauthErrorMessage("oauth", slug);
      expect(message).not.toBeNull();
      expect(message).not.toContain("undefined");
      expect(message).not.toContain("null");
    }
  });

  it("rend `null` sur un motif inconnu, pour ne rien afficher du tout", () => {
    // Ici le repli n'est **pas** une phrase générique : la page n'affiche un
    // toast que s'il y a un message. Un `?error=` fantaisiste dans l'URL ne doit
    // pas faire surgir une erreur inventée devant un visiteur qui n'a rien fait.
    expect(oauthErrorMessage("un_motif_inconnu", "google")).toBeNull();
    expect(oauthErrorMessage(null, "google")).toBeNull();
    expect(oauthErrorMessage("", "google")).toBeNull();
  });
});

/**
 * **Ce qui a le droit de voyager dans l'URL a une phrase à l'arrivée.**
 *
 * `LINK_REFUSALS` borne ce que le rappel OAuth écrit dans `?connection_error=`
 * — sans quoi le message d'une erreur `mysql2` finissait dans la barre
 * d'adresse. Le corollaire est que les deux listes doivent se recouvrir : un
 * motif autorisé à sortir sans phrase à l'arrivée ferait lire au joueur le repli
 * générique là où on sait quoi lui dire.
 */
describe("motifs de rattachement autorisés dans l'URL", () => {
  it.each([...LINK_REFUSALS])("« %s » a sa phrase dans le registre du profil", (code) => {
    expect(connectionErrorMessage(code)).not.toBe(connectionErrorMessage(UNKNOWN_CODE));
  });
});
