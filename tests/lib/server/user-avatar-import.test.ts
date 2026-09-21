import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fetchRemoteImage } from "@/lib/server/remote-image-fetch";
import { importRemoteAvatar, shouldImportRemoteAvatar } from "@/lib/server/user-avatar-import";

/**
 * La photo de profil d'un compte Google était rangée telle quelle dans
 * `bg_users.avatar_url`, donc rendue depuis `lh3.googleusercontent.com` : à
 * chaque page portant cet avatar, le navigateur du **visiteur** annonçait son
 * IP à Google. Elle est désormais copiée chez nous à la connexion.
 *
 * Deux choses à garder fermées, et ce sont deux dangers de sens opposés. À
 * l'entrée, la requête part **du serveur** — une adresse interne devient donc
 * joignable, ce qu'elle n'était pas depuis le poste du visiteur. À la sortie,
 * un avatar **téléversé** ne doit jamais être écrasé par celui du fournisseur.
 */
describe("shouldImportRemoteAvatar", () => {
  it("importe quand le compte n'a pas d'avatar", () => {
    expect(shouldImportRemoteAvatar(null)).toBe(true);
    expect(shouldImportRemoteAvatar(undefined)).toBe(true);
    expect(shouldImportRemoteAvatar("")).toBe(true);
  });

  // Les comptes d'avant la correction se réparent ainsi d'eux-mêmes, à leur
  // prochaine connexion : leur URL Google n'est pas un fichier à nous.
  it("importe quand l'avatar en place est encore une URL étrangère", () => {
    expect(shouldImportRemoteAvatar("https://lh3.googleusercontent.com/a/ACg8ocK=s96-c")).toBe(true);
  });

  /**
   * Le point qui compte, et un défaut préexistant refermé au passage :
   * `createOrGetGoogleUser` écrivait `avatar_url = COALESCE(?, avatar_url)` à
   * chaque connexion, si bien que la photo choisie sur `/profil` était
   * remplacée par celle de Google au prochain passage par le bouton de
   * connexion. Le défaut ne pouvait pas survivre à cette correction, qui écrit
   * un **fichier** là où l'ancienne ne changeait qu'un pointeur.
   */
  it("n'écrase jamais un avatar téléversé", () => {
    expect(shouldImportRemoteAvatar("/api/uploads/avatars/12-ab.webp")).toBe(false);
    expect(shouldImportRemoteAvatar("/uploads/avatars/12-ab.webp")).toBe(false);
  });
});

describe("importRemoteAvatar — refus sans la moindre requête", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("aucune requête ne devait partir");
    }) as never;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("refuse une absence d'URL", async () => {
    await expect(importRemoteAvatar(null, 1)).resolves.toBeNull();
    await expect(importRemoteAvatar(undefined, 1)).resolves.toBeNull();
    await expect(importRemoteAvatar("", 1)).resolves.toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("refuse le clair : nous n'allons pas chercher en HTTP ce que le site sert en HTTPS", async () => {
    await expect(importRemoteAvatar("http://exemple.invalid/p.png", 1)).resolves.toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // Le danger propre à ce sens de circulation : depuis le serveur, ces
  // adresses sont joignables. Celle du service de métadonnées cloud comprise.
  it("refuse toute adresse désignant la machine ou son réseau", async () => {
    for (const url of [
      "https://localhost/p.png",
      "https://127.0.0.1/p.png",
      "https://[::1]/p.png",
      "https://10.0.0.5/p.png",
      "https://192.168.1.4/p.png",
      "https://169.254.169.254/latest/meta-data",
      "https://console.internal/p.png",
    ]) {
      await expect(importRemoteAvatar(url, 1)).resolves.toBeNull();
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("refuse ce qui n'est pas une URL", async () => {
    await expect(importRemoteAvatar("pas une url", 1)).resolves.toBeNull();
    await expect(importRemoteAvatar("javascript:alert(1)", 1)).resolves.toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

/**
 * `fetchRemoteImage` est le code que se partagent le relais des logos
 * partenaires et cet import. Il l'était auparavant sous forme de copie
 * potentielle : la fonction vivait dans la route du relais, et un second
 * appelant l'aurait dupliquée — avec, tôt ou tard, une garde en moins d'un
 * côté.
 */
describe("fetchRemoteImage", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function respond(init: { status?: number; headers?: Record<string, string>; body?: Uint8Array }) {
    return new Response(init.body ? (init.body as unknown as BodyInit) : null, {
      status: init.status ?? 200,
      headers: init.headers ?? {},
    });
  }

  it("rend les octets quand l'hôte répond une image", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = jest.fn(async () =>
      respond({ headers: { "content-type": "image/png" }, body: bytes }),
    ) as never;

    const fetched = await fetchRemoteImage(new URL("https://exemple.test/p.png"));
    expect(fetched?.contentType).toBe("image/png");
    expect(fetched?.body.byteLength).toBe(4);
  });

  // Un SVG est un document scriptable : le servir depuis notre origine
  // reviendrait à laisser un tiers exécuter du script sur le site.
  it("refuse un type qui n'est pas une image que nous servons", async () => {
    globalThis.fetch = jest.fn(async () =>
      respond({ headers: { "content-type": "image/svg+xml" }, body: new Uint8Array([1]) }),
    ) as never;

    await expect(fetchRemoteImage(new URL("https://exemple.test/p.svg"))).resolves.toBeNull();
  });

  /**
   * La garde qui justifie de suivre les redirections **à la main** : `fetch`
   * les suivrait jusqu'à n'importe quelle destination, ce qui rendrait le
   * filtre d'hôte contournable par une simple réponse 302.
   */
  it("revalide l'hôte à chaque redirection", async () => {
    globalThis.fetch = jest.fn(async () =>
      respond({ status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } }),
    ) as never;

    await expect(fetchRemoteImage(new URL("https://exemple.test/p.png"))).resolves.toBeNull();
  });

  it("abandonne au-delà du nombre de sauts autorisé", async () => {
    globalThis.fetch = jest.fn(async () =>
      respond({ status: 302, headers: { location: "https://exemple.test/encore" } }),
    ) as never;

    await expect(
      fetchRemoteImage(new URL("https://exemple.test/p.png"), { maxRedirects: 2 }),
    ).resolves.toBeNull();
    // Le saut initial plus les deux autorisés : la boucle ne tourne pas sans fin.
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("refuse sur la taille annoncée, sans lire le corps", async () => {
    globalThis.fetch = jest.fn(async () =>
      respond({
        headers: { "content-type": "image/png", "content-length": String(50 * 1024 * 1024) },
        body: new Uint8Array([1]),
      }),
    ) as never;

    await expect(fetchRemoteImage(new URL("https://exemple.test/p.png"))).resolves.toBeNull();
  });

  // Un en-tête absent ou menteur reste possible : le plafond doit aussi se
  // vérifier une fois les octets en main.
  it("refuse sur la taille réelle quand rien n'était annoncé", async () => {
    globalThis.fetch = jest.fn(async () =>
      respond({ headers: { "content-type": "image/png" }, body: new Uint8Array(64) }),
    ) as never;

    await expect(
      fetchRemoteImage(new URL("https://exemple.test/p.png"), { maxBytes: 32 }),
    ).resolves.toBeNull();
  });

  it("refuse un corps vide, qui n'est pas une image", async () => {
    globalThis.fetch = jest.fn(async () =>
      respond({ headers: { "content-type": "image/png" }, body: new Uint8Array(0) }),
    ) as never;

    await expect(fetchRemoteImage(new URL("https://exemple.test/p.png"))).resolves.toBeNull();
  });

  it("rend null plutôt que de lever quand l'hôte est injoignable", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as never;

    await expect(fetchRemoteImage(new URL("https://exemple.test/p.png"))).resolves.toBeNull();
  });
});
