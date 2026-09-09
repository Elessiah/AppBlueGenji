/**
 * Garde-fous du flux d'activité du bot (`/api/bot/feed/stream`).
 *
 * Cette route est la seule du site à tenir une connexion longue **sans compte** :
 * `/bot` est une page de vitrine, et son bandeau d'activité doit rester lisible
 * par un visiteur de passage. Les trois gardes du flux de tournoi ne s'y
 * transposent donc pas telles quelles — `getCurrentUser` en fermerait la porte,
 * et `acquireStreamSlot` compte par utilisateur, ce qu'un anonyme n'a pas.
 *
 * Or chaque lecteur y ouvre **deux** connexions : la sienne, et celle que l'app
 * ouvre vers le bot pour l'alimenter. Sans plafond, une poignée d'onglets suffit
 * à immobiliser autant de sockets des deux côtés.
 *
 * D'où deux plafonds, et non un :
 *
 * - **par client** ({@link MAX_BOT_FEED_STREAMS_PER_CLIENT}), qui borne l'onglet
 *   oublié et la boucle de reconnexion ;
 * - **global** ({@link MAX_BOT_FEED_STREAMS}), qui borne tout le reste.
 *
 * Le second n'est pas une ceinture de plus : l'identité d'un visiteur anonyme
 * est son IP, et elle n'est connue que si un proxy de confiance l'a posée
 * (`requestClientIp`). Là où elle manque, le plafond par client ne borne rien —
 * `enforceRateLimit` fait le même constat et préfère ne pas compter que compter
 * faux. Le plafond global, lui, tient dans tous les cas.
 */

/**
 * Flux simultanés par client. Un onglet en ouvre un ; trois laissent la place à
 * quelques onglets et à une reconnexion qui se recouvre.
 */
export const MAX_BOT_FEED_STREAMS_PER_CLIENT = 3;

/**
 * Flux simultanés, tous clients confondus. La page `/bot` est une vitrine, pas
 * le cœur du site : quarante lecteurs en direct y sont déjà une affluence, et
 * c'est autant de sockets tenues vers le bot.
 */
export const MAX_BOT_FEED_STREAMS = 40;

let open = 0;
const perClient = new Map<string, number>();

/**
 * Réserve une place, ou `null` si l'un des deux plafonds est atteint.
 *
 * `clientKey` vaut `null` quand l'IP n'est pas connue : seul le plafond global
 * s'applique alors. La fonction rendue libère la place et **peut être appelée
 * plusieurs fois** — un flux se termine par plusieurs portes (fin de l'amont,
 * annulation du corps, abandon de la requête), et aucune ne sait si une autre
 * l'a précédée.
 */
export function acquireBotFeedSlot(clientKey: string | null): (() => void) | null {
  if (open >= MAX_BOT_FEED_STREAMS) return null;

  const held = clientKey === null ? 0 : perClient.get(clientKey) ?? 0;
  if (clientKey !== null && held >= MAX_BOT_FEED_STREAMS_PER_CLIENT) return null;

  open += 1;
  if (clientKey !== null) perClient.set(clientKey, held + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    open -= 1;
    if (clientKey === null) return;
    const current = perClient.get(clientKey) ?? 0;
    if (current <= 1) perClient.delete(clientKey);
    else perClient.set(clientKey, current - 1);
  };
}

/** Nombre de flux ouverts (diagnostic, tests). */
export function botFeedStreamCount(): number {
  return open;
}

/** Remet les compteurs à zéro. Réservé aux tests. */
export function resetBotFeedSlots(): void {
  open = 0;
  perClient.clear();
}
