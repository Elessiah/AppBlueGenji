import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  buildBlizzardAuthorizationUrl,
  fetchBlizzardUser,
  getBlizzardOAuthBase,
  getBlizzardRedirectUri,
} from "@/lib/server/blizzard-oauth";
import {
  buildDiscordAuthorizationUrl,
  discordAvatarUrl,
  fetchDiscordUser,
  getDiscordClientId,
  getDiscordRedirectUri,
} from "@/lib/server/discord-oauth";

/**
 * **Les deux nouveaux clients OAuth, et surtout ce qu'ils ne demandent pas.**
 *
 * La règle de la maison est de ne prendre que ce qui sert : `identify` pour
 * Discord (l'identifiant et le pseudo, qui *est* le tag certifié), `openid` pour
 * Blizzard (l'identifiant et le BattleTag). Ni adresse, ni liste de serveurs —
 * ce qu'on ne demande pas ne fuite pas, et un scope ajouté par distraction se
 * remarque d'autant moins qu'il ne casse rien.
 */

const originalEnv = { ...process.env };
const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env = { ...originalEnv };
  jest.clearAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
  globalThis.fetch = realFetch;
});

describe("Discord — configuration", () => {
  it("retombe sur l'application du bot quand elle seule est réglée", () => {
    // En pratique c'est la même application qui invite le bot et ouvre les
    // sessions : une installation qui n'a que la variable du bot fonctionne.
    delete process.env.DISCORD_AUTH_CLIENT_ID;
    process.env.DISCORD_BOT_CLIENT_ID = "bot-app";
    expect(getDiscordClientId()).toBe("bot-app");
  });

  it("préfère `DISCORD_AUTH_CLIENT_ID`, qui dit à quoi il sert", () => {
    process.env.DISCORD_AUTH_CLIENT_ID = "app-connexion";
    process.env.DISCORD_BOT_CLIENT_ID = "bot-app";
    expect(getDiscordClientId()).toBe("app-connexion");
  });

  it("ignore l'ancien nom, pour qu'il n'y ait pas trois variables pour une valeur", () => {
    // `DISCORD_CLIENT_ID` a été remplacée avant d'avoir jamais été réglée : la
    // laisser vivre en parallèle donnerait un troisième nom pour la même chose,
    // et une installation qui règle le mauvais n'aurait aucun message.
    delete process.env.DISCORD_AUTH_CLIENT_ID;
    delete process.env.DISCORD_BOT_CLIENT_ID;
    process.env.DISCORD_CLIENT_ID = "ancien-nom";
    expect(() => getDiscordClientId()).toThrow("Missing DISCORD_AUTH_CLIENT_ID");
  });

  it("lève un refus nommé quand rien n'est réglé", () => {
    delete process.env.DISCORD_AUTH_CLIENT_ID;
    delete process.env.DISCORD_BOT_CLIENT_ID;
    expect(() => getDiscordClientId()).toThrow("Missing DISCORD_AUTH_CLIENT_ID");
  });

  it("déduit l'adresse de rappel d'`APP_URL`, sans barre en trop", () => {
    delete process.env.DISCORD_REDIRECT_URI;
    process.env.APP_URL = "https://bluegenji.test/";
    expect(getDiscordRedirectUri()).toBe("https://bluegenji.test/api/auth/discord/callback");
  });

  it("demande `identify`, et rien d'autre", () => {
    process.env.DISCORD_AUTH_CLIENT_ID = "app";
    process.env.DISCORD_REDIRECT_URI = "https://bluegenji.test/api/auth/discord/callback";

    const url = buildDiscordAuthorizationUrl("state-token");

    expect(url).toContain("scope=identify");
    expect(url).not.toContain("email");
    expect(url).not.toContain("guilds");
    expect(url).toContain("state=state-token");
    expect(url).toContain("response_type=code");
  });
});

describe("Discord — avatar", () => {
  it("demande **toujours** un PNG, y compris pour un avatar animé", () => {
    // Le `.gif` que Discord sert pour une empreinte `a_` condamnait la copie :
    // `storeImageBuffer` ne connaît que PNG, JPEG et WebP, si bien que tout
    // compte à avatar animé restait sans photo — sans erreur ni journal, et en
    // réessayant à chaque connexion.
    expect(discordAvatarUrl({ id: "42", username: "nova", avatar: "a_abc" })).toBe(
      "https://cdn.discordapp.com/avatars/42/a_abc.png?size=256",
    );
    expect(discordAvatarUrl({ id: "42", username: "nova", avatar: "abc" })).toBe(
      "https://cdn.discordapp.com/avatars/42/abc.png?size=256",
    );
  });

  it("ne demande qu'un format que la chaîne d'import sait ranger", () => {
    // Le lien entre les deux modules ne se lit nulle part ailleurs : c'est ce
    // test qui le tient.
    const url = discordAvatarUrl({ id: "42", username: "nova", avatar: "a_abc" })!;
    expect(url).toMatch(/\.(png|jpe?g|webp)(\?|$)/);
  });

  it("rend `null` quand le compte n'en a pas", () => {
    expect(discordAvatarUrl({ id: "42", username: "nova", avatar: null })).toBeNull();
    expect(discordAvatarUrl({ id: "42", username: "nova" })).toBeNull();
  });
});

describe("Discord — échange du code", () => {
  const configure = () => {
    process.env.DISCORD_AUTH_CLIENT_ID = "app";
    process.env.DISCORD_CLIENT_SECRET = "secret";
    process.env.DISCORD_REDIRECT_URI = "https://bluegenji.test/api/auth/discord/callback";
  };

  it("rend le profil quand tout se passe bien", async () => {
    configure();
    globalThis.fetch = jest.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/token")) {
        return { ok: true, json: async () => ({ access_token: "jeton" }) };
      }
      return {
        ok: true,
        json: async () => ({ id: "123456789012345678", username: "nova", avatar: "abc" }),
      };
    }) as never;

    await expect(fetchDiscordUser("code")).resolves.toEqual({
      id: "123456789012345678",
      username: "nova",
      avatar: "abc",
    });
  });

  it("refuse un profil sans identifiant exploitable", async () => {
    // Sans identifiant, il n'y a rien à rattacher — et une ligne écrite sur un
    // identifiant vide serait pire que pas de ligne du tout.
    configure();
    globalThis.fetch = jest.fn(async (input: unknown) =>
      String(input).includes("/token")
        ? { ok: true, json: async () => ({ access_token: "jeton" }) }
        : { ok: true, json: async () => ({ username: "nova" }) },
    ) as never;

    await expect(fetchDiscordUser("code")).rejects.toThrow("DISCORD_USERINFO_INVALID");
  });

  it("nomme l'échec de l'échange", async () => {
    configure();
    globalThis.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) })) as never;

    await expect(fetchDiscordUser("code")).rejects.toThrow("DISCORD_TOKEN_EXCHANGE_FAILED");
  });
});

describe("Blizzard — configuration", () => {
  it("sert l'origine mondiale par défaut", () => {
    delete process.env.BLIZZARD_REGION;
    expect(getBlizzardOAuthBase()).toBe("https://oauth.battle.net");
  });

  it("bascule sur l'infrastructure chinoise, qui ne partage aucun compte", () => {
    process.env.BLIZZARD_REGION = "CN";
    expect(getBlizzardOAuthBase()).toBe("https://oauth.battlenet.com.cn");
  });

  it("retombe sur l'origine mondiale sur une valeur inconnue", () => {
    // La variable sert à *sortir* du cas par défaut, pas à l'énumérer : une
    // faute de frappe ne doit pas casser la connexion de tout le monde.
    process.env.BLIZZARD_REGION = "eu-west-oups";
    expect(getBlizzardOAuthBase()).toBe("https://oauth.battle.net");
  });

  it("déduit l'adresse de rappel d'`APP_URL`", () => {
    delete process.env.BLIZZARD_REDIRECT_URI;
    process.env.APP_URL = "https://bluegenji.test";
    expect(getBlizzardRedirectUri()).toBe("https://bluegenji.test/api/auth/blizzard/callback");
  });

  it("demande `openid`, et rien d'autre", () => {
    process.env.BLIZZARD_CLIENT_ID = "app";
    process.env.BLIZZARD_REDIRECT_URI = "https://bluegenji.test/api/auth/blizzard/callback";

    const url = buildBlizzardAuthorizationUrl("state-token");

    expect(url).toContain("https://oauth.battle.net/authorize?");
    expect(url).toContain("scope=openid");
    expect(url).not.toContain("wow.profile");
    expect(url).toContain("state=state-token");
  });
});

describe("Blizzard — échange du code", () => {
  const configure = () => {
    process.env.BLIZZARD_CLIENT_ID = "app";
    process.env.BLIZZARD_CLIENT_SECRET = "secret";
    process.env.BLIZZARD_REDIRECT_URI = "https://bluegenji.test/api/auth/blizzard/callback";
  };

  it("présente les identifiants du client en HTTP Basic", async () => {
    // C'est la forme documentée par Battle.net, et la seule que son émetteur de
    // jetons accepte sans condition.
    configure();
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = jest.fn(async (input: unknown, init: unknown) => {
      calls.push({ url: String(input), init: init as RequestInit });
      return String(input).includes("/token")
        ? { ok: true, json: async () => ({ access_token: "jeton" }) }
        : { ok: true, json: async () => ({ sub: "bz-1", battletag: "Nova#2143" }) };
    }) as never;

    await fetchBlizzardUser("code");

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("app:secret").toString("base64")}`,
    );
  });

  it("rend l'identifiant et le BattleTag", async () => {
    configure();
    globalThis.fetch = jest.fn(async (input: unknown) =>
      String(input).includes("/token")
        ? { ok: true, json: async () => ({ access_token: "jeton" }) }
        : { ok: true, json: async () => ({ sub: "bz-1", battletag: "Nova#2143" }) },
    ) as never;

    await expect(fetchBlizzardUser("code")).resolves.toEqual({
      sub: "bz-1",
      battletag: "Nova#2143",
    });
  });

  it("refuse un profil sans `sub`", async () => {
    configure();
    globalThis.fetch = jest.fn(async (input: unknown) =>
      String(input).includes("/token")
        ? { ok: true, json: async () => ({ access_token: "jeton" }) }
        : { ok: true, json: async () => ({ battletag: "Nova#2143" }) },
    ) as never;

    await expect(fetchBlizzardUser("code")).rejects.toThrow("BLIZZARD_USERINFO_INVALID");
  });

  it("nomme l'absence de jeton", async () => {
    configure();
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) })) as never;

    await expect(fetchBlizzardUser("code")).rejects.toThrow("BLIZZARD_ACCESS_TOKEN_MISSING");
  });
});
