/**
 * Suivi d'un tournoi **sans compte** (`/suivre/tournois/[id]`).
 *
 * Le visiteur non connecté est le lecteur le moins prioritaire du site : il ne
 * reçoit pas le flux SSE, il **sonde** une route en lecture seule, à une cadence
 * que le **serveur** choisit selon sa charge du moment. Calme, le plateau suit
 * à quelques dizaines de secondes ; chargé, l'intervalle s'allonge jusqu'à dix
 * minutes, et ceux qui font le tournoi (staff, engagés, cast) gardent la
 * machine.
 *
 * Module pur : les seuils, les cadences et ce que l'instantané perd en sortant
 * de l'espace connecté se testent sans serveur, et le client relit les mêmes
 * chemins que le serveur. Voir `docs/features/SPECTATOR_VIEW.md`.
 */
import type {
  TournamentSnapshot,
  TournamentState,
  TournamentViewerContext,
} from "@/lib/shared/types";
import { parseEntityPageId } from "@/lib/shared/entity-page-titles";

/** Chemin public de la fiche (sans préfixe de langue). */
export function spectatorTournamentPath(tournamentId: number): string {
  return `/suivre/tournois/${tournamentId}`;
}

/** Chemin de la fiche dans l'espace connecté (sans préfixe de langue). */
export function memberTournamentPath(tournamentId: number): string {
  return `/tournois/${tournamentId}`;
}

/**
 * Identifiant de tournoi valide : entier strictement positif — la règle des
 * autres fiches (`parseEntityPageId`), et donc celle que la fiche connectée
 * applique (`Number(params.id)`) : un lien qui l'ouvre est redirigé pareil.
 */
export const parseTournamentId = parseEntityPageId;

/**
 * Le tournoi désigné par un chemin de **fiche** de l'espace connecté
 * (`/tournois/12`), `null` pour toute autre page — `/tournois`,
 * `/tournois/creer`, `/tournois/12/modifier` restent derrière la connexion.
 */
export function tournamentIdFromMemberPath(path: string | null | undefined): number | null {
  return tournamentIdUnder("/tournois/", path);
}

/** Identifiant de la fiche `<préfixe><id>` (barre finale tolérée), `null` pour tout autre chemin. */
function tournamentIdUnder(prefix: string, path: string | null | undefined): number | null {
  if (!path?.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length).replace(/\/$/, "");
  return rest === "" || rest.includes("/") ? null : parseTournamentId(rest);
}

/**
 * Requête à faire suivre lors d'une redirection entre les deux espaces, lue
 * dans `x-search` (posé par le middleware). Un préchargement échappe au
 * middleware et peut porter un en-tête venu du client : seule une requête
 * (`?…`) est reprise, jamais un fragment de chemin.
 */
export function forwardedSearch(value: string | null | undefined): string {
  return value?.startsWith("?") ? value : "";
}

/** Le tournoi désigné par un chemin de **page sans compte**, `null` ailleurs. */
export function tournamentIdFromSpectatorPath(path: string | null | undefined): number | null {
  return tournamentIdUnder("/suivre/tournois/", path);
}

/**
 * Où mène « Rejoindre » sur une page donnée : sur la page sans compte d'un
 * tournoi, la connexion ramène à **sa fiche connectée** (`?redirect=`) — un
 * joueur dont la session a expiré, ou l'arbitre déconnecté, retrouve ses
 * actions sans bouton de plus. Ailleurs, la page de connexion seule.
 */
export function joinHrefFor(path: string | null | undefined, search?: string | null): string {
  const tournamentId = tournamentIdFromSpectatorPath(path);
  if (tournamentId === null) return "/connexion";
  const destination = `${memberTournamentPath(tournamentId)}${forwardedSearch(search)}`;
  return `/connexion?redirect=${encodeURIComponent(destination)}`;
}

/**
 * Le même lien, ancre de la page comprise (`#match-…`) : le serveur ne la voit
 * jamais, le navigateur l'ajoute à la destination au moment du rendu client.
 */
export function withRedirectAnchor(href: string, hash: string): string {
  if (!hash.startsWith("#") || hash.length < 2 || !href.includes("?redirect=")) return href;
  return `${href}${encodeURIComponent(hash)}`;
}

/**
 * Niveau de charge du serveur, de `0` (calme) à `3` (saturé). Il ne règle que
 * la cadence des visiteurs sans compte : rien de ce que voit un membre connecté
 * n'en dépend.
 */
export type SpectatorLoadLevel = 0 | 1 | 2 | 3;

/** Ce que le serveur mesure de lui-même, sans requête en base. */
export type SpectatorLoadSignals = {
  /** Retard de la boucle d'évènements (99ᵉ centile, ms) ; `null` = pas encore mesuré. */
  eventLoopDelayMs: number | null;
  /** Flux SSE ouverts, tous tournois confondus. */
  openStreams: number;
  /** Lectures publiques servies sur la dernière minute. */
  spectatorReadsPerMinute: number;
};

/**
 * Seuils des niveaux 1, 2 et 3, par signal. Le niveau retenu est le plus haut
 * atteint : un seul signal suffit à ralentir.
 *
 * - Boucle d'évènements : au-delà de 50 ms au 99ᵉ centile, le Raspberry Pi
 *   commence à faire attendre ses requêtes.
 * - Flux : la machine est dimensionnée pour une centaine de connexions
 *   simultanées (`lib/shared/refresh-tiers.ts`).
 * - Lectures publiques : dix par seconde, c'est déjà plusieurs centaines de
 *   spectateurs anonymes ; chacune sort du cache, mais pèse son instantané.
 */
export const SPECTATOR_LOAD_THRESHOLDS = {
  eventLoopDelayMs: [50, 100, 200],
  openStreams: [100, 200, 300],
  spectatorReadsPerMinute: [600, 1_200, 2_400],
} as const satisfies Record<keyof SpectatorLoadSignals, readonly [number, number, number]>;

function levelOf(value: number | null, thresholds: readonly [number, number, number]): SpectatorLoadLevel {
  if (value === null || !Number.isFinite(value)) return 0;
  if (value >= thresholds[2]) return 3;
  if (value >= thresholds[1]) return 2;
  if (value >= thresholds[0]) return 1;
  return 0;
}

/** Niveau de charge : le plus haut des trois signaux. */
export function spectatorLoadLevel(signals: SpectatorLoadSignals): SpectatorLoadLevel {
  return Math.max(
    levelOf(signals.eventLoopDelayMs, SPECTATOR_LOAD_THRESHOLDS.eventLoopDelayMs),
    levelOf(signals.openStreams, SPECTATOR_LOAD_THRESHOLDS.openStreams),
    levelOf(signals.spectatorReadsPerMinute, SPECTATOR_LOAD_THRESHOLDS.spectatorReadsPerMinute),
  ) as SpectatorLoadLevel;
}

/** Multiplicateur de cadence par niveau de charge. */
export const SPECTATOR_LOAD_FACTOR: Readonly<Record<SpectatorLoadLevel, number>> = {
  0: 1,
  1: 2,
  2: 4,
  3: 10,
};

/**
 * Cadence de base d'un tournoi **en cours**. Plus lente que les 20 s du palier
 * spectateur connecté (`REFRESH_CADENCE.STANDARD.pushCoalesceMs`) : le
 * visiteur sans compte passe toujours après les membres.
 */
export const SPECTATOR_RUNNING_POLL_MS = 30_000;

/** Avant le coup d'envoi, seules les inscriptions bougent. */
export const SPECTATOR_PRE_LAUNCH_POLL_MS = 120_000;

/** Plafond, quelle que soit la charge. */
export const SPECTATOR_MAX_POLL_MS = 600_000;

/** Un tournoi introuvable est relu au plafond (pas encore publié ?) : en minutes, pour le dire. */
export const SPECTATOR_NOT_FOUND_RECHECK_MINUTES = SPECTATOR_MAX_POLL_MS / 60_000;

/**
 * Intervalle avant la prochaine lecture.
 *
 * Un tournoi **terminé** est relu au plafond, et non plus jamais : le staff peut
 * le rouvrir (retour en arrière sur la finale, `TOURNAMENT_ROLLBACK`), et un
 * onglet resté ouvert afficherait sinon l'ancien résultat pour toujours. Une
 * relecture sans nouveauté ne coûte qu'un `304` sans corps.
 */
export function spectatorPollIntervalMs(state: TournamentState, level: SpectatorLoadLevel): number {
  if (state === "FINISHED") return SPECTATOR_MAX_POLL_MS;
  const base = state === "RUNNING" ? SPECTATOR_RUNNING_POLL_MS : SPECTATOR_PRE_LAUNCH_POLL_MS;
  return Math.min(SPECTATOR_MAX_POLL_MS, base * SPECTATOR_LOAD_FACTOR[level]);
}

/**
 * Durée de vie de la réponse publique d'un tournoi, côté serveur. Tous les
 * visiteurs sans compte d'un même tournoi la partagent : leur nombre ne change
 * rien au travail en base — au plus une reconstruction par durée de vie.
 */
export const SPECTATOR_CACHE_TTL_MS = 15_000;

/** Durée de vie de la réponse publique, allongée avec la charge. */
export function spectatorCacheTtlMs(level: SpectatorLoadLevel): number {
  return Math.min(SPECTATOR_MAX_POLL_MS, SPECTATOR_CACHE_TTL_MS * SPECTATOR_LOAD_FACTOR[level]);
}

/**
 * Attente imposée après une lecture impossible (base injoignable) : le double de
 * la cadence d'un tournoi en cours **au niveau de charge du moment** — une
 * minute au calme, dix sous la pire charge. Un incident bref ne fige pas la
 * page dix minutes ; une base réellement saturée n'est pas relancée sans cesse.
 */
export function spectatorUnavailableRetryMs(level: SpectatorLoadLevel): number {
  return Math.min(SPECTATOR_MAX_POLL_MS, 2 * SPECTATOR_RUNNING_POLL_MS * SPECTATOR_LOAD_FACTOR[level]);
}

/** En-tête de réponse qui porte l'intervalle choisi (ms). */
export const SPECTATOR_POLL_HEADER = "x-bg-poll-after-ms";

/**
 * En-tête de réponse qui porte l'âge maximal de ce que le visiteur affiche
 * (ms) : l'attente entre deux lectures, gigue comprise, **plus** la durée de vie
 * de la réponse partagée. C'est ce que le témoin annonce — « toutes les N au
 * plus » ne doit pas promettre mieux que ce que le cache permet.
 */
export const SPECTATOR_FRESHNESS_HEADER = "x-bg-fresh-within-ms";

/**
 * Âge maximal de l'affichage : la cadence, gigue comprise, plus la durée de vie
 * **de la réponse servie** — celle qu'elle a reçue à sa construction, peut-être
 * sous une charge plus forte que l'actuelle.
 */
export function spectatorFreshnessMs(pollMs: number, cacheTtlMs: number): number {
  return Math.ceil(pollMs * 1.1) + cacheTtlMs;
}

/**
 * Ce que le visiteur sans compte lit de l'instantané partagé.
 *
 * Les **codes de replay** restent aux membres connectés : la politique de
 * confidentialité les leur réserve (ils permettent de lire en jeu les
 * identifiants des joueurs, BattleTag masqué compris). Le détail des
 * propositions en attente est déjà vide dans l'instantané diffusé ; il l'est
 * ici aussi, explicitement.
 *
 * L'identifiant du **caster** est remplacé par {@link SPECTATOR_HIDDEN_USER_ID} :
 * la fiche sait qu'un caster est inscrit (son pseudo, à l'antenne, s'affiche et
 * il compte dans les « prêts » du lancement) sans savoir qui. `soloUserIds`
 * reste en revanche : il porte la marche du podium d'un joueur engagé en
 * individuel (`useEntrantPodiumClass`), et le podium est public.
 *
 * Les **sanctions** (BlueGenji Survie) gardent l'équipe, la manche et les
 * points, mais ni l'arbitre qui les a prononcées (le staff reste anonyme hors de
 * l'espace connecté) ni leur motif, texte libre du staff qui peut nommer
 * quelqu'un.
 */
export function spectatorSnapshot(snapshot: TournamentSnapshot): TournamentSnapshot {
  return {
    ...snapshot,
    endurance: snapshot.endurance
      ? {
          ...snapshot.endurance,
          penalties: snapshot.endurance.penalties.map((penalty) => ({ ...penalty, reason: "", authorPseudo: null })),
        }
      : null,
    matches: snapshot.matches.map((match) => ({
      ...match,
      casterUserId: match.casterUserId === null ? null : SPECTATOR_HIDDEN_USER_ID,
      maps: match.maps.map((map) => ({ ...map, replayCode: "" })),
      team1Report: match.team1Report ? { ...match.team1Report, maps: [] } : null,
      team2Report: match.team2Report ? { ...match.team2Report, maps: [] } : null,
    })),
  };
}

/**
 * Identifiant de compte « quelqu'un » : présent, mais qui ne désigne personne.
 * Négatif, donc jamais un compte (`AUTO_INCREMENT` part de 1), et distinct du
 * `viewerUserId` du visiteur sans compte (`0`) : il n'est le caster de rien.
 */
export const SPECTATOR_HIDDEN_USER_ID = -1;

/**
 * Contexte du lecteur sans compte : aucun droit, aucun engagé. Toutes les
 * actions de la fiche se décident sur ce contexte — il n'en ouvre aucune.
 * `viewerUserId` vaut `0`, qu'aucun compte ne porte (`AUTO_INCREMENT` part de 1) :
 * personne n'est reconnu comme caster d'un match.
 */
export const SPECTATOR_VIEWER_CONTEXT: Readonly<TournamentViewerContext> = Object.freeze({
  preview: null,
  canRegister: false,
  canRegisterEntrant: false,
  registrationBlock: null,
  myTeamId: null,
  canCreateReportsForTeamIds: [],
  isAdmin: false,
  canDelete: false,
  canCancelForfeit: false,
  canManageLive: false,
  viewerUserId: 0,
  castBlock: "NOT_CASTER",
  matchProposals: [],
});

/**
 * Plancher d'une relecture côté client, quoi que dise une réponse : un en-tête
 * abîmé (proxy, valeur nulle) ne doit jamais faire tourner la page en boucle.
 */
export const SPECTATOR_MIN_POLL_MS = 10_000;

function clampPoll(ms: number): number {
  return Math.min(SPECTATOR_MAX_POLL_MS, Math.max(SPECTATOR_MIN_POLL_MS, ms));
}

/** Intervalle lu dans `x-bg-poll-after-ms` ; la cadence de base s'il manque ou ne se lit pas. */
export function parsePollAfterMs(header: string | null): number {
  const ms = header === null ? Number.NaN : Number(header);
  return Number.isFinite(ms) ? clampPoll(ms) : SPECTATOR_RUNNING_POLL_MS;
}

/**
 * Attente après un échec (réseau, 429, 503) : le **double de la dernière
 * attente**, et jamais moins que le `Retry-After` du serveur — échec après
 * échec, le visiteur sans compte recule jusqu'au plafond, même quand chaque
 * réponse redonne la même attente minimale.
 *
 * @param lastWaitMs Dernière attente : la cadence après un succès, l'attente
 *   précédente après un échec.
 */
export function spectatorRetryDelayMs(lastWaitMs: number, retryAfterHeader: string | null): number {
  const seconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
  const floorMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  return clampPoll(Math.max(floorMs, lastWaitMs * 2));
}

/**
 * ±10 % sur chaque attente : des centaines d'onglets ouverts au même coup
 * d'envoi ne reviennent pas tous à la même seconde.
 */
export function jitteredDelayMs(ms: number, random: () => number = Math.random): number {
  return Math.round(ms * (0.9 + 0.2 * random()));
}
