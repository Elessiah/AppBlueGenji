"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import {
  formatProfilelessLookup,
  PROFILELESS_LOOKUP_MAX,
  PROFILELESS_NAME_MAX,
  type ProfilelessLookupEntry,
} from "@/lib/shared/profileless-lookup";

/**
 * Les comptes supprimés **sans fiche** (décision D13, `lib/server/users/profileless-players.ts`),
 * lus par les liens de joueur (`PlayerLink`, `EntrantLink` d'une entrée solo) :
 * leur nom reste un nom, aucun lien ne mène à une fiche qui répond 404.
 *
 * **Seuls les comptes affichés** sont demandés (décision D86) : chaque lien
 * monté inscrit son compte **avec le nom qu'il affiche** (`useHasPlayerPage`),
 * et les comptes d'un même rendu partent ensemble (`POST
 * /api/players/profileless`, par paquets de {@link PROFILELESS_LOOKUP_MAX}) —
 * la liste entière des comptes supprimés ne part plus dans chaque page, et la
 * route ne répond que pour un nom qui est bien celui du compte. Un lien sans
 * nom lisible (contenu composé sans `playerName`) n'est pas demandé : il reste
 * un lien. Un compte inscrit est redemandé à la navigation
 * client, au plus une fois par {@link PROFILELESS_REFRESH_MS} : un compte
 * supprimé entre-temps ne garde pas son lien jusqu'au rechargement. Tant que la
 * réponse n'est pas là (ou en panne), le nom reste un lien — au pire vers une
 * fiche 404.
 *
 * Hors fournisseur, ou sans recherche (`lookup`, visiteur connecté seulement),
 * toute fiche existe sauf celles données d'emblée (`ids`, rendu serveur des
 * tests et aperçus) : un nom reste un lien.
 */

/** Intervalle minimal entre deux questions sur un même compte. */
export const PROFILELESS_REFRESH_MS = 60_000;

/**
 * Délai avant de redemander après un premier échec (hors ligne, 429, 5xx) : plus
 * court qu'une fenêtre, mais jamais un essai par changement de page — un refus
 * (`PROFILELESS_LOOKUP_RULE`) que l'on martèlerait resterait déclenché. Une
 * minuterie redemande d'elle-même (une page de direct reste ouverte des heures,
 * sans navigation qui s'en charge) ; le délai double à chaque échec de suite,
 * jusqu'à {@link PROFILELESS_RETRY_MAX_MS}.
 */
export const PROFILELESS_RETRY_MS = 15_000;

/** Plafond du délai entre deux essais après des échecs de suite. */
export const PROFILELESS_RETRY_MAX_MS = 120_000;

/** Durée au bout de laquelle une question restée sans réponse est tenue pour échouée. */
export const PROFILELESS_TIMEOUT_MS = 10_000;

/** Un identifiant de compte que la route accepte : entier positif sûr. */
export function isLookupId(userId: unknown): userId is number {
  return typeof userId === "number" && Number.isSafeInteger(userId) && userId > 0;
}

/** Regroupement des comptes inscrits par un même rendu en une seule question. */
export const PROFILELESS_BATCH_MS = 50;

/**
 * Questions envoyées d'un coup, au plus : la route compte 60 questions par
 * minute et par compte (`PROFILELESS_LOOKUP_RULE`), et un affichage de
 * milliers de joueurs (classement, annuaire) ne doit pas la vider en une salve.
 * Le reste attend.
 */
export const PROFILELESS_CHUNKS_PER_BURST = 4;

/** Attente entre deux salves : quatre questions par dix secondes, soit 24 par minute — deux onglets tiennent sous la borne. */
export const PROFILELESS_BURST_GAP_MS = 10_000;

/** Les ids d'une réponse de `/api/players/profileless`, ou `null` si elle n'en porte pas. */
export function parseProfilelessIds(body: unknown): number[] | null {
  if (typeof body !== "object" || body === null) return null;
  const ids = (body as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) return null;
  return ids.filter((id): id is number => Number.isSafeInteger(id) && id > 0);
}

/** Ceux des comptes demandés qui sont sans fiche, ou `null` (hors ligne, refus, corps illisible). */
export async function fetchProfilelessIds(
  players: readonly ProfilelessLookupEntry[],
  fetchImpl: typeof fetch = fetch,
): Promise<number[] | null> {
  try {
    // Un `POST` : les noms affichés ne passent pas par l'adresse (journaux d'accès).
    const response = await fetchImpl("/api/players/profileless", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formatProfilelessLookup(players)),
      cache: "no-store",
      // Une connexion qui cale sans erreur ne garde pas ses comptes « en vol » à jamais.
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(PROFILELESS_TIMEOUT_MS) : undefined,
    });
    return response.ok ? parseProfilelessIds(await response.json()) : null;
  } catch {
    return null;
  }
}

/** Ce que les liens lisent : la réponse connue de chaque compte affiché. */
export type ProfilelessStore = {
  subscribe(listener: () => void): () => void;
  /** Ce compte est-il sans fiche, d'après la dernière réponse ? */
  isProfileless(userId: number): boolean;
  /** Même question pour le rendu serveur et l'hydratation : les seuls comptes donnés d'emblée. */
  isSeeded(userId: number): boolean;
  /**
   * Un lien affiche ce compte sous ce nom : il est demandé s'il ne l'a pas été
   * dans la fenêtre (ou sous un autre nom). Sans nom, il n'est pas demandé.
   * Rend le retrait.
   */
  watch(userId: number, name?: string): () => void;
  /** Navigation client : les comptes affichés dont la réponse a passé la fenêtre sont redemandés. */
  refreshStale(): void;
};

type StoreOptions = {
  seed?: readonly number[];
  lookup: boolean;
  fetchIds?: (players: readonly ProfilelessLookupEntry[]) => Promise<number[] | null>;
  now?: () => number;
  /** Lance `run` dans `ms` ; rend, si possible, de quoi l'annuler. */
  schedule?: (run: () => void, ms: number) => (() => void) | void;
};

/** Crée la mémoire des réponses d'une page (une par fournisseur). */
export function createProfilelessStore({
  seed = [],
  lookup,
  fetchIds = fetchProfilelessIds,
  now = Date.now,
  schedule = (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
}: StoreOptions): ProfilelessStore {
  const seeded = new Set(seed);
  const answers = new Map<number, boolean>(seed.map((id) => [id, true]));
  const askedAt = new Map<number, number>();
  /** Échecs de suite par compte : l'essai suivant attend d'autant plus. */
  const failures = new Map<number, number>();
  const shown = new Map<number, number>();
  /** Le nom affiché de chaque compte (le dernier lien monté l'emporte), et celui de la dernière question. */
  const names = new Map<number, string>();
  const askedName = new Map<number, string>();
  const queued = new Set<number>();
  const inFlight = new Set<number>();
  const listeners = new Set<() => void>();
  let flushArmed = false;
  /** Minuterie de reprise (une seule pour la mémoire) : quand, de quoi l'annuler, et sa génération. */
  let retryAt = Number.POSITIVE_INFINITY;
  let cancelRetry: (() => void) | undefined;
  let retryGeneration = 0;

  const wait = (userId: number): number => {
    const count = failures.get(userId);
    if (count === undefined) return PROFILELESS_REFRESH_MS;
    return Math.min(PROFILELESS_RETRY_MS * 2 ** (count - 1), PROFILELESS_RETRY_MAX_MS);
  };

  const due = (userId: number): boolean => {
    if (seeded.has(userId) || queued.has(userId) || inFlight.has(userId) || !names.has(userId)) return false;
    // Un autre nom affiché (renommage, réponse fraîche) se redemande sans attendre.
    if (askedName.has(userId) && askedName.get(userId) !== names.get(userId)) return true;
    const at = askedAt.get(userId);
    if (at === undefined) return true;
    return now() - at >= wait(userId);
  };

  const settle = (chunk: readonly number[], profileless: number[] | null) => {
    let changed = false;
    for (const userId of chunk) {
      inFlight.delete(userId);
      if (profileless === null) {
        failures.set(userId, (failures.get(userId) ?? 0) + 1);
        continue;
      }
      failures.delete(userId);
      const next = profileless.includes(userId);
      if ((answers.get(userId) === true) !== next) changed = true;
      answers.set(userId, next);
    }
    // Un échec se redemande de lui-même, tant que le compte est affiché.
    if (profileless === null) armRetry();
    // Rien de changé : les liens ne se re-rendent pas.
    if (changed) for (const listener of listeners) listener();
  };

  const flush = () => {
    flushArmed = false;
    // Un compte qui n'est plus affiché n'est plus demandé.
    const ids = [...queued].filter((userId) => shown.has(userId) && names.has(userId));
    queued.clear();
    const at = now();
    const sent = ids.slice(0, PROFILELESS_CHUNKS_PER_BURST * PROFILELESS_LOOKUP_MAX);
    for (let start = 0; start < sent.length; start += PROFILELESS_LOOKUP_MAX) {
      const chunk = sent.slice(start, start + PROFILELESS_LOOKUP_MAX);
      const entries = chunk.map((userId) => ({ id: userId, name: names.get(userId) ?? "" }));
      for (const { id: userId, name } of entries) {
        inFlight.add(userId);
        // La fenêtre est prise avant l'envoi : jamais deux questions en vol.
        askedAt.set(userId, at);
        askedName.set(userId, name);
      }
      void fetchIds(entries).then(
        (profileless) => settle(chunk, profileless),
        () => settle(chunk, null),
      );
    }
    // Le reste part à la salve suivante, sous la borne de la route.
    for (const userId of ids.slice(sent.length)) queued.add(userId);
    if (queued.size > 0) {
      flushArmed = true;
      schedule(flush, PROFILELESS_BURST_GAP_MS);
    }
  };

  /**
   * Arme la minuterie de reprise sur le prochain essai dû parmi les comptes
   * affichés en échec : une seule pour la mémoire, réarmée après chaque
   * passage — un compte dont l'attente est plus longue que celle des autres
   * n'est pas oublié.
   */
  const armRetry = () => {
    let soonest = Number.POSITIVE_INFINITY;
    for (const userId of shown.keys()) {
      if (!failures.has(userId) || inFlight.has(userId) || queued.has(userId)) continue;
      soonest = Math.min(soonest, (askedAt.get(userId) ?? now()) + wait(userId));
    }
    if (soonest >= retryAt) return;
    cancelRetry?.();
    retryAt = soonest;
    retryGeneration += 1;
    const generation = retryGeneration;
    cancelRetry =
      schedule(() => {
        // Annulée ou remplacée entre-temps : rien à faire.
        if (generation !== retryGeneration) return;
        retryAt = Number.POSITIVE_INFINITY;
        cancelRetry = undefined;
        for (const userId of shown.keys()) ask(userId);
        armRetry();
      }, Math.max(soonest - now(), 0)) ?? undefined;
  };

  /** Plus aucun lien : la reprise n'a plus d'objet. */
  const stopRetry = () => {
    retryGeneration += 1;
    cancelRetry?.();
    cancelRetry = undefined;
    retryAt = Number.POSITIVE_INFINITY;
  };

  const ask = (userId: number) => {
    if (!lookup || !isLookupId(userId) || !due(userId)) return;
    queued.add(userId);
    if (flushArmed) return;
    flushArmed = true;
    schedule(flush, PROFILELESS_BATCH_MS);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isProfileless: (userId) => answers.get(userId) === true,
    isSeeded: (userId) => seeded.has(userId),
    watch(userId, name) {
      shown.set(userId, (shown.get(userId) ?? 0) + 1);
      // Un nom que la route refuserait (vide, trop long) ferait refuser tout son paquet : pas demandé.
      const shownName = name?.trim();
      if (shownName && shownName.length <= PROFILELESS_NAME_MAX) names.set(userId, shownName);
      ask(userId);
      armRetry();
      return () => {
        const count = (shown.get(userId) ?? 1) - 1;
        if (count > 0) shown.set(userId, count);
        else {
          shown.delete(userId);
          names.delete(userId);
        }
        if (shown.size === 0) stopRetry();
      };
    },
    refreshStale() {
      // Une session d'une seule page dure des heures : ce qui n'est plus affiché
      // et dont la réponse a vieilli est oublié (il serait redemandé de toute façon).
      for (const [userId, at] of askedAt) {
        if (shown.has(userId) || seeded.has(userId) || now() - at < PROFILELESS_REFRESH_MS) continue;
        askedAt.delete(userId);
        askedName.delete(userId);
        answers.delete(userId);
        failures.delete(userId);
      }
      for (const userId of shown.keys()) ask(userId);
      armRetry();
    },
  };
}

const ProfilelessPlayersContext = createContext<ProfilelessStore | null>(null);

const NO_IDS: readonly number[] = [];

export function ProfilelessPlayersProvider({
  ids = NO_IDS,
  lookup = false,
  children,
}: Readonly<{ ids?: readonly number[]; lookup?: boolean; children: ReactNode }>) {
  const store = useMemo(() => createProfilelessStore({ seed: ids, lookup }), [ids, lookup]);
  return (
    <ProfilelessPlayersContext.Provider value={store}>
      {lookup ? <ProfilelessNavigation store={store} /> : null}
      {children}
    </ProfilelessPlayersContext.Provider>
  );
}

/** Redemande, à chaque navigation client, les comptes affichés dont la réponse a vieilli. */
function ProfilelessNavigation({ store }: Readonly<{ store: ProfilelessStore }>) {
  const pathname = usePathname();
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = pathname;
    store.refreshStale();
  }, [pathname, store]);
  return null;
}

const noSubscription = () => () => undefined;

/**
 * La fiche `/joueurs/<id>` de ce compte existe-t-elle ? `undefined` (pas un
 * joueur) : oui. `name` : le nom que le lien affiche, envoyé avec la question
 * (la route ne répond que pour le nom du compte) ; sans lui, le compte n'est
 * pas demandé et le nom reste un lien.
 */
export function useHasPlayerPage(userId: number | undefined, name?: string): boolean {
  const store = useContext(ProfilelessPlayersContext);
  useEffect(
    () => (userId === undefined || store === null ? undefined : store.watch(userId, name)),
    [store, userId, name],
  );
  const profileless = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => userId !== undefined && store !== null && store.isProfileless(userId),
    () => userId !== undefined && store !== null && store.isSeeded(userId),
  );
  return !profileless;
}
