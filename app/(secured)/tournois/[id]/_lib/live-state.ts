/**
 * Logique pure du flux temps réel d'un tournoi.
 *
 * Le serveur pousse désormais la donnée elle-même plutôt qu'un signal
 * (`app/api/tournaments/[id]/stream`) : ce module dit comment l'intégrer. Il est
 * séparé du hook pour être testable sans navigateur.
 *
 * Deux règles structurent l'ensemble :
 * - l'instantané reçu est **partagé par tous les spectateurs** ; ce qui dépend
 *   du lecteur (son engagement, ses droits) n'arrive qu'à la connexion et
 *   survit aux mises à jour suivantes ;
 * - une reconnexion ne baisse jamais les bras. Le code précédent abandonnait au
 *   bout de cinq tentatives : la page restait alors figée jusqu'au prochain F5,
 *   exactement ce qu'on cherche à supprimer.
 */
import type {
  TournamentDetail,
  TournamentSnapshot,
  TournamentViewerContext,
} from "@/lib/shared/types";
import { isRefreshTier, type RefreshTier } from "@/lib/shared/refresh-tiers";
import { isSoloTournament } from "@/lib/shared/participants";

/** Messages émis par le flux. Tout le reste est ignoré. */
export type LiveMessage =
  | {
      type: "connected";
      tournamentId: number;
      tier: RefreshTier;
      viewer: TournamentViewerContext;
      snapshot: TournamentSnapshot;
    }
  | { type: "snapshot"; tournamentId: number; version: string; snapshot: TournamentSnapshot };

/** État local dérivé du flux. */
export type LiveState = {
  detail: TournamentDetail | null;
  tier: RefreshTier;
};

export const INITIAL_LIVE_STATE: LiveState = { detail: null, tier: "STANDARD" };

/** Analyse un message reçu, ou `null` s'il n'est pas exploitable. */
export function parseLiveMessage(raw: string): LiveMessage | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") return null;
  const message = payload as Record<string, unknown>;

  if (message.type === "connected") {
    if (!message.snapshot || !message.viewer) return null;
    return {
      type: "connected",
      tournamentId: Number(message.tournamentId),
      tier: isRefreshTier(message.tier) ? message.tier : "STANDARD",
      viewer: message.viewer as TournamentViewerContext,
      snapshot: message.snapshot as TournamentSnapshot,
    };
  }

  if (message.type === "snapshot") {
    if (!message.snapshot) return null;
    return {
      type: "snapshot",
      tournamentId: Number(message.tournamentId),
      version: String(message.version ?? ""), // NOSONAR typescript:S6551 — champ scalaire d'un message JSON du flux, jamais un objet
      snapshot: message.snapshot as TournamentSnapshot,
    };
  }

  return null;
}

/**
 * Intègre un message dans l'état courant.
 *
 * Renvoie l'état inchangé — la **même référence** — quand le message n'apporte
 * rien : une version déjà connue, ou un instantané reçu avant que le contexte
 * du lecteur ne soit établi. L'appelant peut donc comparer par identité pour
 * éviter un rendu inutile.
 */
export function applyLiveMessage(state: LiveState, message: LiveMessage): LiveState {
  if (message.type === "connected") {
    // Une reconnexion renvoie l'instantané entier : ce qui n'a pas bougé
    // pendant la coupure garde sa référence, comme pour un instantané ordinaire.
    const snapshot = state.detail
      ? shareUnchanged(state.detail, message.snapshot)
      : message.snapshot;
    return {
      tier: message.tier,
      detail: { ...snapshot, ...message.viewer },
    };
  }

  // Un instantané seul ne suffit pas à afficher la page : sans le contexte du
  // lecteur, on ne saurait ni s'il peut s'inscrire ni ce qu'il peut rapporter.
  if (!state.detail) return state;
  if (state.detail.version === message.snapshot.version) return state;

  const viewer: TournamentViewerContext = {
    canRegister: state.detail.canRegister,
    // Qualité pour engager son équipe (`OWNER`/`MANAGER`) : elle tient au
    // roster, pas au plateau — un instantané ne la connaît pas.
    canRegisterEntrant: state.detail.canRegisterEntrant,
    // Conditions d'inscription : elles se jugent sur le **roster**, que
    // l'instantané ne porte pas davantage. Rejouées telles quelles, comme le
    // reste du contexte — un joueur qui certifie son tag pendant qu'il regarde
    // la page verra le bouton s'ouvrir à sa prochaine connexion au flux, ce qui
    // est le même délai que pour tout autre droit.
    registrationBlock: state.detail.registrationBlock,
    myTeamId: state.detail.myTeamId,
    canCreateReportsForTeamIds: state.detail.canCreateReportsForTeamIds,
    isAdmin: state.detail.isAdmin,
    // Droit de suppression : administrateur strict, accordé à la connexion.
    // Comme les autres droits, il tient à la personne et non au plateau.
    canDelete: state.detail.canDelete,
    // Droit de diffusion : comme les autres droits, il tient à la personne et
    // non au plateau — un instantané ne peut ni l'accorder ni le retirer.
    canManageLive: state.detail.canManageLive,
    // Inscription comme caster : tient à l'identité du lecteur, pas au plateau.
    viewerUserId: state.detail.viewerUserId,
    castBlock: state.detail.castBlock,
    // L'aperçu du plateau n'arrive qu'à la connexion, comme le reste du contexte
    // du lecteur : le flux ne le transporte pas, il est réservé au staff et au
    // cast (`docs/features/TOURNAMENT_PREVIEW.md`).
    preview: state.detail.preview,
  };

  const snapshot = shareUnchanged(state.detail, message.snapshot);
  return {
    tier: state.tier,
    detail: {
      ...snapshot,
      ...viewer,
      canRegister: canRegisterIn(snapshot, viewer),
    },
  };
}

/**
 * Partage structurel : reprend de l'état précédent ce que l'instantané reçu
 * n'a pas changé.
 *
 * Chaque instantané arrive entier et désérialisé à neuf : sans ce partage, le
 * moindre « Prêt » ou score remplaçait **tous** les objets de match, et les 254
 * cartes d'un gros plateau se redessinaient alors que 253 n'avaient pas bougé —
 * `React.memo` n'y pouvait rien, puisqu'aucune prop n'était jamais la même.
 * Un match, une inscrite ou la table des entrées solo inchangés gardent donc
 * leur **référence**, et une liste dont aucun élément n'a bougé garde la
 * sienne (ce qui profite aussi aux calculs mémorisés sur la liste entière,
 * comme les verrous de score).
 *
 * « Inchangé » se juge sur le **contenu**, champ par champ, et non sur
 * `updatedAt` : un match porte des champs dérivés d'autres lignes (nom d'une
 * équipe renommée, pseudo du caster) qu'aucune écriture sur la ligne du match
 * ne date. Le coût est linéaire et sans commune mesure avec un rendu.
 */
export function shareUnchanged(
  previous: TournamentSnapshot,
  next: TournamentSnapshot,
): TournamentSnapshot {
  const matches = shareList(previous.matches, next.matches, (match) => match.id);
  const registrations = shareList(previous.registrations, next.registrations, (row) => row.teamId);
  const soloUserIds = sameValue(previous.soloUserIds, next.soloUserIds)
    ? previous.soloUserIds
    : next.soloUserIds;
  if (
    matches === next.matches &&
    registrations === next.registrations &&
    soloUserIds === next.soloUserIds
  ) {
    return next;
  }
  return { ...next, matches, registrations, soloUserIds };
}

/**
 * Liste où chaque élément inchangé (même clé, même contenu) est l'élément
 * précédent. Si rien n'a bougé — mêmes éléments, même ordre —, la liste
 * précédente elle-même.
 */
function shareList<T extends object>(
  previous: readonly T[] | undefined,
  next: T[],
  keyOf: (item: T) => number,
): T[] {
  if (!previous || previous.length === 0) return next;
  const byKey = new Map<number, T>();
  for (const item of previous) byKey.set(keyOf(item), item);

  let allReused = previous.length === next.length;
  const shared = next.map((item, index) => {
    const before = byKey.get(keyOf(item));
    if (before !== undefined && sameValue(before, item)) {
      if (previous[index] !== before) allReused = false;
      return before;
    }
    allReused = false;
    return item;
  });
  return allReused ? (previous as T[]) : shared;
}

/**
 * Égalité de contenu de deux valeurs JSON (ce que porte un instantané : ni
 * fonction, ni date, ni cycle).
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!sameValue(a[i], other[i])) return false;
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(right, key)) return false;
    if (!sameValue(left[key], right[key])) return false;
  }
  return true;
}

/**
 * Le lecteur peut-il s'inscrire à ce tournoi ?
 *
 * Même règle que le serveur (`getTournamentViewerContext`), recalculée à chaque
 * instantané : l'ouverture comme la fermeture des inscriptions se voient alors
 * d'elles-mêmes, dans les deux sens. Le bouton reste évidemment sous le contrôle
 * du serveur — c'est lui qui accepte ou refuse l'inscription.
 */
function canRegisterIn(snapshot: TournamentSnapshot, viewer: TournamentViewerContext): boolean {
  if (snapshot.card.state !== "REGISTRATION") return false;
  // Qualité pour engager (`OWNER`/`MANAGER`) : elle vient du contexte du
  // lecteur et se rejoue telle quelle — l'instantané ne connaît pas les rosters.
  if (!viewer.canRegisterEntrant) return false;
  // **Les conditions d'inscription aussi**, et pour la même raison : elles se
  // jugent sur le roster. Les oublier ici rouvrait le bouton au premier
  // instantané suivant la connexion — un autre engagé s'inscrit, un score est
  // saisi —, et le clic partait alors droit sur un 409.
  if (viewer.registrationBlock) return false;
  if (
    viewer.myTeamId !== null &&
    snapshot.registrations.some((row) => row.teamId === viewer.myTeamId)
  ) {
    return false;
  }
  // En individuel, un joueur sans entrée solo peut s'inscrire : elle sera créée
  // à ce moment-là.
  return isSoloTournament(snapshot.card.participantType) || viewer.myTeamId !== null;
}

/**
 * Échec dont une reconnexion ne viendra jamais à bout.
 *
 * Le flux SSE ne dit pas pourquoi il tombe — `onerror` n'expose aucun statut :
 * c'est la lecture REST de secours qui tranche. Sans cette distinction, une
 * session expirée laisserait la page réessayer pour l'éternité en affichant
 * « Reconnexion… », sans jamais orienter vers la page de connexion.
 */
export type LiveFailure = "UNAUTHORIZED" | "TOURNAMENT_NOT_FOUND";

/**
 * Traduit un statut HTTP en échec définitif, ou `null` si réessayer a un sens.
 *
 * Volontairement restreint : 429 (plafond de débit) et 5xx sont passagers et
 * doivent continuer d'être retentés.
 */
export function fatalFailure(status: number): LiveFailure | null {
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 404) return "TOURNAMENT_NOT_FOUND";
  return null;
}

/**
 * Faut-il redemander le contexte du lecteur ?
 *
 * Le flux ne transporte que l'instantané, partagé par tous. Le contexte, lui,
 * n'arrive qu'à la connexion — ce qui convient à ses droits, qui ne bougent
 * pas, mais **pas à l'aperçu du plateau** qu'il porte : celui-ci se recalcule à
 * chaque inscription. Sans cette relecture, un caster verrait la liste des
 * inscrites grandir sous ses yeux pendant que le tirage prévu resterait celui
 * d'il y a dix minutes.
 *
 * On ne relit que pour ceux qui ont un aperçu à tenir à jour, et seulement
 * quand quelque chose le périme : le passage à un état où l'aperçu n'a plus
 * lieu d'être, ou un changement de l'ordre de tirage.
 *
 * L'**ordre**, et non le nombre d'inscrites : les flèches de `RegistrationsPanel`
 * existent justement pour que le staff réorganise ce tirage avant le lancement,
 * à effectif constant. Compter les inscrites laisserait le caster sur l'ancien ordre
 * pendant que l'arbitre voit le nouveau — le cas le plus probable de tous.
 */
export function shouldRefreshViewerContext(
  previous: TournamentDetail,
  next: TournamentSnapshot,
): boolean {
  if (previous.preview === null) return false;
  if (previous.card.state !== next.card.state) return true;
  return seedingOrderOf(previous.registrations) !== seedingOrderOf(next.registrations);
}

/** Empreinte de l'ordre de tirage : les engagées et leur rang, dans l'ordre. */
function seedingOrderOf(registrations: TournamentSnapshot["registrations"]): string {
  return registrations.map((row) => `${row.teamId}:${row.seed ?? ""}`).join("|");
}

/**
 * La charge utile relue en REST apporte-t-elle quelque chose ?
 *
 * Sans déduplication, chaque sondage de secours redessinerait l'arbre entier —
 * 254 matchs sur un gros plateau — alors que rien n'a bougé. La version de
 * l'instantané suffit à le dire.
 *
 * Mais la charge porte **deux moitiés qui ne changent pas ensemble** :
 * l'instantané, partagé, et le contexte du lecteur — droits, aperçu du plateau —
 * qui n'a pas de version à lui. Quand c'est la seconde qu'on vient chercher
 * (`wantsViewerContext`), la première est presque toujours identique : le flux
 * vient de pousser cette version-là, c'est même ce qui a déclenché la relecture.
 * Déduire de l'égalité des versions qu'il n'y a rien à prendre jetterait alors
 * systématiquement ce qu'on était venu chercher — un ordre de tirage réorganisé
 * par l'arbitre resterait figé sur l'écran du caster jusqu'au rechargement.
 */
export function shouldCommitFetched(
  current: TournamentDetail | null,
  payload: TournamentDetail,
  wantsViewerContext: boolean,
): boolean {
  if (wantsViewerContext || !current) return true;
  return !payload.version || payload.version !== current.version;
}

/**
 * Délai accordé au premier instantané une fois le flux **ouvert**.
 *
 * Un flux peut s'ouvrir (200, `onopen`) sans jamais rien livrer : un proxy ou un
 * antivirus qui met la réponse en tampon la retient tant qu'elle n'est pas finie,
 * et un flux ne finit pas. Aucune erreur ne se déclare, donc le repli REST — qui
 * n'est armé que par `onerror` — ne partait jamais, et la page restait sur
 * « Chargement du tournoi… » pour toujours. Passé ce délai sans instantané, on lit
 * la donnée par REST et on sonde en secours, sans fermer le flux : s'il se met à
 * livrer, il reprend la main.
 *
 * Le premier message est écrit dès la connexion côté serveur : quelques secondes
 * couvrent largement une salle chargée, sans faire attendre un lecteur bloqué.
 */
export const FIRST_SNAPSHOT_TIMEOUT_MS = 5_000;

/** Plafond exponentiel de départ, en millisecondes. */
export const RECONNECT_BASE_MS = 1_000;
/** Plafond de l'attente. Au-delà, on retente simplement toutes les minutes. */
export const RECONNECT_MAX_MS = 60_000;
/** Plancher, pour ne jamais boucler à vide sur une erreur immédiate. */
export const RECONNECT_MIN_MS = 250;

/**
 * Attente avant la `attempt`-ième reconnexion (1 = première).
 *
 * Croissance exponentielle plafonnée, tirée **au hasard dans tout
 * l'intervalle** (« full jitter ») plutôt qu'autour de la borne haute.
 *
 * Ce n'est pas cosmétique : au redémarrage du serveur, toutes les pages
 * ouvertes voient leur flux tomber à la même seconde. Une gigue étroite les
 * ferait toutes revenir dans la même demi-seconde, et chaque reconnexion prend
 * une connexion du pool (25) — de quoi refaire tomber ce qui vient de se
 * relever. Tirer dans tout l'intervalle étale la reprise, pour un coût nul.
 */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, Math.trunc(attempt) - 1);
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** exponent);
  return Math.max(RECONNECT_MIN_MS, Math.round(random() * ceiling));
}
