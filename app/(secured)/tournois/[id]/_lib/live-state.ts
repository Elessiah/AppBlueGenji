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
  BracketMatch,
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
      version: String(message.version ?? ""),
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
    return {
      tier: message.tier,
      detail: { ...message.snapshot, ...message.viewer },
    };
  }

  // Un instantané seul ne suffit pas à afficher la page : sans le contexte du
  // lecteur, on ne saurait ni s'il peut s'inscrire ni ce qu'il peut rapporter.
  if (!state.detail) return state;
  if (state.detail.version === message.snapshot.version) return state;

  const viewer: TournamentViewerContext = {
    canRegister: state.detail.canRegister,
    myTeamId: state.detail.myTeamId,
    canCreateReportsForTeamIds: state.detail.canCreateReportsForTeamIds,
    isAdmin: state.detail.isAdmin,
    // L'aperçu du plateau n'arrive qu'à la connexion, comme le reste du contexte
    // du lecteur : le flux ne le transporte pas, il est réservé au staff et au
    // cast (`docs/features/TOURNAMENT_PREVIEW.md`).
    preview: state.detail.preview,
  };

  return {
    tier: state.tier,
    detail: {
      ...message.snapshot,
      ...viewer,
      canRegister: canRegisterIn(message.snapshot, viewer.myTeamId),
    },
  };
}

/**
 * Le lecteur peut-il s'inscrire à ce tournoi ?
 *
 * Même règle que le serveur (`getTournamentViewerContext`), recalculée à chaque
 * instantané : l'ouverture comme la fermeture des inscriptions se voient alors
 * d'elles-mêmes, dans les deux sens. Le bouton reste évidemment sous le contrôle
 * du serveur — c'est lui qui accepte ou refuse l'inscription.
 */
function canRegisterIn(snapshot: TournamentSnapshot, myTeamId: number | null): boolean {
  if (snapshot.card.state !== "REGISTRATION") return false;
  if (myTeamId !== null && snapshot.registrations.some((row) => row.teamId === myTeamId)) {
    return false;
  }
  // En individuel, un joueur sans entrée solo peut s'inscrire : elle sera créée
  // à ce moment-là.
  return isSoloTournament(snapshot.card.participantType) || myTeamId !== null;
}

function awaitingConfirmationIds(matches: BracketMatch[], teamId: number | null): Set<number> {
  if (teamId === null) return new Set();
  return new Set(
    matches
      .filter(
        (match) =>
          match.status === "AWAITING_CONFIRMATION" &&
          (match.team1Id === teamId || match.team2Id === teamId),
      )
      .map((match) => match.id),
  );
}

/**
 * Faut-il jouer le signal sonore « score à confirmer » ?
 *
 * Uniquement quand un match **du lecteur** vient d'entrer en attente de
 * confirmation. Le flux ne portant plus l'événement brut mais l'état, c'est la
 * comparaison des deux instantanés qui le dit — et le son ne dérange plus les
 * spectateurs, qui n'ont rien à confirmer.
 */
export function shouldPlayScoreReady(
  previous: TournamentDetail | null,
  next: TournamentDetail,
): boolean {
  if (!previous) return false;
  if (next.myTeamId === null) return false;

  const before = awaitingConfirmationIds(previous.matches, previous.myTeamId);
  const after = awaitingConfirmationIds(next.matches, next.myTeamId);

  for (const id of after) {
    if (!before.has(id)) return true;
  }
  return false;
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
 * L'**ordre**, et non le nombre d'inscrites : `SeedingEditor` existe justement
 * pour que le staff réorganise ce tirage avant le lancement, à effectif
 * constant. Compter les inscrites laisserait le caster sur l'ancien ordre
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
