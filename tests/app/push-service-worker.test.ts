/**
 * Le service worker des notifications (`public/push-sw.js`), exécuté dans un
 * bac à sable avec un `self` simulé : il affiche ce que le serveur pousse,
 * n'ouvre qu'une page du site, et ne fait rien d'autre.
 */
import { runInNewContext } from "node:vm";
import { describe, expect, it, jest } from "@jest/globals";
import { readSource } from "../helpers/read-source";

type Listener = (event: Record<string, unknown>) => void;

function loadWorker(windows: { url: string; focus: unknown; navigate?: unknown }[] = []) {
  const listeners = new Map<string, Listener>();
  const showNotification = jest.fn(async () => undefined);
  const openWindow = jest.fn(async (_url: string) => null);
  const self = {
    location: { origin: "https://site.test" },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: jest.fn(),
    registration: { showNotification, pushManager: { subscribe: jest.fn() } },
    clients: { claim: jest.fn(async () => undefined), matchAll: jest.fn(async () => windows), openWindow },
  };
  runInNewContext(readSource("public/push-sw.js"), { self, URL, fetch: jest.fn() });
  const waited: Promise<unknown>[] = [];
  const fire = (type: string, event: Record<string, unknown>) =>
    listeners.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => waited.push(promise) });
  return { listeners, showNotification, openWindow, fire, waited };
}

describe("service worker des notifications", () => {
  it("n'écoute que ce qu'il sert : aucun cache, aucune interception", () => {
    expect([...loadWorker().listeners.keys()].sort()).toEqual([
      "activate",
      "install",
      "notificationclick",
      "push",
      "pushsubscriptionchange",
    ]);
    expect(readSource("public/push-sw.js")).not.toMatch(/caches\.|addEventListener\("fetch"/);
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
