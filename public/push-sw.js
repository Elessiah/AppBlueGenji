/*
 * Service worker du site — BlueGenji Esport. Un seul, à la racine : deux
 * service workers ne partagent pas une portée, le second remplacerait le
 * premier. Le fichier garde son nom d'origine pour que les appareils déjà
 * abonnés aux notifications reçoivent cette version sans rien refaire.
 *
 * Il fait deux choses, et seulement deux :
 *
 * 1. **Les notifications push** — afficher ce que le serveur pousse, et ouvrir
 *    la bonne page au clic.
 * 2. **La page hors ligne** — quand une *navigation* échoue faute de réseau,
 *    il rend `/offline.html` au lieu de la page d'erreur du navigateur (l'app
 *    installée n'a pas de barre d'adresse : cette page était un cul-de-sac).
 *    C'est le **seul** fichier mis en cache. Aucune page du site, aucune
 *    réponse d'API, aucun plateau : une copie servie hors ligne passerait pour
 *    le direct. Toute navigation part donc au réseau, et le cache n'est lu que
 *    si le réseau a **échoué** — une erreur HTTP (404, 500) est une réponse,
 *    rendue telle quelle.
 *
 * Le contenu des notifications vient du serveur
 * (`lib/shared/push-notifications.ts`, `buildPushPayload`), déjà borné ; il
 * est tout de même relu ici comme une entrée : un lien ne peut mener qu'à une
 * page du site.
 */

// Avancer la version à chaque modification de `public/offline.html` : le
// cache précédent est effacé à l'activation.
const OFFLINE_CACHE_PREFIX = "bg-offline-";
const OFFLINE_CACHE = OFFLINE_CACHE_PREFIX + "v1";
const OFFLINE_URL = "/offline.html";

/**
 * Met la page hors ligne en cache si elle n'y est pas. Ne lève jamais : un
 * échec (réseau instable, déploiement qui répond 502) ne doit pas faire
 * échouer l'installation — le même service worker porte les notifications,
 * dont l'activation attend `serviceWorker.ready`. On retente à la prochaine
 * navigation réussie.
 */
async function ensureOfflinePage() {
  try {
    if (await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE })) return;
    const cache = await caches.open(OFFLINE_CACHE);
    // `reload` : jamais une copie du cache HTTP, qui pourrait dater.
    await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
  } catch (error) {
    // Sans page en cache, une navigation hors ligne garde l'erreur du navigateur.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(ensureOfflinePage().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(OFFLINE_CACHE_PREFIX) && name !== OFFLINE_CACHE)
          .map((name) => caches.delete(name)),
      );
      // Le préchargement fait partir la navigation pendant que le service
      // worker démarre : la page n'attend pas son réveil.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => undefined);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  // Seules les navigations : une image, un script ou un appel d'API qui
  // échoue garde son échec, que la page sait déjà montrer.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        const response = preloaded || (await fetch(event.request));
        // Le réseau répond : c'est le moment de rattraper une page hors ligne
        // que l'installation n'aurait pas pu mettre en cache.
        event.waitUntil(ensureOfflinePage());
        return response;
      } catch (error) {
        const offline = await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE });
        if (offline) return offline;
        throw error;
      }
    })(),
  );
});

function sitePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/";
  }
  return value;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "BlueGenji Esport";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    // L'icône de l'app installée (`APP_ICONS`, `lib/shared/web-manifest.ts`) :
    // la notification porte le même visage que l'icône du site.
    icon: "/icons/icon-192.png",
    badge: "/favicon.png",
    lang: "fr",
    data: { url: sitePath(data.url) },
  };
  // Même étiquette = la notification remplace la précédente sans resonner
  // (lancement puis départ d'un même match).
  if (typeof data.tag === "string" && data.tag) options.tag = data.tag;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(sitePath(event.notification.data?.url), self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        const url = new URL(client.url);
        if (url.origin === target.origin && url.pathname === target.pathname && "focus" in client) {
          // Même page, autre ancre (le match visé) : on y mène l'onglet, sans
          // quoi il reprendrait le focus là où il était, loin du match.
          if (url.href !== target.href && "navigate" in client) {
            const navigated = await client.navigate(target.href).catch(() => null);
            return (navigated || client).focus();
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});

// Le navigateur renouvelle parfois un abonnement de lui-même : le nouveau est
// renvoyé au site, sans quoi l'appareil deviendrait muet sans que personne le
// sache. Sans session (déconnecté), le serveur refuse — le panneau le
// rattachera à la prochaine visite de /profil.
self.addEventListener("pushsubscriptionchange", (event) => {
  const options = event.oldSubscription?.options;
  if (!options) return;
  event.waitUntil(
    self.registration.pushManager.subscribe(options).then((subscription) =>
      fetch("/api/push/subscriptions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      }),
    ),
  );
});
