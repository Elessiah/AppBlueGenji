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
 * faux. Le plafond global, lui, tient dans tous les cas — et, atteint, il se
 * **partage** entre clients au lieu de refuser tout nouveau venu.
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

/**
 * Une place tenue : son client (`null` = IP inconnue) et de quoi fermer le flux
 * qui l'occupe.
 */
type Slot = { clientKey: string | null; evict: () => void; released: boolean };

/** Places tenues, de la plus ancienne à la plus récente. */
const slots: Slot[] = [];
/**
 * Places par client **identifié**. Les visiteurs sans IP connue n'y figurent
 * pas : rien ne dit que deux d'entre eux sont la même personne, les compter
 * ensemble ferait déloger un lecteur à un seul onglet au motif que d'autres
 * inconnus en tiennent. Chacun vaut donc un client à une place — jamais une
 * cible du partage, et jamais un nouveau venu qui en tiendrait déjà.
 */
const perClient = new Map<string, number>();

function heldBy(clientKey: string | null): number {
  return clientKey === null ? 0 : perClient.get(clientKey) ?? 0;
}

function releaseSlot(slot: Slot): void {
  if (slot.released) return;
  slot.released = true;
  const index = slots.indexOf(slot);
  if (index >= 0) slots.splice(index, 1);
  if (slot.clientKey === null) return;
  const current = heldBy(slot.clientKey);
  if (current <= 1) perClient.delete(slot.clientKey);
  else perClient.set(slot.clientKey, current - 1);
}

/**
 * Le flux à fermer pour faire place à un client qui en tient déjà `held`, ou
 * `null` s'il n'y a pas lieu d'en fermer un.
 *
 * Le plafond global était un seau commun : quatorze IP gardant chacune trois
 * flux ouverts privaient **tous** les visiteurs de `/bot` du direct, en 429
 * permanent. Plein, il se partage désormais : le client qui tient le **plus**
 * de flux cède le plus ancien des siens, pourvu qu'il en tienne strictement
 * plus que le nouveau venu n'en aurait une fois servi. Un lecteur ordinaire
 * (un onglet) déloge donc un client qui en accumule, jamais un autre lecteur
 * ordinaire — et le client délogé ne reprend pas sa place en se reconnectant,
 * puisqu'il n'en tient alors pas plus que les autres. Pour fermer le direct à
 * tous, il faut désormais une IP par place, et non plus une par trois.
 */
function slotToEvict(held: number): Slot | null {
  let victimKey: string | undefined;
  let victimHeld = held + 1;
  for (const [key, count] of perClient) {
    if (count > victimHeld) {
      victimKey = key;
      victimHeld = count;
    }
  }
  if (victimKey === undefined) return null;
  return slots.find((slot) => slot.clientKey === victimKey) ?? null;
}

/**
 * Réserve une place, ou `null` si l'un des deux plafonds est atteint.
 *
 * `clientKey` vaut `null` quand l'IP n'est pas connue : seul le plafond global
 * s'applique alors. Plein, le plafond global se **partage** plutôt que de
 * refuser (voir `slotToEvict`) : `evict` est alors appelé sur le flux délogé,
 * qui doit se fermer — sa place est rendue dans le même geste.
 *
 * La fonction rendue libère la place et **peut être appelée plusieurs fois** —
 * un flux se termine par plusieurs portes (fin de l'amont, annulation du corps,
 * abandon de la requête, éviction), et aucune ne sait si une autre l'a
 * précédée.
 */
export function acquireBotFeedSlot(
  clientKey: string | null,
  evict: () => void = () => undefined,
  options: { allowEviction?: boolean } = {},
): (() => void) | null {
  const held = heldBy(clientKey);
  if (clientKey !== null && held >= MAX_BOT_FEED_STREAMS_PER_CLIENT) return null;

  if (slots.length >= MAX_BOT_FEED_STREAMS) {
    const victim = options.allowEviction === false ? null : slotToEvict(held);
    if (!victim) return null;
    releaseSlot(victim);
    try {
      victim.evict();
    } catch {
      // Fermer un flux déjà parti n'est pas un échec : la place est rendue.
    }
  }

  const slot: Slot = { clientKey, evict, released: false };
  slots.push(slot);
  if (clientKey !== null) perClient.set(clientKey, held + 1);
  return () => releaseSlot(slot);
}

/**
 * Vrai si `acquireBotFeedSlot` accorderait une place à ce client maintenant,
 * au besoin en délogeant un flux — sans rien réserver ni déloger.
 *
 * Sert à la route à refuser **avant** d'appeler le bot, et à ne déloger qu'une
 * fois le bot joint : délogé pour un nouveau venu que le bot injoignable
 * laisse sans rien, un lecteur aurait été coupé pour rien, et chaque
 * reconnexion automatique en couperait un autre.
 */
export function canAcquireBotFeedSlot(clientKey: string | null): boolean {
  const held = heldBy(clientKey);
  if (clientKey !== null && held >= MAX_BOT_FEED_STREAMS_PER_CLIENT) return false;
  return slots.length < MAX_BOT_FEED_STREAMS || slotToEvict(held) !== null;
}

/** Nombre de flux ouverts (diagnostic, tests). */
export function botFeedStreamCount(): number {
  return slots.length;
}

/** Remet les compteurs à zéro. Réservé aux tests. */
export function resetBotFeedSlots(): void {
  slots.length = 0;
  perClient.clear();
}
