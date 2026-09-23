import { describe, expect, it } from "@jest/globals";
import {
  buildAccountConnections,
  connectionMethodLabel,
  checkConnectionUnlink,
  connectionUnlinkRefusalMessage,
  linkedConnectionCount,
  type AccountConnection,
} from "@/lib/shared/account-connections";
import { OAUTH_PROVIDERS, type OAuthProvider } from "@/lib/shared/oauth-providers";

/**
 * **Le compte n'a pas de mot de passe.**
 *
 * Toute la valeur de ce module tient là : détacher le dernier moyen de
 * connexion ne « délie » pas un compte, il le **ferme** — et sans recours, le
 * site n'ayant aucune récupération par courriel. La règle est écrite une fois
 * pour l'écran (qui met le motif à la place du bouton) et pour la route (qui
 * refuse en 409) : deux copies auraient fini par différer, et la différence
 * aurait pris la forme d'un bouton qui mène à un mur.
 */

const connections = (linked: Partial<Record<OAuthProvider, boolean>>): AccountConnection[] =>
  OAUTH_PROVIDERS.map((provider) => ({
    provider,
    linked: linked[provider] === true,
    method: null,
    handle: null,
  }));

describe("buildAccountConnections", () => {
  it("rend **tous** les fournisseurs, rattachés ou non", () => {
    // L'écran doit pouvoir proposer ce qui manque : une liste réduite à
    // l'existant l'obligerait à reconstruire le complément, donc à connaître
    // une seconde fois la liste qu'il vient de recevoir.
    const built = buildAccountConnections({ DISCORD: { subject: "123", handle: "nova" } });

    expect(built.map((c) => c.provider)).toEqual([...OAUTH_PROVIDERS]);
    expect(built.find((c) => c.provider === "DISCORD")).toEqual({
      provider: "DISCORD",
      linked: true,
      method: null,
      handle: "nova",
    });
    expect(built.find((c) => c.provider === "GOOGLE")).toEqual({
      provider: "GOOGLE",
      linked: false,
      method: null,
      handle: null,
    });
  });

  it("ne laisse pas traîner un tag sur une porte détachée", () => {
    // `discord_pseudo` survit au détachement de `discord_id` : le tag reste une
    // saisie du joueur. Il ne doit pas pour autant faire croire à un
    // rattachement.
    const built = buildAccountConnections({
      DISCORD: { subject: null, handle: "nova", method: "OAUTH" },
    });

    // La **méthode** part avec le tag, et pour la même raison : elle décrit un
    // rattachement, pas un compte. Laissée là, elle ferait annoncer « rattaché
    // par le bouton Discord » à côté d'un bouton « Rattacher ».
    expect(built.find((c) => c.provider === "DISCORD")).toEqual({
      provider: "DISCORD",
      linked: false,
      method: null,
      handle: null,
    });
  });

  it("traite une chaîne vide comme une absence", () => {
    expect(buildAccountConnections({ GOOGLE: { subject: "" } })[0].linked).toBe(false);
  });
});

describe("linkedConnectionCount", () => {
  it("compte les portes ouvertes", () => {
    expect(linkedConnectionCount(connections({}))).toBe(0);
    expect(linkedConnectionCount(connections({ GOOGLE: true, DISCORD: true }))).toBe(2);
  });
});

describe("checkConnectionUnlink", () => {
  it("laisse retirer quand il en reste une autre", () => {
    expect(checkConnectionUnlink(connections({ GOOGLE: true, DISCORD: true }), "DISCORD")).toBeNull();
  });

  it("refuse la **dernière**, quelle qu'elle soit", () => {
    // Aucune porte n'est « principale » : le seuil est le nombre, pas le
    // fournisseur.
    for (const provider of OAUTH_PROVIDERS) {
      expect(checkConnectionUnlink(connections({ [provider]: true }), provider)).toBe(
        "LAST_CONNECTION",
      );
    }
  });

  it("refuse de retirer ce qui n'est pas rattaché", () => {
    expect(checkConnectionUnlink(connections({ GOOGLE: true, DISCORD: true }), "BLIZZARD")).toBe(
      "NOT_LINKED",
    );
  });

  it("refuse un fournisseur absent de la liste", () => {
    expect(checkConnectionUnlink([], "GOOGLE")).toBe("NOT_LINKED");
  });

  it("autorise dès la deuxième porte, et pas avant", () => {
    const one = connections({ BLIZZARD: true });
    const two = connections({ BLIZZARD: true, GOOGLE: true });
    expect(checkConnectionUnlink(one, "BLIZZARD")).toBe("LAST_CONNECTION");
    expect(checkConnectionUnlink(two, "BLIZZARD")).toBeNull();
  });
});

describe("connectionUnlinkRefusalMessage", () => {
  it("nomme le fournisseur et le geste qui lève le refus", () => {
    const message = connectionUnlinkRefusalMessage("LAST_CONNECTION", "DISCORD");
    expect(message).toContain("Discord");
    expect(message).toMatch(/dernier moyen de connexion/i);
    expect(message).toMatch(/ajoute/i);
  });

  it("ne laisse jamais sortir un jeton en capitales", () => {
    for (const refusal of ["LAST_CONNECTION", "NOT_LINKED"] as const) {
      for (const provider of OAUTH_PROVIDERS) {
        expect(connectionUnlinkRefusalMessage(refusal, provider)).not.toContain(refusal);
      }
    }
  });
});

describe("connectionMethodLabel — par quelle porte ce Discord est arrivé", () => {
  /**
   * Discord est le **seul** fournisseur à en avoir deux : le bouton, et le code
   * reçu en message privé. Elles aboutissent au même `discord_id` et ouvrent les
   * mêmes sessions, mais ne laissent pas la même trace **chez Discord** — l'une
   * y pose une autorisation d'application, que le joueur peut consulter et
   * révoquer de son côté, l'autre non. C'est exactement ce qu'une liste
   * d'applications connectées doit dire, et « Rattaché » ne le disait pas.
   */
  const discord = (method: "OAUTH" | "DM_CODE" | null) =>
    buildAccountConnections({ DISCORD: { subject: "123", handle: "nova", method } }).find(
      (c) => c.provider === "DISCORD",
    )!;

  it("distingue les deux portes en toutes lettres", () => {
    expect(connectionMethodLabel(discord("OAUTH"))).toContain("bouton Discord");
    expect(connectionMethodLabel(discord("DM_CODE"))).toContain("message privé");
  });

  it("se tait sur un rattachement antérieur à cette information", () => {
    // Les comptes reliés avant la colonne ne se classent pas après coup : leur
    // inventer une porte serait affirmer ce qu'on ignore.
    expect(connectionMethodLabel(discord(null))).toBeNull();
  });

  it("se tait sur les fournisseurs à porte unique", () => {
    // Une ligne « rattaché par… » sous Google et Blizzard serait du bruit sur
    // chaque compte : il n'y a rien à distinguer.
    const google = buildAccountConnections({
      GOOGLE: { subject: "g-1", method: "OAUTH" },
    }).find((c) => c.provider === "GOOGLE")!;
    expect(connectionMethodLabel(google)).toBeNull();
  });

  it("se tait sur une porte détachée", () => {
    const detached = buildAccountConnections({
      DISCORD: { subject: null, method: "OAUTH" },
    }).find((c) => c.provider === "DISCORD")!;
    expect(connectionMethodLabel(detached)).toBeNull();
  });

  it("ne laisse jamais sortir un jeton en capitales", () => {
    for (const method of ["OAUTH", "DM_CODE"] as const) {
      expect(connectionMethodLabel(discord(method))).not.toContain(method);
    }
  });
});
