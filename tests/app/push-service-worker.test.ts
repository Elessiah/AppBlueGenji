/**
 * Le service worker des notifications (`public/push-sw.js`), exécuté dans un
 * bac à sable avec un `self` simulé : il affiche ce que le serveur pousse,
 * n'ouvre qu'une page du site, et ne fait rien d'autre.
 */
import { runInNewContext } from "node:vm";
import { describe, expect, it, jest } from "@jest/globals";
import { readSource } from "../helpers/read-source";

type Listener = (event: Record<string, unknown>) => void;

const OFFLINE_PAGE = { offline: true };

function loadWorker(
  windows: { url: string; focus: unknown; navigate?: unknown }[] = [],
  options: { fetch?: (request: unknown) => Promise<unknown>; cacheNames?: string[] } = {},
) {
  const listeners = new Map<string, Listener>();
  const showNotification = jest.fn(async () => undefined);
  const openWindow = jest.fn(async (_url: string) => null);
  const cacheAdd = jest.fn(async (_request: unknown) => undefined);
  const caches = {
    open: jest.fn(async (_name: string) => ({ add: cacheAdd })),
    keys: jest.fn(async () => options.cacheNames ?? []),
    delete: jest.fn(async (_name: string) => true),
    match: jest.fn(async (_url: string, _options: unknown): Promise<unknown> => OFFLINE_PAGE),
  };
  const enablePreload = jest.fn(async () => undefined);
  const fetch = jest.fn(options.fetch ?? (async () => ({ network: true })));
  const self = {
    location: { origin: "https://site.test" },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: jest.fn(async () => undefined),
    registration: {
      showNotification,
      pushManager: { subscribe: jest.fn() },
      navigationPreload: { enable: enablePreload },
    },
    clients: { claim: jest.fn(async () => undefined), matchAll: jest.fn(async () => windows), openWindow },
  };
  class FakeRequest {
    constructor(
      public url: string,
      public init: unknown,
    ) {}
  }
  runInNewContext(readSource("public/push-sw.js"), { self, URL, fetch, caches, Request: FakeRequest });
  const waited: Promise<unknown>[] = [];
  const responded: Promise<unknown>[] = [];
  const fire = (type: string, event: Record<string, unknown>) =>
    listeners.get(type)!({
      ...event,
      waitUntil: (promise: Promise<unknown>) => waited.push(promise),
      respondWith: (promise: Promise<unknown>) => responded.push(promise),
    });
  return { self, listeners, showNotification, openWindow, fire, waited, responded, caches, cacheAdd, fetch, enablePreload };
}

describe("service worker du site", () => {
  it("n'écoute que ce qu'il sert", () => {
    expect([...loadWorker().listeners.keys()].sort()).toEqual([
      "activate",
      "fetch",
      "install",
      "notificationclick",
      "push",
      "pushsubscriptionchange",
    ]);
  });

  it("ne met en cache que la page hors ligne, et rien du site", async () => {
    const worker = loadWorker();
    worker.fire("install", {});
    await Promise.all(worker.waited);
    expect(worker.cacheAdd).toHaveBeenCalledTimes(1);
    const [request] = worker.cacheAdd.mock.calls[0] as [{ url: string; init: unknown }];
    expect(request).toMatchObject({ url: "/offline.html", init: { cache: "reload" } });
    expect(worker.self.skipWaiting).toHaveBeenCalled();
    // Aucune autre écriture de cache n'existe dans le fichier.
    expect(readSource("public/push-sw.js")).not.toMatch(/\.put\(|addAll\(/);
  });

  it("à l'activation, efface ses anciennes versions et elles seules", async () => {
    const worker = loadWorker([], { cacheNames: ["bg-offline-v0", "bg-offline-v1", "autre-cache"] });
    worker.fire("activate", {});
    await Promise.all(worker.waited);
    expect(worker.caches.delete.mock.calls.map(([name]) => name)).toEqual(["bg-offline-v0"]);
    expect(worker.enablePreload).toHaveBeenCalled();
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });

  it("laisse passer tout ce qui n'est pas une navigation", () => {
    const worker = loadWorker();
    worker.fire("fetch", { request: { mode: "cors" } });
    worker.fire("fetch", { request: { mode: "no-cors" } });
    expect(worker.responded).toHaveLength(0);
  });

  it("une navigation part au réseau, préchargement d'abord", async () => {
    const preloaded = { preloaded: true };
    const worker = loadWorker();
    worker.fire("fetch", { request: { mode: "navigate" }, preloadResponse: Promise.resolve(preloaded) });
    worker.fire("fetch", { request: { mode: "navigate" }, preloadResponse: Promise.resolve(undefined) });
    const [first, second] = await Promise.all(worker.responded);
    expect(first).toBe(preloaded);
    expect(second).toEqual({ network: true });
    expect(worker.caches.match).not.toHaveBeenCalled();
  });

  it("une erreur HTTP reste la réponse du serveur", async () => {
    const notFound = { status: 404 };
    const worker = loadWorker([], { fetch: async () => notFound });
    worker.fire("fetch", { request: { mode: "navigate" } });
    expect(await worker.responded[0]).toBe(notFound);
    expect(worker.caches.match).not.toHaveBeenCalled();
  });

  it("sans réseau, rend la page hors ligne", async () => {
    const worker = loadWorker([], {
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    worker.fire("fetch", { request: { mode: "navigate" } });
    expect(await worker.responded[0]).toBe(OFFLINE_PAGE);
    expect(worker.caches.match).toHaveBeenCalledWith("/offline.html", { cacheName: "bg-offline-v1" });
  });

  it("sans réseau ni page en cache, rend l'échec d'origine", async () => {
    const failure = new TypeError("Failed to fetch");
    const worker = loadWorker([], {
      fetch: async () => {
        throw failure;
      },
    });
    worker.caches.match.mockResolvedValueOnce(undefined);
    worker.fire("fetch", { request: { mode: "navigate" } });
    await expect(worker.responded[0]).rejects.toBe(failure);
  });

  it("affiche le message poussé, avec son étiquette et son lien", async () => {
    const worker = loadWorker();
    worker.fire("push", {
      data: { json: () => ({ title: "Ton match commence", body: "Déclare-toi prêt.", url: "/tournois/4#match-9", tag: "t" }) },
    });
    await Promise.all(worker.waited);
    const [title, options] = worker.showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(title).toBe("Ton match commence");
    expect(options).toMatchObject({ body: "Déclare-toi prêt.", tag: "t", data: { url: "/tournois/4#match-9" } });
  });

  it("porte l'icône de l'app déclarée au manifeste", async () => {
    const { APP_ICONS } = await import("@/lib/shared/web-manifest");
    const worker = loadWorker();
    worker.fire("push", { data: { json: () => ({ title: "x" }) } });
    await Promise.all(worker.waited);
    const [, options] = worker.showNotification.mock.calls[0] as unknown as [string, { icon: string }];
    expect(APP_ICONS.map((icon) => icon.src)).toContain(options.icon);
  });

  it("ramène un lien étranger ou un message illisible à l'accueil du site", async () => {
    const worker = loadWorker();
    worker.fire("push", { data: { json: () => ({ title: "x", url: "//evil.test" }) } });
    worker.fire("push", {
      data: {
        json: () => {
          throw new Error("illisible");
        },
      },
    });
    await Promise.all(worker.waited);
    const calls = worker.showNotification.mock.calls as unknown as [string, { data: { url: string } }][];
    expect(calls[0][1].data.url).toBe("/");
    expect(calls[1][0]).toBe("BlueGenji Esport");
  });

  it("au clic, rend le focus à l'onglet déjà ouvert sur la page", async () => {
    const focus = jest.fn(async () => undefined);
    const worker = loadWorker([{ url: "https://site.test/tournois/4", focus }]);
    const close = jest.fn();
    worker.fire("notificationclick", { notification: { close, data: { url: "/tournois/4#match-9" } } });
    await Promise.all(worker.waited);
    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("mène l'onglet ouvert jusqu'au match visé quand l'ancre diffère", async () => {
    const focused = jest.fn(async () => undefined);
    const navigate = jest.fn(async (_url: string) => ({ focus: focused }));
    const worker = loadWorker([{ url: "https://site.test/tournois/4", focus: jest.fn(), navigate }]);
    worker.fire("notificationclick", { notification: { close: jest.fn(), data: { url: "/tournois/4#match-9" } } });
    await Promise.all(worker.waited);
    expect(navigate).toHaveBeenCalledWith("https://site.test/tournois/4#match-9");
    expect(focused).toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("sinon ouvre la page — toujours sur le site", async () => {
    const worker = loadWorker([{ url: "https://site.test/equipes", focus: jest.fn() }]);
    worker.fire("notificationclick", { notification: { close: jest.fn(), data: { url: "https://evil.test/x" } } });
    await Promise.all(worker.waited);
    expect(worker.openWindow).toHaveBeenCalledWith("https://site.test/");
  });
});

describe("page hors ligne", () => {
  const page = readSource("public/offline.html");

  it("est autonome : ni script, ni ressource à aller chercher", () => {
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/<link\b/i);
    expect(page).not.toMatch(/<img\b|url\(/i);
    expect(page).not.toMatch(/https?:\/\//);
  });

  it("est en français, titrée, et son bouton recharge l'adresse demandée", () => {
    expect(page).toMatch(/<html lang="fr">/);
    expect(page).toMatch(/<title>[^<]+<\/title>/);
    expect(page).toMatch(/<a href="">Réessayer<\/a>/);
  });

  it("prend le fond de l'app installée", async () => {
    const { APP_BACKGROUND_COLOR } = await import("@/lib/shared/web-manifest");
    expect(page).toContain(`--bg: ${APP_BACKGROUND_COLOR};`);
    expect(page).toContain(`name="theme-color" content="${APP_BACKGROUND_COLOR}"`);
  });

  it("est posée pour tout visiteur, par le même service worker que les notifications", async () => {
    const { PUSH_SERVICE_WORKER_PATH } = await import("@/lib/shared/push-notifications");
    expect(PUSH_SERVICE_WORKER_PATH).toBe("/push-sw.js");
    expect(readSource("app/layout.tsx")).toMatch(/<ServiceWorkerRegistration \/>/);
    const registerCall = /register\(PUSH_SERVICE_WORKER_PATH, \{ scope: "\/" \}\)/;
    expect(readSource("components/service-worker-registration.tsx")).toMatch(registerCall);
    expect(readSource("components/notifications/usePushNotifications.ts")).toMatch(registerCall);
  });
});
