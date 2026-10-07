import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/oauth-state");
jest.mock("@/lib/server/account-identities");
jest.mock("@/lib/server/google-oauth");
jest.mock("@/lib/server/discord-oauth");
jest.mock("@/lib/server/blizzard-oauth");

import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { completeOAuth, startOAuth } from "@/lib/server/oauth-flow";
import { createSession, getCurrentUser } from "@/lib/server/auth";
import { consumeOAuthState, saveOAuthState } from "@/lib/server/oauth-state";
import { createOrGetOAuthUser, linkOAuthIdentity } from "@/lib/server/account-identities";
import { buildGoogleAuthorizationUrl, fetchGoogleUser, getAppBaseUrl } from "@/lib/server/google-oauth";
import {
  buildDiscordAuthorizationUrl,
  discordAvatarUrl,
  fetchDiscordUser,
} from "@/lib/server/discord-oauth";
import { buildBlizzardAuthorizationUrl, fetchBlizzardUser } from "@/lib/server/blizzard-oauth";
import type { OAuthProvider } from "@/lib/shared/oauth-providers";
import { AccountSuspendedError } from "@/lib/server/account-suspensions";
import { SUSPENSION_NOTICE_COOKIE, parseSuspensionNotice } from "@/lib/shared/account-suspension";
import { authUser } from "../../helpers/auth-user";

/**
 * **L'aller-retour OAuth, écrit une fois pour trois portes.**
 *
 * Ce qui est vérifié ici n'est pas « Google marche » mais que les trois portes
 * partagent la même mécanique — donc les mêmes garde-fous. Trois copies
 * auraient divergé sur le seul point où la divergence ne se voit pas : le
 * contrôle du `state`, la vérification que l'état a bien été émis pour *cette*
 * porte, le refiltrage de la destination à la sortie du cookie, et la
 * différence entre ouvrir une session et rattacher.
 *
 * Le piège que ferme le contrôle du fournisseur : un seul cookie d'état sert les
 * trois portes (on n'en ouvre qu'une à la fois). Sans ce contrôle, un état
 * obtenu sur la porte Google serait recevable sur le rappel de Blizzard, donc un
 * code d'autorisation Blizzard échangé sur une intention Google.
 */

const STATE = "01".repeat(24);

const request = (url: string) => new NextRequest(url);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(crypto, "randomBytes").mockImplementation(() => Buffer.alloc(24, 1));
  jest.mocked(getAppBaseUrl).mockReturnValue("http://localhost:3000");
  jest.mocked(buildGoogleAuthorizationUrl).mockReturnValue("https://accounts.google.test/auth");
  jest.mocked(buildDiscordAuthorizationUrl).mockReturnValue("https://discord.test/auth");
  jest.mocked(buildBlizzardAuthorizationUrl).mockReturnValue("https://blizzard.test/auth");
  jest.mocked(saveOAuthState).mockResolvedValue(undefined);
  jest.mocked(createSession).mockResolvedValue(undefined);
  jest.mocked(createOrGetOAuthUser).mockResolvedValue(7);
  jest.mocked(linkOAuthIdentity).mockResolvedValue("LINKED");
  jest.mocked(getCurrentUser).mockResolvedValue(null);
  jest.mocked(discordAvatarUrl).mockReturnValue("https://cdn.discord.test/a.png");
});

describe("startOAuth", () => {
  it.each<[OAuthProvider, string]>([
    ["GOOGLE", "https://accounts.google.test/auth"],
    ["DISCORD", "https://discord.test/auth"],
    ["BLIZZARD", "https://blizzard.test/auth"],
  ])("envoie chez %s et scelle l'état", async (provider, expected) => {
    const response = await startOAuth(
      request("http://localhost:3000/api/auth/x/start?redirect=%2Ftournois"),
      provider,
    );

    expect(response.headers.get("location")).toBe(expected);
    expect(saveOAuthState).toHaveBeenCalledWith({
      provider,
      state: STATE,
      redirectTo: "/tournois",
      intent: "LOGIN",
      termsAccepted: false,
    });
  });

  it("scelle l'acceptation des conditions d'utilisation, et seulement `terms=1`", async () => {
    await startOAuth(request("http://localhost:3000/api/auth/x/start?terms=1"), "GOOGLE");
    expect(saveOAuthState).toHaveBeenLastCalledWith(expect.objectContaining({ termsAccepted: true }));

    await startOAuth(request("http://localhost:3000/api/auth/x/start?terms=true"), "GOOGLE");
    expect(saveOAuthState).toHaveBeenLastCalledWith(expect.objectContaining({ termsAccepted: false }));
  });

  it("filtre la destination avant de l'écrire dans le cookie", async () => {
    // Une redirection ouverte est l'appât classique du hameçonnage : le lien
    // porte le vrai domaine, la vraie page de connexion, et n'emmène ailleurs
    // qu'une fois la confiance acquise.
    await startOAuth(
      request("http://localhost:3000/api/auth/x/start?redirect=https%3A%2F%2Fexemple.invalid"),
      "DISCORD",
    );

    expect(saveOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({ redirectTo: "/tournois" }),
    );
  });

  it("refuse un rattachement sans session, sans promener personne chez le fournisseur", async () => {
    const response = await startOAuth(
      request("http://localhost:3000/api/auth/x/start?intent=link"),
      "DISCORD",
    );

    expect(saveOAuthState).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=session&provider=discord",
    );
  });

  it("scelle l'intention de rattachement quand la session est là", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));

    await startOAuth(request("http://localhost:3000/api/auth/x/start?intent=link"), "BLIZZARD");

    expect(saveOAuthState).toHaveBeenCalledWith(expect.objectContaining({ intent: "LINK" }));
  });

  it("ramène un **rattachement** raté au profil, pas à la page de connexion", async () => {
    // Celui qui clique « Rattacher » est connecté et vient de la page de son
    // compte : l'envoyer sur `/connexion` lui ferait croire que sa session a
    // sauté, et lui ferait perdre l'écran où il était.
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
    jest.mocked(buildBlizzardAuthorizationUrl).mockImplementation(() => {
      throw new Error("Missing BLIZZARD_CLIENT_ID");
    });

    const response = await startOAuth(
      request("http://localhost:3000/api/auth/x/start?intent=link"),
      "BLIZZARD",
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profil?connection_error=NOT_CONFIGURED&provider=blizzard",
    );
  });

  it("nomme la configuration manquante plutôt que d'inviter à réessayer", async () => {
    // Rien à réessayer : le bouton ne marchera pas tant que le `.env` n'est pas
    // rempli, et dire « réessaie » serait mentir.
    jest.mocked(buildDiscordAuthorizationUrl).mockImplementation(() => {
      throw new Error("Missing DISCORD_CLIENT_SECRET");
    });

    const response = await startOAuth(request("http://localhost:3000/api/auth/x/start"), "DISCORD");

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=not_configured&provider=discord",
    );
    expect(saveOAuthState).not.toHaveBeenCalled();
  });
});

describe("completeOAuth — contrôles d'état", () => {
  const callback = (provider: "GOOGLE" | "DISCORD" | "BLIZZARD", query = `?code=abc&state=${STATE}`) =>
    completeOAuth(request(`http://localhost:3000/api/auth/x/callback${query}`), provider);

  it("refuse un rappel sans code ni état", async () => {
    jest.mocked(consumeOAuthState).mockResolvedValue(null);

    const response = await callback("GOOGLE", "");

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=params&provider=google",
    );
  });

  it("refuse un état qui ne correspond pas", async () => {
    jest.mocked(consumeOAuthState).mockResolvedValue({
      provider: "GOOGLE",
      state: "un-autre-etat",
      redirectTo: "/tournois",
      intent: "LOGIN",
      termsAccepted: true,
    });

    const response = await callback("GOOGLE");

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=state&provider=google",
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  it("refuse un état émis pour **une autre porte**", async () => {
    // Le cookie est unique pour les trois fournisseurs : c'est ce contrôle-ci,
    // et lui seul, qui empêche de les confondre.
    jest.mocked(consumeOAuthState).mockResolvedValue({
      provider: "GOOGLE",
      state: STATE,
      redirectTo: "/tournois",
      intent: "LOGIN",
      termsAccepted: true,
    });

    const response = await callback("BLIZZARD");

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=state&provider=blizzard",
    );
    expect(fetchBlizzardUser).not.toHaveBeenCalled();
  });

  const linkState = (provider: OAuthProvider, state = STATE) => ({
    provider,
    state,
    redirectTo: "/profil",
    intent: "LINK" as const,
    termsAccepted: false,
  });

  it("ramène au profil un **rattachement** annulé chez le fournisseur", async () => {
    // Rappel sans `code` : le joueur a refusé l'autorisation. Il était sur
    // `/profil`, il y revient — pas sur `/connexion`.
    jest.mocked(consumeOAuthState).mockResolvedValue(linkState("DISCORD"));

    const response = await callback("DISCORD", `?error=access_denied&state=${STATE}`);

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profil?connection_error=LINK_CANCELLED&provider=discord",
    );
    expect(linkOAuthIdentity).not.toHaveBeenCalled();
  });

  it("ramène au profil un rattachement revenu avec un autre état que celui émis", async () => {
    jest.mocked(consumeOAuthState).mockResolvedValue(linkState("DISCORD", "un-autre-etat"));

    const response = await callback("DISCORD");

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profil?connection_error=LINK_STATE_MISMATCH&provider=discord",
    );
    expect(linkOAuthIdentity).not.toHaveBeenCalled();
  });

  it("ne tient pas pour un rattachement l'état émis pour une autre porte", async () => {
    // L'intention n'est crue que sur la porte qui l'a émise.
    jest.mocked(consumeOAuthState).mockResolvedValue(linkState("GOOGLE"));

    const response = await callback("BLIZZARD", "");

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=params&provider=blizzard",
    );
  });

  it("consomme le cookie même quand le rappel est inexploitable", async () => {
    // Un état qui a échoué ne doit pas rester rejouable dix minutes durant.
    jest.mocked(consumeOAuthState).mockResolvedValue(null);

    await callback("GOOGLE", "");

    expect(consumeOAuthState).toHaveBeenCalledTimes(1);
  });
});

describe("completeOAuth — connexion", () => {
  const login = (provider: "GOOGLE" | "DISCORD" | "BLIZZARD") => {
    jest.mocked(consumeOAuthState).mockResolvedValue({
      provider,
      state: STATE,
      redirectTo: "/tournois",
      intent: "LOGIN",
      termsAccepted: true,
    });
    return completeOAuth(
      request(`http://localhost:3000/api/auth/x/callback?code=abc&state=${STATE}`),
      provider,
    );
  };

  it("ouvre la session Google et suit la destination", async () => {
    jest.mocked(fetchGoogleUser).mockResolvedValue({
      sub: "sub-1",
      picture: "https://exemple.test/a.png",
    });

    const response = await login("GOOGLE");

    expect(createOrGetOAuthUser).toHaveBeenCalledWith(
      {
        provider: "GOOGLE",
        subject: "sub-1",
        handle: null,
        avatarUrl: "https://exemple.test/a.png",
      },
      { termsAccepted: true },
    );
    expect(createSession).toHaveBeenCalledWith(7, "LOGIN_GOOGLE");
    expect(response.headers.get("location")).toBe("http://localhost:3000/tournois");
  });

  it("retient le **pseudo** Discord, pas son nom d'affichage", async () => {
    // `username` est le tag stable par lequel on retrouve quelqu'un, et c'est
    // lui que la certification publie à l'arbitrage. `global_name` est un
    // libellé décoratif que deux comptes peuvent partager.
    jest.mocked(fetchDiscordUser).mockResolvedValue({
      id: "123456789012345678",
      username: "nova",
      global_name: "Nova la Grande",
      avatar: "abc",
    });

    await login("DISCORD");

    expect(createOrGetOAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "DISCORD", subject: "123456789012345678", handle: "nova" }),
      { termsAccepted: true },
    );
  });

  it("retient le BattleTag de Blizzard", async () => {
    jest.mocked(fetchBlizzardUser).mockResolvedValue({
      sub: "blizz-1",
      battletag: "Nova#2143",
    });

    await login("BLIZZARD");

    expect(createOrGetOAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "BLIZZARD", subject: "blizz-1", handle: "Nova#2143" }),
      { termsAccepted: true },
    );
  });

  it("renvoie sur la connexion avec `error=terms` quand un compte neuf arrive sans les conditions", async () => {
    jest.mocked(fetchGoogleUser).mockResolvedValue({ sub: "sub-neuf" });
    jest.mocked(createOrGetOAuthUser).mockRejectedValueOnce(new Error("TERMS_REQUIRED"));

    const response = await login("GOOGLE");

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=terms&provider=google",
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  it("renvoie un compte suspendu sur la connexion, l'exposé dans un cookie httpOnly et jamais dans l'URL", async () => {
    jest.mocked(fetchGoogleUser).mockResolvedValue({ sub: "sub-1" });
    const notice = {
      reference: "S-12",
      reason: "Triche avérée pendant la finale",
      ground: "BEHAVIOR" as const,
      endsAt: "2026-10-15T08:00:00.000Z",
    };
    jest.mocked(createSession).mockRejectedValueOnce(new AccountSuspendedError(notice));

    const response = await login("GOOGLE");

    const location = response.headers.get("location") ?? "";
    expect(location).toBe("http://localhost:3000/connexion?error=suspended&provider=google");
    expect(location).not.toContain("Triche");
    const cookie = response.cookies.get(SUSPENSION_NOTICE_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    // `/` pour atteindre aussi `/en/connexion` ; le middleware borne sa lecture.
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(600);
    expect(parseSuspensionNotice(cookie?.value)).toEqual(notice);
  });

  it("n'écrit aucun cookie d'exposé pour un autre refus", async () => {
    jest.mocked(fetchGoogleUser).mockResolvedValue({ sub: "sub-1" });
    jest.mocked(createSession).mockRejectedValueOnce(new Error("ACCOUNT_SUSPENDED"));

    const response = await login("GOOGLE");

    // Seule l'erreur typée porte un exposé : un message homonyme n'en invente pas.
    expect(response.headers.get("location")).toBe("http://localhost:3000/connexion?error=oauth&provider=google");
    expect(response.cookies.get(SUSPENSION_NOTICE_COOKIE)).toBeUndefined();
  });

  it("refiltre la destination à la sortie du cookie, qui n'est pas signé", async () => {
    jest.mocked(fetchGoogleUser).mockResolvedValue({ sub: "sub-1" });
    jest.mocked(consumeOAuthState).mockResolvedValue({
      provider: "GOOGLE",
      state: STATE,
      redirectTo: "https://exemple.invalid/phishing",
      intent: "LOGIN",
      termsAccepted: true,
    });

    const response = await completeOAuth(
      request(`http://localhost:3000/api/auth/x/callback?code=abc&state=${STATE}`),
      "GOOGLE",
    );

    expect(response.headers.get("location")).toBe("http://localhost:3000/tournois");
  });

  it("n'ouvre pas de session quand la création échoue", async () => {
    jest.mocked(fetchGoogleUser).mockResolvedValue({ sub: "sub-1" });
    jest.mocked(createOrGetOAuthUser).mockRejectedValue(new Error("ER_DUP_ENTRY"));

    const response = await login("GOOGLE");

    expect(createSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=oauth&provider=google",
    );
  });
});

describe("completeOAuth — rattachement", () => {
  const link = (provider: "GOOGLE" | "DISCORD" = "DISCORD") => {
    jest.mocked(consumeOAuthState).mockResolvedValue({
      provider,
      state: STATE,
      redirectTo: "/tournois",
      intent: "LINK",
      termsAccepted: true,
    });
    return completeOAuth(
      request(`http://localhost:3000/api/auth/x/callback?code=abc&state=${STATE}`),
      provider,
    );
  };

  beforeEach(() => {
    jest.mocked(fetchDiscordUser).mockResolvedValue({
      id: "123456789012345678",
      username: "nova",
      avatar: null,
    });
    jest.mocked(fetchGoogleUser).mockResolvedValue({ sub: "sub-1" });
  });

  it("rattache au compte connecté sans toucher à la session", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));

    const response = await link();

    expect(linkOAuthIdentity).toHaveBeenCalledWith(7, expect.objectContaining({ provider: "DISCORD" }));
    expect(createSession).not.toHaveBeenCalled();
    expect(createOrGetOAuthUser).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/profil?connected=discord");
  });

  it("dit au profil qu'une identité déjà rattachée a été **relue**, pas ajoutée", async () => {
    // C'est le chemin de certification d'un compte déjà relié à Discord :
    // annoncer « rattaché » décrirait un changement qui n'a pas eu lieu.
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
    jest.mocked(linkOAuthIdentity).mockResolvedValue("REFRESHED");

    const response = await link();

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profil?connected=discord&refreshed=1",
    );
  });

  it("refuse quand la session a expiré pendant l'aller-retour", async () => {
    // Dix minutes séparent l'aller du retour. Rattacher sur la seule foi du
    // cookie d'état poserait une porte d'entrée sur un compte que plus rien ne
    // prouve être celui de l'appelant.
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await link();

    expect(linkOAuthIdentity).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=session&provider=discord",
    );
  });

  it("renvoie le refus du service au profil, jamais à la connexion", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
    jest.mocked(linkOAuthIdentity).mockRejectedValue(
      new Error("IDENTITY_ALREADY_LINKED"),
    );

    const response = await link();

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profil?connection_error=IDENTITY_ALREADY_LINKED&provider=discord",
    );
  });

  it("ramène au profil quand l'échange échoue, et n'ouvre aucune session", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
    jest.mocked(fetchGoogleUser).mockRejectedValue(new Error("GOOGLE_USERINFO_FAILED"));

    const response = await link("GOOGLE");

    expect(createSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profil?connection_error=OAUTH_FAILED&provider=google",
    );
  });

  it("ne laisse **pas** le message d'une panne partir dans l'URL", async () => {
    // `linkOAuthIdentity` ne lève pas que ses refus nommés : ce que `mysql2`
    // fait remonter le traverse. Recopié tel quel, ce message finissait dans la
    // barre d'adresse, l'historique et le `Referer` — sans que rien ne le
    // signale à l'écran, le registre français retombant sur sa phrase générique.
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
    jest.mocked(linkOAuthIdentity).mockRejectedValue(
      new Error("ER_LOCK_DEADLOCK: Deadlock found when trying to get lock"),
    );

    const response = await link();
    const location = response.headers.get("location") ?? "";

    expect(location).toBe("http://localhost:3000/profil?connection_error=LINK_FAILED&provider=discord");
    expect(location).not.toContain("Deadlock");
  });

  it("distingue la configuration manquante de la panne, jusque sur le retour", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
    jest.mocked(fetchGoogleUser).mockRejectedValue(new Error("Missing GOOGLE_CLIENT_SECRET"));

    const response = await link("GOOGLE");

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profil?connection_error=NOT_CONFIGURED&provider=google",
    );
  });
});

/**
 * Lot 6 : la page de connexion existe sous `/en/connexion`. La langue du départ
 * (`?lang=en`, posé par les boutons) se scelle dans la destination du cookie
 * d'état (`/en/…`) et se relit au retour — l'adresse de rappel, enregistrée
 * chez le fournisseur, ne change pas.
 */
describe("aller-retour OAuth — la langue du départ", () => {
  const callback = (provider: OAuthProvider, query = `?code=abc&state=${STATE}`) =>
    completeOAuth(request(`http://localhost:3000/api/auth/x/callback${query}`), provider);
  const sealed = (redirectTo: string, provider: OAuthProvider = "GOOGLE") =>
    jest.mocked(consumeOAuthState).mockResolvedValue({ provider, state: STATE, redirectTo, intent: "LOGIN", termsAccepted: true });

  it("scelle la destination dans la langue du départ, même vers une route pas encore traduite", async () => {
    await startOAuth(request("http://localhost:3000/api/auth/x/start?redirect=%2Ftournois%2F4&lang=en"), "DISCORD");
    expect(saveOAuthState).toHaveBeenLastCalledWith(expect.objectContaining({ redirectTo: "/en/tournois/4" }));

    await startOAuth(request("http://localhost:3000/api/auth/x/start?redirect=%2Fen%2Fregles&lang=en"), "DISCORD");
    expect(saveOAuthState).toHaveBeenLastCalledWith(expect.objectContaining({ redirectTo: "/en/regles" }));
  });

  it("ne scelle aucune langue pour un départ français, ni pour une langue inconnue", async () => {
    await startOAuth(request("http://localhost:3000/api/auth/x/start?redirect=%2Fen%2Fregles"), "GOOGLE");
    expect(saveOAuthState).toHaveBeenLastCalledWith(expect.objectContaining({ redirectTo: "/regles" }));

    await startOAuth(request("http://localhost:3000/api/auth/x/start?redirect=%2Fregles&lang=de"), "GOOGLE");
    expect(saveOAuthState).toHaveBeenLastCalledWith(expect.objectContaining({ redirectTo: "/regles" }));
  });

  it("n'ajoute aucun champ au cookie d'état", async () => {
    await startOAuth(request("http://localhost:3000/api/auth/x/start?lang=en"), "GOOGLE");
    expect(Object.keys(jest.mocked(saveOAuthState).mock.calls[0][0]).sort()).toEqual(
      ["intent", "provider", "redirectTo", "state", "termsAccepted"],
    );
  });

  it.each([
    "https%3A%2F%2Fexemple.invalid",
    "%2F%2Fexemple.invalid",
    "%2Fen%2F%2Fexemple.invalid",
    "%2Fen%2F%5Cexemple.invalid",
  ])("garde la destination dans le site sous /en (%s)", async (redirect) => {
    await startOAuth(request(`http://localhost:3000/api/auth/x/start?redirect=${redirect}&lang=en`), "GOOGLE");
    expect(saveOAuthState).toHaveBeenLastCalledWith(expect.objectContaining({ redirectTo: "/en/tournois" }));
  });

  it("ramène un refus au départ sur /en/connexion", async () => {
    jest.mocked(buildGoogleAuthorizationUrl).mockImplementation(() => {
      throw new Error("Missing GOOGLE_CLIENT_ID");
    });
    const response = await startOAuth(request("http://localhost:3000/api/auth/x/start?lang=en"), "GOOGLE");
    expect(response.headers.get("location")).toBe("http://localhost:3000/en/connexion?error=not_configured&provider=google");
  });

  it("ramène un rattachement sans session sur /en/connexion", async () => {
    const response = await startOAuth(request("http://localhost:3000/api/auth/x/start?intent=link&lang=en"), "DISCORD");
    expect(response.headers.get("location")).toBe("http://localhost:3000/en/connexion?error=session&provider=discord");
  });

  it.each([
    // Départ anglais vers une page traduite : la page anglaise.
    ["/en/regles/simple?x=1", "/en/regles/simple?x=1"],
    // Départ anglais vers une route pas encore traduite : la française.
    ["/en/equipes/4", "/equipes/4"],
    // Départ français : français.
    ["/regles", "/regles"],
    // Destination trafiquée dans le cookie : refiltrée.
    ["/en//exemple.invalid", "/tournois"],
  ])("ouvre la session et suit la destination scellée %s", async (redirectTo, expected) => {
    jest.mocked(fetchGoogleUser).mockResolvedValue({ sub: "sub-1" });
    sealed(redirectTo);
    const response = await callback("GOOGLE");
    expect(response.headers.get("location")).toBe(`http://localhost:3000${expected}`);
  });

  it.each([
    ["params", "?state=x"],
    ["state", "?code=abc&state=autre"],
  ])("ramène un refus (%s) sur /en/connexion", async (kind, query) => {
    sealed("/en/tournois");
    const response = await callback("GOOGLE", query);
    expect(response.headers.get("location")).toBe(`http://localhost:3000/en/connexion?error=${kind}&provider=google`);
  });

  it("ramène un échec de l'échange sur /en/connexion", async () => {
    jest.mocked(fetchDiscordUser).mockRejectedValue(new Error("boom"));
    sealed("/en/tournois", "DISCORD");
    const response = await callback("DISCORD");
    expect(response.headers.get("location")).toBe("http://localhost:3000/en/connexion?error=oauth&provider=discord");
  });

  it("ramène un compte suspendu sur /en/connexion, l'exposé dans le même cookie", async () => {
    jest.mocked(fetchGoogleUser).mockResolvedValue({ sub: "sub-1" });
    const notice = { reference: "S-3", reason: "Faits", ground: "ACCOUNT" as const, endsAt: null };
    jest.mocked(createSession).mockRejectedValueOnce(new AccountSuspendedError(notice));
    sealed("/en/tournois");
    const response = await callback("GOOGLE");
    expect(response.headers.get("location")).toBe("http://localhost:3000/en/connexion?error=suspended&provider=google");
    expect(response.cookies.get(SUSPENSION_NOTICE_COOKIE)?.path).toBe("/");
  });

  it("sans cookie d'état, la langue n'est plus connue : le français", async () => {
    jest.mocked(consumeOAuthState).mockResolvedValue(null);
    const response = await callback("GOOGLE");
    expect(response.headers.get("location")).toBe("http://localhost:3000/connexion?error=state&provider=google");
  });
});
