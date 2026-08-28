/**
 * Paliers de rafraîchissement des données critiques.
 *
 * Tout le monde n'a pas besoin de la même fraîcheur. Une arbitre qui saisit un
 * score, une équipe qui attend son adversaire et un visiteur qui regarde le
 * plateau n'ont ni la même urgence ni le même coût : le serveur tourne sur un
 * Raspberry Pi et doit tenir une centaine de connexions simultanées. Ce module
 * est le seul endroit où se décide « à quelle cadence », pour que serveur et
 * client raisonnent sur les mêmes nombres.
 *
 * Deux paliers seulement, volontairement :
 * - `PRIORITY` — staff tournois (`can(user, "tournaments")`) et engagés du
 *   tournoi consulté. Ce sont les seuls à agir sur la donnée ; ils la reçoivent
 *   quasi instantanément.
 * - `STANDARD` — tout le reste (spectateurs, visiteurs). Ils voient la même
 *   chose, avec un retard borné et sans jamais avoir à recharger la page.
 *
 * Un troisième palier « caster » n'existe pas encore faute de rôle
 * correspondant : le jour où `PlatformRole` en gagne un, il suffira de le faire
 * entrer dans `isStaff` au point d'appel — ce module n'a pas à le connaître.
 *
 * Module pur : aucune dépendance serveur, importable partout.
 */

/** Palier de fraîcheur accordé à un utilisateur pour une ressource donnée. */
export type RefreshTier = "PRIORITY" | "STANDARD";

/** Ce qui distingue un utilisateur prioritaire d'un spectateur. */
export type RefreshTierInput = {
  /** Staff tournois : administrateurs et arbitres (`can(user, "tournaments")`). */
  isStaff?: boolean;
  /** Engagé du tournoi consulté (équipe inscrite, ou entrée solo). */
  isParticipant?: boolean;
};

/**
 * Cadences, en millisecondes, par palier.
 *
 * `pushCoalesceMs` est le seul réglage qui vive côté serveur : c'est la fenêtre
 * pendant laquelle plusieurs événements d'un même tournoi ne produisent qu'un
 * seul envoi vers un abonné de ce palier. Il borne la bande passante — un
 * instantané de gros tournoi pèse quelques dizaines de kilo-octets, et il part
 * vers tous les abonnés à la fois.
 *
 * Les autres valeurs sont des filets de sécurité côté client : le flux SSE
 * pousse la donnée, le sondage ne sert que s'il est tombé.
 */
export type RefreshCadence = {
  /** Fenêtre de regroupement des envois SSE, côté serveur. */
  pushCoalesceMs: number;
  /** Sondage de secours du détail d'un tournoi, flux SSE indisponible. */
  detailFallbackMs: number;
  /** Sondage de la liste des tournois (aucun flux SSE sur cette page). */
  listIntervalMs: number;
  /** Sondage du bandeau « en direct » de la page d'accueil. */
  landingLiveMs: number;
};

export const REFRESH_CADENCE: Record<RefreshTier, RefreshCadence> = {
  PRIORITY: {
    pushCoalesceMs: 1_000,
    detailFallbackMs: 15_000,
    listIntervalMs: 60_000,
    landingLiveMs: 30_000,
  },
  STANDARD: {
    pushCoalesceMs: 20_000,
    detailFallbackMs: 120_000,
    listIntervalMs: 300_000,
    landingLiveMs: 300_000,
  },
};

/**
 * Délai minimal entre deux rafraîchissements déclenchés par le retour de
 * l'utilisateur sur l'onglet. Revenir sur la page rafraîchit — c'est ce qui
 * remplace le F5 — mais alterner entre deux onglets ne doit pas mitrailler le
 * serveur.
 */
export const FOCUS_REFRESH_MIN_INTERVAL_MS = 15_000;

/** Palier accordé à un utilisateur. Le staff et les engagés passent devant. */
export function resolveRefreshTier(input: RefreshTierInput | null | undefined): RefreshTier {
  if (!input) return "STANDARD";
  return input.isStaff || input.isParticipant ? "PRIORITY" : "STANDARD";
}

/** Cadences du palier accordé à `input`. Raccourci du couple résolution + table. */
export function refreshCadenceFor(input: RefreshTierInput | null | undefined): RefreshCadence {
  return REFRESH_CADENCE[resolveRefreshTier(input)];
}

/** Vrai si `value` est un palier connu (validation d'un message reçu du réseau). */
export function isRefreshTier(value: unknown): value is RefreshTier {
  return value === "PRIORITY" || value === "STANDARD";
}
