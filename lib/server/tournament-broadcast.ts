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
 * Cinq réglages complètent le dispositif :
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
 * - **Réveil d'entretien** — la salle relit l'instantané à la prochaine
 *   échéance connue, ce qui fait avancer ce qui dépend de l'heure et non d'une
 *   action : ouverture des inscriptions, début du tournoi, arbitrage d'un report
 *   expiré. Là encore, une seule passe pour toute la salle — et aucune sur un
 *   tournoi terminé, que plus aucune heure ne fait bouger.
 * - **Compression** — chaque trame est compressée une fois pour tous les
 *   abonnés qui acceptent gzip (`./sse-gzip`), et c'est ce poids-là que le
 *   budget de sortie compte.
 *
 * Résultat côté joueur : le plateau se met à jour tout seul, y compris quand
 * personne ne touche à rien. Plus aucune raison de marteler F5.
 */
import { subscribeTournament } from "./live";
import { getTournamentSnapshotFrame, type TournamentSnapshotFrame } from "./tournaments/snapshot";
import { snapshotFrameBytes, type StreamEncoding } from "./tournament-stream-frames";
import { REFRESH_CADENCE, type RefreshTier } from "@/lib/shared/refresh-tiers";
import { computeTournamentState, nextTournamentStateChangeAt } from "@/lib/shared/tournament-state";
import type { TournamentSnapshot } from "@/lib/shared/types";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { autoLaunchAt, matchLaunchPhase } from "@/lib/shared/match-launch";

/**
 * Filet de sécurité d'une salle occupée : au plus tard, elle relit l'instantané
 * au bout de ce délai, même sans échéance connue.
 *
 * Le battement d'entretien rattrape les changements qu'aucune écriture
 * n'annonce — une heure qui arrive : bascule d'état, report de score expiré.
 * Il battait toutes les 30 s pour toutes les salles, et chaque battement
 * reconstruisait l'instantané entier (le cache de 3 s étant toujours expiré) :
 * lectures des matchs, des inscrites et des classements, sérialisation et
 * empreinte de ~238 Ko — y compris sur un tournoi **terminé**, ou en cours sans
 * la moindre échéance, où il ne pouvait rien faire avancer. La salle se réveille
 * désormais **à la prochaine échéance connue** ({@link nextRoomWakeAt}), et ce
 * filet ne sert plus qu'à rattraper une écriture qui n'aurait rien publié.
 */
export const ROOM_SAFETY_NET_MS = 5 * 60_000;

/**
 * Nouvel essai après une lecture d'instantané en échec (incident passager de la
 * base) : sans lui, une salle dont la lecture échoue attendrait son filet.
 */
export const ROOM_READ_RETRY_MS = 30_000;

/**
 * Marge ajoutée à un délai de report de score avant de relire : la bascule se
 * fait sur `score_deadline_at <= NOW()` côté base, relire pile à l'échéance
 * pourrait arriver une fraction de seconde trop tôt.
 */
export const SCORE_DEADLINE_MARGIN_MS = 1_000;

/**
 * Relecture après une échéance **manquée** : la salle s'est réveillée à l'heure
 * dite, mais l'instantané lu venait du cache (3 s, `SNAPSHOT_TTL_MS` de
 * `./tournaments/snapshot`) — posé juste avant par une connexion ou une lecture
 * de secours —, si bien que l'entretien à la lecture n'a pas joué. Relire une
 * fois le cache expiré. Doit rester supérieur au TTL du cache
 * (`tests/lib/server/tournament-snapshot.test.ts` le vérifie).
 */
export const STATE_CATCH_UP_MS = 4_000;

/** Délai de l'escalade d'un conflit de score à l'arbitrage, après le délai de report. */
const CONFLICT_ESCALATION_MS = SCORE_REPORT_TIMEOUT_MINUTES * 60_000;

/**
 * L'état stocké du tournoi retarde-t-il sur ses dates ? Une date illisible ne
 * dit rien : on ne conclut pas au retard.
 */
export function isStateOverdue(card: TournamentSnapshot["card"], now: number): boolean {
  if (card.state === "FINISHED") return false;
  const dates = [card.registrationOpenAt, card.registrationCloseAt, card.startAt];
  if (dates.some((date) => !Number.isFinite(Date.parse(String(date))))) return false;
  return computeTournamentState(card, now) !== card.state;
}

type DeadlineMatch = TournamentSnapshot["matches"][number];

/** Délai de report d'un match en attente de confirmation, ou `null`. */
function scoreDeadlineOf(match: DeadlineMatch): number | null {
  if (match.status !== "AWAITING_CONFIRMATION" || !match.scoreDeadlineAt) return null;
  const deadline = Date.parse(match.scoreDeadlineAt);
  return Number.isFinite(deadline) ? deadline : null;
}

/**
 * Deux reports contradictoires : l'expiration du délai ne tranche rien
 * (`resolveExpiredScoreReports`), le match attend l'arbitrage.
 */
function isScoreConflict(match: DeadlineMatch): boolean {
  return Boolean(match.team1Report) && Boolean(match.team2Report);
}

/**
 * Échéances **de lancement** d'un match (ms), que seule l'horloge atteint et
 * que l'entretien à la lecture joue (`maintainMatchLaunches`) :
 *
 * - l'heure de début d'un match **en attente de départ** — le lancement s'y
 *   ouvre (`lobby_opened_at`), point de départ du lancement d'office ;
 * - le lancement d'office d'un match **en lancement**, quinze minutes après
 *   son ouverture.
 *
 * Sans elles, la salle attendait son filet de cinq minutes : le client voyait
 * bien le match passer « en lancement » à la seconde dite (il dérive la phase
 * de l'horaire), mais le lancement d'office — écriture du serveur — arrivait
 * jusqu'à cinq minutes en retard, et le décompte de la modale mentait d'autant.
 * Un match **à planifier** n'en a aucune : il attend une date, que l'arbitrage
 * pose par une écriture, publiée.
 */
function launchDeadlinesOf(match: DeadlineMatch, refereeScheduling: boolean, now: number): number[] {
  const phase = matchLaunchPhase(
    {
      status: match.status,
      team1Id: match.team1Id,
      team2Id: match.team2Id,
      startAt: match.startAt,
      launchedAt: match.launchedAt,
      refereeScheduling,
    },
    now,
  );
  if (phase === "SCHEDULED") {
    const start = Date.parse(String(match.startAt));
    return Number.isFinite(start) ? [start] : [];
  }
  if (phase === "LOBBY") {
    const deadlines: number[] = [];
    // L'ouverture n'est posée qu'à la première observation : tant qu'elle
    // manque, l'heure de début est l'échéance qui vient de passer.
    const start = Date.parse(String(match.startAt));
    if (match.lobbyOpenedAt === null && Number.isFinite(start)) deadlines.push(start);
    const auto = Date.parse(String(autoLaunchAt(match.lobbyOpenedAt)));
    if (Number.isFinite(auto)) deadlines.push(auto);
    return deadlines;
  }
  return [];
}

/**
 * L'instantané retarde-t-il sur une échéance déjà passée que l'entretien à la
 * lecture aurait dû jouer — bascule d'état, ou report **unique** expiré ?
 */
export function isRoomOverdue(snapshot: TournamentSnapshot, now: number): boolean {
  if (isStateOverdue(snapshot.card, now)) return true;
  // Une échéance de lancement passée se rattrape **une fois**, dans la fenêtre
  // qui la suit (même garde que l'escalade d'un conflit) : un lancement que
  // l'entretien n'a pas pu jouer — tournoi pas encore « en cours » en base,
  // match relu sans changement — ne doit pas faire relire la salle en boucle.
  if (snapshot.card.state === "RUNNING") {
    const refereeScheduling = snapshot.card.refereeScheduling === true;
    const late = (snapshot.matches ?? []).some((match) =>
      launchDeadlinesOf(match, refereeScheduling, now).some((deadline) => {
        const since = now - (deadline + SCORE_DEADLINE_MARGIN_MS);
        return since >= 0 && since < STATE_CATCH_UP_MS;
      }),
    );
    if (late) return true;
  }
  return (snapshot.matches ?? []).some((match) => {
    const deadline = scoreDeadlineOf(match);
    if (deadline === null) return false;
    if (!isScoreConflict(match)) return deadline + SCORE_DEADLINE_MARGIN_MS <= now;
    // Un conflit ne se tranche pas à l'expiration, mais son **escalade** à
    // l'arbitrage est posée par l'entretien à la lecture : si la lecture faite
    // à l'heure de l'escalade venait du cache, une relecture — une seule, dans
    // la fenêtre qui suit — la rattrape. Au-delà, l'escalade est posée ou
    // réservée, et le conflit n'attend plus que l'arbitrage.
    const escalatedFor = now - (deadline + CONFLICT_ESCALATION_MS + SCORE_DEADLINE_MARGIN_MS);
    return escalatedFor >= 0 && escalatedFor < STATE_CATCH_UP_MS;
  });
}

/**
 * Prochaine échéance de **score** d'un match (ms) : l'expiration de son délai
 * de report, ou — délai passé sur un conflit — l'escalade à l'arbitrage.
 * `null` s'il n'en a aucune à venir.
 */
function scoreWakeOf(match: DeadlineMatch, now: number): number | null {
  const deadline = scoreDeadlineOf(match);
  if (deadline === null) return null;
  const expiry = deadline + SCORE_DEADLINE_MARGIN_MS;
  if (expiry > now) return expiry;
  if (!isScoreConflict(match)) return null;
  const escalation = deadline + CONFLICT_ESCALATION_MS + SCORE_DEADLINE_MARGIN_MS;
  return escalation > now ? escalation : null;
}

/**
 * Prochain instant où la salle doit relire l'instantané d'elle-même, ou `null`
 * s'il n'y en a aucun.
 *
 * - Un tournoi **terminé** n'a plus d'échéance : seules les écritures (une
 *   correction d'archive) le font bouger, et elles publient un événement.
 * - Sinon, la plus proche de : la prochaine bascule d'état (ouverture ou
 *   clôture des inscriptions, coup d'envoi), le délai de report de score le
 *   plus proche (`score_deadline_at`, que l'entretien à la lecture tranche),
 *   l'escalade d'un conflit de score à l'arbitrage, l'heure de départ et le
 *   lancement d'office d'un match (`launchDeadlinesOf`), et le filet de
 *   sécurité.
 * - Une échéance **déjà passée** que l'instantané ne reflète pas encore
 *   ({@link isRoomOverdue}) se rattrape après `catchUpMs` : les échéances
 *   passées n'étant plus des instants futurs, elle tomberait sinon jusqu'au
 *   filet — un coup d'envoi annoncé cinq minutes en retard.
 * - Un **conflit** dont le délai est passé n'est pas une échéance manquée :
 *   rien ne le tranche avant l'arbitrage. Seule son escalade compte ; le
 *   relire toutes les 30 s rouvrirait le battement que ce réveil supprime.
 *
 * Exportée pour être vérifiable directement.
 */
export function nextRoomWakeAt(
  snapshot: TournamentSnapshot,
  now: number,
  catchUpMs: number = STATE_CATCH_UP_MS,
): number | null {
  const { card } = snapshot;
  if (card.state === "FINISHED") return null;

  let wakeAt = now + ROOM_SAFETY_NET_MS;
  const boundary = nextTournamentStateChangeAt(
    {
      state: card.state,
      registrationOpenAt: card.registrationOpenAt,
      registrationCloseAt: card.registrationCloseAt,
      startAt: card.startAt,
    },
    now,
  );
  if (boundary !== null) wakeAt = Math.min(wakeAt, boundary);
  if (isRoomOverdue(snapshot, now)) wakeAt = Math.min(wakeAt, now + catchUpMs);

  // Échéances de lancement : seulement en cours, seul état où l'entretien
  // lance quoi que ce soit.
  const running = card.state === "RUNNING";
  const refereeScheduling = card.refereeScheduling === true;
  for (const match of snapshot.matches ?? []) {
    const launchDeadlines = running ? launchDeadlinesOf(match, refereeScheduling, now) : [];
    for (const at of [...launchDeadlines.map((d) => d + SCORE_DEADLINE_MARGIN_MS), scoreWakeOf(match, now)]) {
      if (at !== null && at > now) wakeAt = Math.min(wakeAt, at);
    }
  }
  return wakeAt;
}

/**
 * Délai minimal avant de réessayer un abonné dont la file était pleine
 * (`lib/server/stream-backpressure.ts`). Assez court pour qu'il retrouve vite
 * le direct une fois la file dégagée, assez long pour qu'un client qui ne lit
 * plus ne fasse pas tourner la salle à vide.
 */
export const BACKED_UP_RETRY_MS = 5_000;

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
 * Or l'instantané d'un tournoi à 128 équipes en double élimination pèse
 * ~238 ko en clair, ~13 ko compressé (254 matchs) — et dans un tournoi de cette
 * taille, les inscrits, tous prioritaires, sont 128. En clair, un score
 * rapporté produirait donc près de 30 Mo à
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
 *
 * L'appelant lui passe les abonnés **réellement dus**, tous paliers confondus,
 * et applique le résultat comme plancher commun.
 *
 * Commun, parce qu'un plancher par palier renversait leur ordre : dans un
 * tournoi à 128 équipes (238 ko d'instantané), les 128 inscrits — tous
 * prioritaires — héritaient d'une fenêtre de 38 s quand la vingtaine de
 * spectateurs était servie toutes les 20 s. Les équipes qui jouent recevaient
 * leur plateau deux fois moins souvent que ceux qui les regardent.
 *
 * Sur les seuls abonnés dus, parce que réserver du budget pour des spectateurs
 * qui ne recevront rien lors de cet envoi retarderait les joueurs pour rien.
 */
export function budgetDelayMs(frameBytes: number, subscribers: number): number {
  if (subscribers <= 0 || frameBytes <= 0) return 0;
  return roomBudgetDelayMs(frameBytes * subscribers);
}

/**
 * Même budget, exprimé sur le **total** d'octets à écrire. C'est la forme que
 * la salle emploie : ses abonnés ne reçoivent pas tous le même nombre d'octets,
 * la trame compressée (`lib/server/sse-gzip.ts`) pesant ~18 fois moins que la
 * trame en clair — et c'est le poids réellement écrit que le lien subit.
 */
export function roomBudgetDelayMs(totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.min(MAX_BUDGET_DELAY_MS, Math.ceil((totalBytes * 1000) / ROOM_BYTES_PER_SECOND));
}

/** Un abonné : son palier de fraîcheur et par où lui écrire. */
export type TournamentSubscriber = {
  tier: RefreshTier;
  /**
   * Encodage de la connexion (`identity` par défaut). La salle choisit les
   * octets qu'elle lui écrit — la trame en clair ou la trame compressée, toutes
   * deux calculées une seule fois par version — et compte ceux-là dans son
   * budget de sortie.
   */
  encoding?: StreamEncoding;
  /**
   * Version de l'instantané que cet abonné **détient déjà** au moment où il
   * rejoint la salle — la route en envoie un à la connexion, avant de s'abonner.
   *
   * Sans elle, la salle ne savait qu'une chose par palier : « quelle version a
   * été diffusée en dernier ». Un abonné qui rejoignait juste après une
   * diffusion héritait donc de ce constat sans avoir rien reçu : sa lecture
   * ayant précédé l'écriture, il tenait la version d'avant, et la comparaison
   * `lastVersion === frame.version` faisait sauter **tout son palier** au tour
   * suivant. Il restait sur un plateau périmé — indéfiniment si plus rien ne
   * bougeait — avec un témoin de flux au vert.
   */
  version?: string | null;
  /**
   * Écrit une trame déjà encodée. Doit lever si la connexion est fermée.
   *
   * Rend `false` quand la trame n'a **pas** été écrite parce que le client ne
   * lit plus assez vite (`lib/server/stream-backpressure.ts`) : l'abonné reste
   * alors « en retard », et la salle lui renverra la dernière version plus tard
   * — une seule trame, et non toutes celles qu'il a manquées.
   */
  send: (frame: Uint8Array) => boolean | void;
  /**
   * Termine la connexion. Appelé quand le tournoi a disparu : sans cela le flux
   * resterait ouvert et sain, et le spectateur garderait une pastille
   * « Direct » devant un plateau qui ne bougera plus jamais.
   */
  close?: () => void;
};

/**
 * Ce que la salle retient d'un abonné : la dernière version qu'il a reçue, et
 * quand.
 *
 * **Les deux par abonné**, et non par palier. Le palier ne décide que de la
 * *durée* de la fenêtre de regroupement ; le moment où elle a commencé
 * appartient à la connexion. Partagée, elle se faisait remettre à zéro par le
 * rattrapage d'un retardataire : un envoi qui n'avait servi qu'un abonné arrivé
 * en retard repoussait d'une fenêtre entière celui de tous les autres, et sur un
 * tournoi où les spectateurs arrivent en continu la latence du palier doublait.
 */
type SubscriberState = { version: string | null; lastSentAt: number };

type Room = {
  subscribers: Set<TournamentSubscriber>;
  /** Ce que chaque abonné a reçu, et quand. */
  states: Map<TournamentSubscriber, SubscriberState>;
  unsubscribe: () => void;
  /** Réveil d'entretien : la prochaine échéance connue (`nextRoomWakeAt`). */
  maintenance: ReturnType<typeof setTimeout> | null;
  /** Instant visé par `maintenance`. */
  maintenanceAt: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Instant visé par `flushTimer`, pour qu'une demande plus urgente le devance. */
  flushAt: number;
  flushing: boolean;
  /** Un changement est arrivé pendant un envoi : il faudra repasser. */
  dirtyAgain: boolean;
  /**
   * Première lecture montrant une échéance manquée (`isRoomOverdue`), ou
   * `null`. Une lecture encore en retard **après l'expiration du cache** n'est
   * plus l'effet du cache mais d'un entretien qui n'aboutit pas : on retente
   * alors au pas lent, jamais en boucle serrée.
   */
  overdueSince: number | null;
};

const rooms = new Map<number, Room>();
const streamsPerUser = new Map<number, number>();

/**
 * État d'un abonné. Un abonné inconnu est réputé n'avoir rien reçu : il est donc
 * dû sur-le-champ — mieux vaut un envoi de trop qu'un abonné muet.
 */
function subscriberState(room: Room, subscriber: TournamentSubscriber): SubscriberState {
  let state = room.states.get(subscriber);
  if (!state) {
    state = { version: null, lastSentAt: 0 };
    room.states.set(subscriber, state);
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
  if (room.maintenance) clearTimeout(room.maintenance);
  room.maintenance = null;
  if (room.flushTimer) clearTimeout(room.flushTimer);

  // Une salle peut se vider pendant qu'un envoi est en attente : le temps que
  // celui-ci reprenne, une salle NEUVE a pu prendre sa place dans le registre.
  // La retirer serait la condamner à vivre hors du registre — son écouteur et
  // son battement continueraient, un prochain abonné en ouvrirait une
  // troisième, et les instantanés partiraient en double.
  if (rooms.get(tournamentId) === room) rooms.delete(tournamentId);
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
 * « À qui doit-on cette version ? » se demande **par abonné**, et non par
 * palier : deux connexions d'un même palier peuvent tenir deux versions
 * différentes, la lecture d'ouverture d'une connexion pouvant précéder une
 * diffusion qu'elle a manquée.
 */
function isBehind(
  room: Room,
  subscriber: TournamentSubscriber,
  frame: TournamentSnapshotFrame,
): boolean {
  return subscriberState(room, subscriber).version !== frame.version;
}

/**
 * Poids de ce que la salle doit écrire maintenant, compté sur les seuls abonnés
 * que la cadence de leur palier rend dus : réserver du budget pour des
 * spectateurs qui ne recevront rien retarderait les joueurs pour rien. Le
 * plancher qui en découle est commun à la salle, parce qu'un plancher par
 * palier ferait attendre les 128 inscrits d'un gros tournoi plus longtemps que
 * la poignée de spectateurs qui les regarde.
 */
function dueAudienceBytes(room: Room, frame: TournamentSnapshotFrame, now: number): number {
  let dueBytes = 0;
  for (const subscriber of room.subscribers) {
    if (
      isBehind(room, subscriber, frame) &&
      now - subscriberState(room, subscriber).lastSentAt >=
        REFRESH_CADENCE[subscriber.tier].pushCoalesceMs
    ) {
      dueBytes += snapshotFrameBytes(frame, subscriber.encoding ?? "identity").byteLength;
    }
  }
  return dueBytes;
}

/**
 * Écrit l'instantané à un abonné si sa fenêtre de regroupement est écoulée.
 *
 * @returns Le délai avant le prochain essai qu'il réclame, ou `+∞` s'il n'en
 *          réclame aucun (servi, ou retiré).
 */
function pushToSubscriber(
  room: Room,
  subscriber: TournamentSubscriber,
  frame: TournamentSnapshotFrame,
  coalesceWindow: number,
  now: number,
): number {
  const state = subscriberState(room, subscriber);
  const elapsed = now - state.lastSentAt;
  if (elapsed < coalesceWindow) return coalesceWindow - elapsed;

  try {
    const bytes = snapshotFrameBytes(frame, subscriber.encoding ?? "identity");
    if (subscriber.send(bytes) === false) {
      // File du client pleine : rien n'est parti. Ni version ni horloge
      // ne bougent, et un nouvel essai est programmé — espacé d'au moins
      // `BACKED_UP_RETRY_MS` : à la fenêtre du palier (1 s), un client
      // qui ne lit plus ferait repasser la salle, et reconstruire
      // l'instantané, en continu jusqu'à sa fermeture.
      return Math.max(coalesceWindow, BACKED_UP_RETRY_MS);
    }
    state.version = frame.version;
    state.lastSentAt = now;
  } catch {
    // Connexion fermée entre-temps : on la retire et on continue.
    room.subscribers.delete(subscriber);
    room.states.delete(subscriber);
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Sert les abonnés en retard d'un palier.
 *
 * @returns Le plus court délai réclamé par ses abonnés (`+∞` : aucun).
 */
function pushToTier(
  room: Room,
  frame: TournamentSnapshotFrame,
  tier: RefreshTier,
  roomFloor: number,
  now: number,
): number {
  const audience = [...room.subscribers].filter(
    (subscriber) => subscriber.tier === tier && isBehind(room, subscriber, frame),
  );
  if (audience.length === 0) return Number.POSITIVE_INFINITY;

  // La fenêtre effective est la plus large des deux : celle du palier, et
  // celle qu'impose le poids de ce que la salle entière écrit. Sa *durée*
  // vient du palier ; le moment où elle a commencé appartient, lui, à chaque
  // connexion — partagé, le rattrapage d'un retardataire remettait à zéro la
  // cadence de tous ses voisins et les faisait attendre une fenêtre de plus.
  const coalesceWindow = Math.max(REFRESH_CADENCE[tier].pushCoalesceMs, roomFloor);

  let nextDelay = Number.POSITIVE_INFINITY;
  for (const subscriber of audience) {
    nextDelay = Math.min(
      nextDelay,
      pushToSubscriber(room, subscriber, frame, coalesceWindow, now),
    );
  }
  return nextDelay;
}

/**
 * Programme le réveil d'entretien à la prochaine échéance connue (bascule
 * d'état, report expiré), à l'heure exacte : sans lui, il faudrait compter sur
 * chaque client pour se réveiller seul, ce qui ferait repartir cent requêtes à
 * la même seconde.
 *
 * Une échéance manquée se rattrape après le cache ; elle ne passe au pas lent
 * que si elle survit à une lecture faite **après** l'expiration du cache — une
 * autre lecture tombée dans la fenêtre (une connexion au coup d'envoi) relit le
 * même instantané et ne prouve rien. Tant qu'on rattrape, un réveil déjà plus
 * proche est gardé.
 */
function scheduleRoomWake(
  tournamentId: number,
  room: Room,
  snapshot: TournamentSnapshot,
  now: number,
): void {
  const overdue = isRoomOverdue(snapshot, now);
  if (!overdue) room.overdueSince = null;
  else room.overdueSince ??= now;
  const persistent = room.overdueSince !== null && now - room.overdueSince >= STATE_CATCH_UP_MS;
  scheduleMaintenance(
    tournamentId,
    room,
    nextRoomWakeAt(snapshot, now, persistent ? ROOM_READ_RETRY_MS : STATE_CATCH_UP_MS),
    overdue && !persistent,
  );
}

/**
 * Envoie un instantané lu aux paliers dont la fenêtre de regroupement est
 * écoulée, reprogramme les autres pour le reliquat, et ferme la salle si plus
 * personne n'y écoute.
 */
function deliverFrame(tournamentId: number, room: Room, frame: TournamentSnapshotFrame): void {
  const now = Date.now();
  const roomFloor = roomBudgetDelayMs(dueAudienceBytes(room, frame, now));

  let nextDelay = Number.POSITIVE_INFINITY;
  for (const tier of activeTiers(room)) {
    nextDelay = Math.min(nextDelay, pushToTier(room, frame, tier, roomFloor, now));
  }

  if (room.subscribers.size === 0) {
    closeRoom(tournamentId, room);
    return;
  }

  scheduleRoomWake(tournamentId, room, frame.snapshot, now);
  if (Number.isFinite(nextDelay)) scheduleFlush(tournamentId, room, nextDelay);
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
    // Une lecture en échec et un tournoi disparu rendaient tous deux `null` :
    // dans le premier cas se taire et retenter est exactement ce qu'il faut,
    // dans le second la salle battait indéfiniment devant un plateau mort,
    // pendant que chaque spectateur gardait une pastille « Direct ». Le chemin
    // d'échec définitif du client ne se déclenche que si le flux tombe : c'est
    // donc à la salle de le faire tomber.
    let frame: TournamentSnapshotFrame | null;
    try {
      frame = await getTournamentSnapshotFrame(tournamentId);
    } catch {
      // Incident passager : on retente plus tard, sans attendre le filet.
      scheduleMaintenance(tournamentId, room, Date.now() + ROOM_READ_RETRY_MS, true);
      return;
    }

    if (frame === null) {
      closeGoneRoom(tournamentId, room);
      return;
    }
    if (room.subscribers.size === 0) return;

    deliverFrame(tournamentId, room, frame);
  } finally {
    room.flushing = false;
    if (room.dirtyAgain) {
      room.dirtyAgain = false;
      if (room.subscribers.size > 0) scheduleFlush(tournamentId, room, 0);
    }
  }
}

/**
 * Le tournoi n'existe plus : on termine les flux et on ferme la salle.
 *
 * Fermer la connexion est ce qui remet le client sur son chemin d'échec
 * définitif — sa lecture de secours verra le 404 et affichera « Tournoi
 * introuvable » plutôt que de laisser un plateau figé se faire passer pour du
 * direct.
 */
function closeGoneRoom(tournamentId: number, room: Room): void {
  for (const subscriber of [...room.subscribers]) { // NOSONAR typescript:S7747 — instantané voulu : `close()` peut retirer d'autres abonnés pendant le parcours
    room.subscribers.delete(subscriber);
    room.states.delete(subscriber);
    try {
      subscriber.close?.();
    } catch {
      // Connexion déjà tombée : il n'y a plus rien à fermer.
    }
  }
  closeRoom(tournamentId, room);
}

/**
 * (Re)programme le réveil d'entretien à `wakeAt` (`null` : aucun). Remplace le
 * précédent : c'est toujours la dernière lecture qui sait quelle est la
 * prochaine échéance.
 *
 * `keepEarlier` : ne remplace le réveil en place que s'il est plus tardif. Sert
 * après une lecture en échec, qui ne sait rien de la prochaine échéance — un
 * coup d'envoi dans trois secondes ne doit pas glisser au délai d'essai.
 */
function scheduleMaintenance(
  tournamentId: number,
  room: Room,
  wakeAt: number | null,
  keepEarlier = false,
): void {
  if (keepEarlier && room.maintenance && wakeAt !== null && room.maintenanceAt <= wakeAt) return;
  if (room.maintenance) clearTimeout(room.maintenance);
  room.maintenance = null;
  if (wakeAt === null || rooms.get(tournamentId) !== room) return;

  room.maintenanceAt = wakeAt;
  room.maintenance = setTimeout(() => {
    room.maintenance = null;
    if (rooms.get(tournamentId) === room) void flush(tournamentId, room);
  }, Math.max(0, wakeAt - Date.now()));
  room.maintenance.unref?.();
}

function openRoom(tournamentId: number, known?: TournamentSnapshot): Room {
  const room: Room = {
    subscribers: new Set<TournamentSubscriber>(),
    states: new Map<TournamentSubscriber, SubscriberState>(),
    unsubscribe: () => undefined,
    maintenance: null,
    maintenanceAt: 0,
    flushTimer: null,
    flushAt: 0,
    flushing: false,
    dirtyAgain: false,
    overdueSince: null,
  };

  // L'événement lui-même ne sert qu'à réveiller la salle : ce qui part aux
  // abonnés, c'est l'instantané recalculé, identique quel que soit le
  // déclencheur.
  room.unsubscribe = subscribeTournament(tournamentId, () => {
    scheduleFlush(tournamentId, room, 0);
  });

  rooms.set(tournamentId, room);

  // Premier réveil, planifié sur l'instantané que le premier abonné vient de
  // recevoir : rien à relire avant sa prochaine échéance. Sans lui, un réveil
  // de précaution — la salle ne sait encore rien du tournoi.
  const now = Date.now();
  scheduleMaintenance(
    tournamentId,
    room,
    known ? nextRoomWakeAt(known, now) : now + ROOM_READ_RETRY_MS,
  );
  return room;
}

/**
 * Abonne un lecteur aux instantanés d'un tournoi. Renvoie la fonction de
 * désabonnement ; la salle se ferme d'elle-même quand elle se vide.
 */
export function joinTournamentRoom(
  tournamentId: number,
  subscriber: TournamentSubscriber,
  /**
   * Instantané que cet abonné vient de recevoir, s'il est connu : il sert à
   * planifier le premier réveil d'une salle qui s'ouvre.
   */
  known?: TournamentSnapshot,
): () => void {
  const room = rooms.get(tournamentId) ?? openRoom(tournamentId, known);
  room.subscribers.add(subscriber);
  // Ce que l'abonné tient déjà : la salle ne lui réécrira cette version-là que
  // s'il ne l'a pas. Omettre `version` revient à dire « je n'ai rien » — le
  // premier envoi lui parviendra alors, quitte à faire double emploi.
  room.states.set(subscriber, { version: subscriber.version ?? null, lastSentAt: 0 });

  // Contrôle d'arrivée : entre la lecture d'ouverture de la route et cet
  // abonnement, une écriture a pu être diffusée aux autres — ce lecteur tient
  // alors la version d'avant, et plus rien ne le rattraperait avant la
  // prochaine échéance (5 min, jamais sur un tournoi terminé). La salle
  // repasse donc tout de suite : la lecture sort presque toujours du cache
  // (3 s) que la route vient de remplir, et rien n'est écrit si la version
  // n'a pas bougé.
  if (subscriber.version) scheduleFlush(tournamentId, room, 0);

  return () => {
    room.subscribers.delete(subscriber);
    room.states.delete(subscriber);
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
  for (const [tournamentId, room] of rooms) closeRoom(tournamentId, room);
  rooms.clear();
  streamsPerUser.clear();
}
