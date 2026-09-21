import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OAUTH_PROVIDERS,
  OAUTH_PROVIDER_HANDLE_LABELS,
  OAUTH_PROVIDER_LABELS,
  OAUTH_PROVIDER_SLUGS,
  isOAuthProvider,
  oauthProviderFromSlug,
  oauthStartPath,
} from "@/lib/shared/oauth-providers";

const ROOT = join(__dirname, "..", "..", "..");

describe("registre des fournisseurs", () => {
  it("nomme et adresse les trois portes", () => {
    expect(OAUTH_PROVIDERS).toEqual(["GOOGLE", "DISCORD", "BLIZZARD"]);
    for (const provider of OAUTH_PROVIDERS) {
      expect(OAUTH_PROVIDER_LABELS[provider]).toBeTruthy();
      expect(OAUTH_PROVIDER_SLUGS[provider]).toMatch(/^[a-z]+$/);
      expect(OAUTH_PROVIDER_HANDLE_LABELS).toHaveProperty(provider);
    }
  });

  it("garde les segments d'URL distincts", () => {
    const slugs = OAUTH_PROVIDERS.map((provider) => OAUTH_PROVIDER_SLUGS[provider]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("fait l'aller-retour entre fournisseur et segment", () => {
    for (const provider of OAUTH_PROVIDERS) {
      expect(oauthProviderFromSlug(OAUTH_PROVIDER_SLUGS[provider])).toBe(provider);
    }
  });

  it.each(["", " ", "facebook", "../google", "google/../..", null, undefined])(
    "refuse « %s », qui vient d'une URL",
    (value) => {
      expect(oauthProviderFromSlug(value as string | null | undefined)).toBeNull();
    },
  );

  it("tolère la casse et les espaces, mais rien de plus", () => {
    // Le segment arrive d'une URL : la normalisation reste minimale, et la
    // comparaison se fait sur l'égalité exacte d'un segment connu — c'est ce
    // qui interdit toute traversée de chemin.
    expect(oauthProviderFromSlug("Discord")).toBe("DISCORD");
    expect(oauthProviderFromSlug(" blizzard ")).toBe("BLIZZARD");
  });

  it("reconnaît un fournisseur, et rien d'autre", () => {
    expect(isOAuthProvider("DISCORD")).toBe(true);
    expect(isOAuthProvider("discord")).toBe(false);
    expect(isOAuthProvider(null)).toBe(false);
    expect(isOAuthProvider(42)).toBe(false);
  });
});

describe("oauthStartPath", () => {
  it("écrit l'adresse de départ, paramètres compris", () => {
    expect(oauthStartPath("DISCORD", { redirect: "/tournois/12" })).toBe(
      "/api/auth/discord/start?redirect=%2Ftournois%2F12",
    );
  });

  it("marque l'intention de rattachement", () => {
    // Un `intent=link` oublié transforme silencieusement un rattachement en
    // **changement de session** : le joueur croyait ajouter un moyen de
    // connexion, il vient d'en ouvrir une autre.
    expect(oauthStartPath("GOOGLE", { intent: "LINK" })).toBe(
      "/api/auth/google/start?intent=link",
    );
  });

  it("ne pose aucun paramètre quand il n'y en a pas", () => {
    expect(oauthStartPath("BLIZZARD")).toBe("/api/auth/blizzard/start");
  });
});

describe("chaque porte existe vraiment", () => {
  // Le registre sert à écrire des liens : un fournisseur listé sans ses deux
  // routes produirait un bouton qui mène à un 404, et la panne serait muette —
  // aucun type ne relie une constante à un fichier.
  it.each([...OAUTH_PROVIDERS])("%s a ses routes de départ et de rappel", (provider) => {
    const slug = OAUTH_PROVIDER_SLUGS[provider];
    for (const leg of ["start", "callback"]) {
      const source = readFileSync(join(ROOT, "app", "api", "auth", slug, leg, "route.ts"), "utf8");
      expect(source).toContain(`"${provider}"`);
    }
  });
});
