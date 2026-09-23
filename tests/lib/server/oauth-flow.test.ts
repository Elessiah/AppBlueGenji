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
  (getAppBaseUrl as jest.Mock).mockReturnValue("http://localhost:3000");
  (buildGoogleAuthorizationUrl as jest.Mock).mockReturnValue("https://accounts.google.test/auth");
  (buildDiscordAuthorizationUrl as jest.Mock).mockReturnValue("https://discord.test/auth");
  (buildBlizzardAuthorizationUrl as jest.Mock).mockReturnValue("https://blizzard.test/auth");
  (saveOAuthState as jest.Mock).mockResolvedValue(undefined as never);
  (createSession as jest.Mock).mockResolvedValue(undefined as never);
  (createOrGetOAuthUser as jest.Mock).mockResolvedValue(7 as never);
  (linkOAuthIdentity as jest.Mock).mockResolvedValue("LINKED" as never);
  (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
  (discordAvatarUrl as jest.Mock).mockReturnValue("https://cdn.discord.test/a.png");
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
    });
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
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 7 } as never);

    await startOAuth(request("http://localhost:3000/api/auth/x/start?intent=link"), "BLIZZARD");

    expect(saveOAuthState).toHaveBeenCalledWith(expect.objectContaining({ intent: "LINK" }));
  });

  it("ramène un **rattachement** raté au profil, pas à la page de connexion", async () => {
    // Celui qui clique « Rattacher » est connecté et vient de la page de son
    // compte : l'envoyer sur `/connexion` lui ferait croire que sa session a
    // sauté, et lui ferait perdre l'écran où il était.
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 7 } as never);
    (buildBlizzardAuthorizationUrl as jest.Mock).mockImplementation(() => {
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
    (buildDiscordAuthorizationUrl as jest.Mock).mockImplementation(() => {
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
    (consumeOAuthState as jest.Mock).mockResolvedValue(null as never);

    const response = await callback("GOOGLE", "");

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=params&provider=google",
    );
  });

  it("refuse un état qui ne correspond pas", async () => {
    (consumeOAuthState as jest.Mock).mockResolvedValue({
      provider: "GOOGLE",
      state: "un-autre-etat",
      redirectTo: "/tournois",
      intent: "LOGIN",
    } as never);

    const response = await callback("GOOGLE");

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=state&provider=google",
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  it("refuse un état émis pour **une autre porte**", async () => {
    // Le cookie est unique pour les trois fournisseurs : c'est ce contrôle-ci,
    // et lui seul, qui empêche de les confondre.
    (consumeOAuthState as jest.Mock).mockResolvedValue({
      provider: "GOOGLE",
      state: STATE,
      redirectTo: "/tournois",
      intent: "LOGIN",
    } as never);

    const response = await callback("BLIZZARD");

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=state&provider=blizzard",
    );
    expect(fetchBlizzardUser).not.toHaveBeenCalled();
  });

  it("consomme le cookie même quand le rappel est inexploitable", async () => {
    // Un état qui a échoué ne doit pas rester rejouable dix minutes durant.
    (consumeOAuthState as jest.Mock).mockResolvedValue(null as never);

    await callback("GOOGLE", "");

    expect(consumeOAuthState).toHaveBeenCalledTimes(1);
  });
});

describe("completeOAuth — connexion", () => {
  const login = (provider: "GOOGLE" | "DISCORD" | "BLIZZARD") => {
    (consumeOAuthState as jest.Mock).mockResolvedValue({
      provider,
      state: STATE,
      redirectTo: "/tournois",
      intent: "LOGIN",
    } as never);
    return completeOAuth(
      request(`http://localhost:3000/api/auth/x/callback?code=abc&state=${STATE}`),
      provider,
    );
  };

  it("ouvre la session Google et suit la destination", async () => {
    (fetchGoogleUser as jest.Mock).mockResolvedValue({
      sub: "sub-1",
      name: "Nova",
      picture: "https://exemple.test/a.png",
    } as never);

    const response = await login("GOOGLE");

    expect(createOrGetOAuthUser).toHaveBeenCalledWith({
      provider: "GOOGLE",
      subject: "sub-1",
      handle: null,
      avatarUrl: "https://exemple.test/a.png",
      displayName: "Nova",
    });
    expect(createSession).toHaveBeenCalledWith(7);
    expect(response.headers.get("location")).toBe("http://localhost:3000/tournois");
  });

  it("retient le **pseudo** Discord, pas son nom d'affichage", async () => {
    // `username` est le tag stable par lequel on retrouve quelqu'un, et c'est
    // lui que la certification publie à l'arbitrage. `global_name` est un
    // libellé décoratif que deux comptes peuvent partager.
    (fetchDiscordUser as jest.Mock).mockResolvedValue({
      id: "123456789012345678",
      username: "nova",
      global_name: "Nova la Grande",
      avatar: "abc",
    } as never);

    await login("DISCORD");

    expect(createOrGetOAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "DISCORD", subject: "123456789012345678", handle: "nova" }),
    );
  });

  it("retient le BattleTag de Blizzard", async () => {
    (fetchBlizzardUser as jest.Mock).mockResolvedValue({
      sub: "blizz-1",
      battletag: "Nova#2143",
    } as never);

    await login("BLIZZARD");

    expect(createOrGetOAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "BLIZZARD", subject: "blizz-1", handle: "Nova#2143" }),
    );
  });

  it("refiltre la destination à la sortie du cookie, qui n'est pas signé", async () => {
    (fetchGoogleUser as jest.Mock).mockResolvedValue({ sub: "sub-1" } as never);
    (consumeOAuthState as jest.Mock).mockResolvedValue({
      provider: "GOOGLE",
      state: STATE,
      redirectTo: "https://exemple.invalid/phishing",
      intent: "LOGIN",
    } as never);

    const response = await completeOAuth(
      request(`http://localhost:3000/api/auth/x/callback?code=abc&state=${STATE}`),
      "GOOGLE",
    );

    expect(response.headers.get("location")).toBe("http://localhost:3000/tournois");
  });

  it("n'ouvre pas de session quand la création échoue", async () => {
    (fetchGoogleUser as jest.Mock).mockResolvedValue({ sub: "sub-1" } as never);
    (createOrGetOAuthUser as jest.Mock).mockRejectedValue(new Error("ER_DUP_ENTRY") as never);

    const response = await login("GOOGLE");

    expect(createSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=oauth&provider=google",
    );
  });
});

describe("completeOAuth — rattachement", () => {
  const link = (provider: "GOOGLE" | "DISCORD" = "DISCORD") => {
    (consumeOAuthState as jest.Mock).mockResolvedValue({
      provider,
      state: STATE,
      redirectTo: "/tournois",
      intent: "LINK",
    } as never);
    return completeOAuth(
      request(`http://localhost:3000/api/auth/x/callback?code=abc&state=${STATE}`),
      provider,
    );
  };

  beforeEach(() => {
    (fetchDiscordUser as jest.Mock).mockResolvedValue({
      id: "123456789012345678",
      username: "nova",
      avatar: null,
    } as never);
    (fetchGoogleUser as jest.Mock).mockResolvedValue({ sub: "sub-1" } as never);
  });

  it("rattache au compte connecté sans toucher à la session", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 7 } as never);

    const response = await link();

    expect(linkOAuthIdentity).toHaveBeenCalledWith(7, expect.objectContaining({ provider: "DISCORD" }));
    expect(createSession).not.toHaveBeenCalled();
    expect(createOrGetOAuthUser).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/profil?connected=discord");
  });

  it("dit au profil qu'une identité déjà rattachée a été **relue**, pas ajoutée", async () => {
    // C'est le chemin de certification d'un compte déjà relié à Discord :
    // annoncer « rattaché » décrirait un changement qui n'a pas eu lieu.
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 7 } as never);
    (linkOAuthIdentity as jest.Mock).mockResolvedValue("REFRESHED" as never);

    const response = await link();

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profil?connected=discord&refreshed=1",
    );
  });

  it("refuse quand la session a expiré pendant l'aller-retour", async () => {
    // Dix minutes séparent l'aller du retour. Rattacher sur la seule foi du
    // cookie d'état poserait une porte d'entrée sur un compte que plus rien ne
    // prouve être celui de l'appelant.
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    const response = await link();

    expect(linkOAuthIdentity).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connexion?error=session&provider=discord",
    );
  });

  it("renvoie le refus du service au profil, jamais à la connexion", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 7 } as never);
    (linkOAuthIdentity as jest.Mock).mockRejectedValue(
      new Error("IDENTITY_ALREADY_LINKED") as never,
    );

    const response = await link();

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profil?connection_error=IDENTITY_ALREADY_LINKED&provider=discord",
    );
  });

  it("ramène au profil quand l'échange échoue, et n'ouvre aucune session", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 7 } as never);
    (fetchGoogleUser as jest.Mock).mockRejectedValue(new Error("GOOGLE_USERINFO_FAILED") as never);

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
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 7 } as never);
    (linkOAuthIdentity as jest.Mock).mockRejectedValue(
      new Error("ER_LOCK_DEADLOCK: Deadlock found when trying to get lock") as never,
    );

    const response = await link();
    const location = response.headers.get("location") ?? "";

    expect(location).toBe("http://localhost:3000/profil?connection_error=LINK_FAILED&provider=discord");
    expect(location).not.toContain("Deadlock");
  });

  it("distingue la configuration manquante de la panne, jusque sur le retour", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 7 } as never);
    (fetchGoogleUser as jest.Mock).mockRejectedValue(new Error("Missing GOOGLE_CLIENT_SECRET") as never);

    const response = await link("GOOGLE");

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profil?connection_error=NOT_CONFIGURED&provider=google",
    );
  });
});
