/*
 * Service worker des notifications push — BlueGenji Esport.
 *
 * Il ne fait **que** cela : afficher ce que le serveur pousse, et ouvrir la
 * bonne page au clic. Aucun cache, aucune interception de requête — le site
 * n'est pas une application hors ligne, et un service worker qui mettrait des
 * pages en cache servirait des plateaux périmés.
 *
 * Le contenu vient du serveur (`lib/shared/push-notifications.ts`,
 * `buildPushPayload`), déjà borné ; il est tout de même relu ici comme une
 * entrée : un lien ne peut mener qu'à une page du site.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
    icon: "/apple-touch-icon.png",
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
  const target = new URL(sitePath(event.notification.data && event.notification.data.url), self.location.origin);
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
  const options = event.oldSubscription && event.oldSubscription.options;
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
