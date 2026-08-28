/**
 * Diffusion des instantanés de tournoi aux abonnés du flux SSE.
 *
 * # Le problème
 *
 * Avant ce module, le flux SSE ne transportait qu'un signal : « quelque chose a
 * changé ». Chaque client répondait en rechargeant le détail complet du
 * tournoi. Un score rapporté devant cent spectateurs produisait donc cent
 * requêtes simultanées sur la lecture la plus coûteuse du site — un pool MySQL
 * de 25 connexions et un Raspberry Pi devant. Pire : cette avalanche partait à
 * chaque score, c'est-à-dire au pire moment, quand les gens regardent.
 *
 * # Ce qu'on fait à la place
 *
 * Une **salle** par tournoi suivi. Le serveur calcule l'instantané une fois
 * (`tournaments/snapshot`), l'encode une fois, et écrit la même trame à tous
 * les abonnés. Le coût en base devient indépendant du nombre de spectateurs.
 *
 * Trois réglages complètent le dispositif :
 *
 * - **Regroupement par palier** — les abonnés prioritaires (staff, engagés)
 *   reçoivent la mise à jour dans la seconde ; les spectateurs, par fenêtres
 *   plus larges. Ce n'est pas la base qu'on ménage ici mais la bande passante :
 *   l'instantané d'un gros tournoi pèse quelques dizaines de kilo-octets, et il
 *   part vers tout le monde d'un coup.
 * - **Budget de sortie** — la fenêtre s'élargit d'elle-même quand la salle est
 *   lourde ({@link ROOM_BYTES_PER_SECOND}). Une salle de 128 inscrits sur un
 *   plateau de 254 matchs ralentit au lieu de saturer le lien.
 * - **Comparaison de version** — rien n'est envoyé si le contenu n'a pas bougé.
 * - **Battement d'entretien** — la salle relit l'instantané périodiquement,
 *   ce qui fait avancer ce qui dépend de l'heure et non d'une action : ouverture
 *   des inscriptions, début du tournoi, arbitrage d'un report expiré. Là encore,
 *   une seule passe pour toute la salle.
 *
 * Résultat côté joueur : le plateau se met à jour tout seul, y compris quand
 * personne ne touche à rien. Plus aucune raison de marteler F5.
 */
import { subscribeTournament } from "./live";
import { getTournamentSnapshotFrame } from "./tournaments/snapshot";
import { REFRESH_CADENCE, type RefreshTier } from "@/lib/shared/refresh-tiers";
import { nextTournamentStateChangeAt } from "@/lib/shared/tournament-state";

/**
 * Cadence du battement d'entretien d'une salle occupée. C'est ce qui rattrape
 * les changements qu'aucune écriture n'annonce (une heure qui arrive).
 */
export const ROOM_MAINTENANCE_MS = 30_000;

/**
 * Plafond de flux simultanés par utilisateur. Un onglet en ouvre un ; le
 * plafond n'existe que pour qu'un client en boucle de reconnexion, ou vingt
 * onglets oubliés, ne mobilisent pas la machine à eux seuls.
 */
export const MAX_STREAMS_PER_USER = 4;

/**
 * Budget de sortie d'une salle, en octets par seconde.
 *
 * Le regroupement par palier borne la *fréquence* des envois, pas leur poids.
 * Or l'instantané d'un tournoi à 128 équipes en double élimination pèse ~150 ko
 * (254 matchs) — et dans un tournoi de cette taille, les inscrits, tous
 * prioritaires, sont 128. Un score rapporté produirait donc près de 20 Mo à
 * écrire d'un coup : le lien du Raspberry Pi ne suit pas, et la mémoire des
 * tampons de socket monte d'autant.
 *
 * Le budget convertit ce poids en attente : plus la salle est lourde, plus les
 * envois s'espacent. Une petite salle n'est jamais concernée (son poids est
 * absorbé bien avant la fenêtre du palier) ; une grosse salle ralentit au lieu
 * de saturer. Celui qui vient d'agir, lui, ne subit pas cette attente : sa page
 * relit immédiatement de son côté.
 */
export const ROOM_BYTES_PER_SECOND = 512 * 1024;

/**
 * Plafond de l'attente induite par le budget. Au-delà, on préfère dépasser un
 * peu le budget plutôt que de laisser une salle muette trop longtemps.
 */
export const MAX_BUDGET_DELAY_MS = 60_000;

/**
 * Attente imposée par le budget pour écrire `frameBytes` à `subscribers`
 * abonnés. Exportée pour être vérifiable directement.
 */
export function budgetDelayMs(frameBytes: number, subscribers: number): number {
  if (subscribers <= 0 || frameBytes <= 0) return 0;
  const totalBytes = frameBytes * subscribers;
  return Math.min(MAX_BUDGET_DELAY_MS, Math.ceil((totalBytes * 1000) / ROOM_BYTES_PER_SECOND));
}

/** Un abonné : son palier de fraîcheur et par où lui écrire. */
export type TournamentSubscriber = {
  tier: RefreshTier;
  /** Écrit une trame déjà encodée. Doit lever si la connexion est fermée. */
  send: (frame: Uint8Array) => void;
};

type TierState = { lastSentAt: number; lastVersion: string | null };

type Room = {
  subscribers: Set<TournamentSubscriber>;
  tiers: Map<RefreshTier, TierState>;
  unsubscribe: () => void;
  maintenance: ReturnType<typeof setInterval>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Instant visé par `flushTimer`, pour qu'une demande plus urgente le devance. */
  flushAt: number;
  flushing: boolean;
  /** Un changement est arrivé pendant un envoi : il faudra repasser. */
  dirtyAgain: boolean;
};

const rooms = new Map<number, Room>();
const streamsPerUser = new Map<number, number>();

function tierState(room: Room, tier: RefreshTier): TierState {
  let state = room.tiers.get(tier);
  if (!state) {
    state = { lastSentAt: 0, lastVersion: null };
    room.tiers.set(tier, state);
  }
  return state;
}

/** Paliers effectivement représentés dans la salle. */
function activeTiers(room: Room): RefreshTier[] {
  const tiers = new Set<RefreshTier>();
  for (const subscriber of room.subscribers) tiers.add(subscriber.tier);
  return [...tiers];
}

function closeRoom(tournamentId: number, room: Room): void {
  room.unsubscribe();
  clearInterval(room.maintenance);
  if (room.flushTimer) clearTimeout(room.flushTimer);
  rooms.delete(tournamentId);
}

/**
 * Programme un envoi dans `delayMs`. Le plus urgent gagne : une demande plus
 * tardive ne repousse jamais un envoi déjà en attente, et une demande plus
 * pressante avance le minuteur.
 */
function scheduleFlush(tournamentId: number, room: Room, delayMs: number): void {
  const delay = Math.max(0, delayMs);
  const target = Date.now() + delay;

  if (room.flushTimer) {
    if (room.flushAt <= target) return;
    clearTimeout(room.flushTimer);
  }

  room.flushAt = target;
  room.flushTimer = setTimeout(() => {
    room.flushTimer = null;
    void flush(tournamentId, room);
  }, delay);
  room.flushTimer.unref?.();
}

/**
 * Recalcule l'instantané et l'envoie aux paliers dont la fenêtre de
 * regroupement est écoulée. Les autres sont reprogrammés pour le reliquat.
 */
async function flush(tournamentId: number, room: Room): Promise<void> {
  if (room.flushing) {
    room.dirtyAgain = true;
    return;
  }
  if (room.subscribers.size === 0) return;

  room.flushing = true;
  try {
    const frame = await getTournamentSnapshotFrame(tournamentId).catch(() => null);
    if (!frame || room.subscribers.size === 0) return;

    const now = Date.now();
    let nextDelay = Number.POSITIVE_INFINITY;

    for (const tier of activeTiers(room)) {
      const state = tierState(room, tier);
      if (state.lastVersion === frame.version) continue;

      const audience = [...room.subscribers].filter((subscriber) => subscriber.tier === tier);

      // La fenêtre effective est la plus large des deux : celle du palier, et
      // celle qu'impose le poids de ce qu'on s'apprête à écrire.
      const elapsed = now - state.lastSentAt;
      const coalesceWindow = Math.max(
        REFRESH_CADENCE[tier].pushCoalesceMs,
        budgetDelayMs(frame.frame.byteLength, audience.length),
      );
      if (elapsed < coalesceWindow) {
        nextDelay = Math.min(nextDelay, coalesceWindow - elapsed);
        continue;
      }

      for (const subscriber of audience) {
        try {
          subscriber.send(frame.frame);
        } catch {
          // Connexion fermée entre-temps : on la retire et on continue.
          room.subscribers.delete(subscriber);
        }
      }

      state.lastSentAt = now;
      state.lastVersion = frame.version;
    }

    if (room.subscribers.size === 0) {
      closeRoom(tournamentId, room);
      return;
    }

    // Réveil à l'heure exacte de la prochaine bascule d'état (ouverture des
    // inscriptions, début du tournoi). Sans lui, il faudrait attendre le
    // battement d'entretien — ou compter sur chaque client pour se réveiller
    // seul, ce qui ferait repartir cent requêtes à la même seconde.
    const boundary = nextTournamentStateChangeAt(
      {
        state: frame.snapshot.card.state,
        registrationOpenAt: frame.snapshot.card.registrationOpenAt,
        registrationCloseAt: frame.snapshot.card.registrationCloseAt,
        startAt: frame.snapshot.card.startAt,
      },
      now,
    );
    if (boundary !== null) nextDelay = Math.min(nextDelay, boundary - now);

    if (Number.isFinite(nextDelay)) scheduleFlush(tournamentId, room, nextDelay);
  } finally {
    room.flushing = false;
    if (room.dirtyAgain) {
      room.dirtyAgain = false;
      if (room.subscribers.size > 0) scheduleFlush(tournamentId, room, 0);
    }
  }
}

function openRoom(tournamentId: number): Room {
  const room: Room = {
    subscribers: new Set<TournamentSubscriber>(),
    tiers: new Map<RefreshTier, TierState>(),
    unsubscribe: () => undefined,
    maintenance: setInterval(() => {
      const current = rooms.get(tournamentId);
      if (current) void flush(tournamentId, current);
    }, ROOM_MAINTENANCE_MS),
    flushTimer: null,
    flushAt: 0,
    flushing: false,
    dirtyAgain: false,
  };
  room.maintenance.unref?.();

  // L'événement lui-même ne sert qu'à réveiller la salle : ce qui part aux
  // abonnés, c'est l'instantané recalculé, identique quel que soit le
  // déclencheur.
  room.unsubscribe = subscribeTournament(tournamentId, () => {
    scheduleFlush(tournamentId, room, 0);
  });

  rooms.set(tournamentId, room);
  return room;
}

/**
 * Abonne un lecteur aux instantanés d'un tournoi. Renvoie la fonction de
 * désabonnement ; la salle se ferme d'elle-même quand elle se vide.
 */
export function joinTournamentRoom(
  tournamentId: number,
  subscriber: TournamentSubscriber,
): () => void {
  const room = rooms.get(tournamentId) ?? openRoom(tournamentId);
  room.subscribers.add(subscriber);

  return () => {
    room.subscribers.delete(subscriber);
    if (room.subscribers.size === 0 && rooms.get(tournamentId) === room) {
      closeRoom(tournamentId, room);
    }
  };
}

/**
 * Réserve un flux pour cet utilisateur, ou `null` si son plafond est atteint.
 * La fonction rendue libère la place — elle doit être appelée à la fermeture.
 */
export function acquireStreamSlot(userId: number): (() => void) | null {
  const open = streamsPerUser.get(userId) ?? 0;
  if (open >= MAX_STREAMS_PER_USER) return null;

  streamsPerUser.set(userId, open + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = streamsPerUser.get(userId) ?? 0;
    if (current <= 1) streamsPerUser.delete(userId);
    else streamsPerUser.set(userId, current - 1);
  };
}

/** Nombre d'abonnés d'un tournoi (diagnostic, page d'accueil). */
export function tournamentAudience(tournamentId: number): number {
  return rooms.get(tournamentId)?.subscribers.size ?? 0;
}

/** Remet la diffusion à zéro. Réservé aux tests. */
export function resetTournamentBroadcast(): void {
  for (const [tournamentId, room] of [...rooms]) closeRoom(tournamentId, room);
  rooms.clear();
  streamsPerUser.clear();
}
