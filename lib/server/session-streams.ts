/**
 * Flux SSE ouverts, rangés par session — pour pouvoir les fermer quand la
 * session qui les a ouverts tombe.
 *
 * Le flux d'un tournoi ne lit la session qu'**à l'ouverture** : il garde ensuite
 * le contexte du lecteur (palier prioritaire, aperçu du plateau d'un arbitre,
 * tournoi non publié) aussi longtemps que la connexion tient. Sans ce registre,
 * une déconnexion, la révocation des autres appareils, une suspension ou la
 * suppression du compte laissaient l'onglet déjà ouvert recevoir les instantanés
 * jusqu'au rechargement — aucune écriture possible (les routes relisent la
 * session), mais une lecture que plus rien n'autorise.
 *
 * Fermer plutôt que relire la session au battement de cœur : la relecture
 * coûterait une requête par flux toutes les 25 s, et laisserait encore 25 s de
 * lecture après la révocation. Fermé, le client se reconnecte et la route lui
 * répond 401 — c'est la porte ordinaire qui décide, pas une seconde règle.
 *
 * Mémoire du processus, comme les salles de diffusion (`tournament-broadcast.ts`)
 * qu'elle accompagne : un flux et sa révocation vivent dans le même processus
 * tant que l'application tourne en instance unique.
 */

type Entry = {
  userId: number;
  /** Empreinte de la session — `""` pour le contournement de développement. */
  tokenHash: string;
  close: () => void;
};

/**
 * Une révocation récente, gardée le temps qu'un flux en cours d'ouverture
 * puisse la constater (`revokedSince`).
 */
type Revocation = {
  mark: number;
  at: number;
  userId?: number;
  tokenHash?: string;
  keepTokenHash?: string;
};

type GlobalWithRegistry = typeof globalThis & {
  __bgSessionStreams?: Set<Entry>;
  __bgStreamRevocations?: { mark: number; recent: Revocation[] };
};

/**
 * Durée pendant laquelle une révocation reste lisible par un flux qui
 * s'ouvrait au même moment. Il ne lui faut que le temps d'une lecture de
 * session : une minute laisse une large marge sous charge.
 */
export const REVOCATION_MEMORY_MS = 60_000;

function revocations(): { mark: number; recent: Revocation[] } {
  const globalRef = globalThis as GlobalWithRegistry;
  globalRef.__bgStreamRevocations ??= { mark: 0, recent: [] };
  return globalRef.__bgStreamRevocations;
}

function prune(now: number): void {
  const state = revocations();
  state.recent = state.recent.filter((entry) => now - entry.at < REVOCATION_MEMORY_MS);
}

function noteRevocation(revocation: Omit<Revocation, "mark" | "at">): void {
  const now = Date.now();
  prune(now);
  const state = revocations();
  state.mark += 1;
  state.recent.push({ ...revocation, mark: state.mark, at: now });
}

/**
 * Repère à prendre **avant** de lire la session : une révocation commitée
 * pendant cette lecture ne trouve pas encore le flux à fermer, mais laisse une
 * trace que `revokedSince` retrouve une fois le flux inscrit.
 */
export function revocationMark(): number {
  return revocations().mark;
}

/** Une révocation postérieure au repère vise-t-elle ce compte ou cette session ? */
export function revokedSince(userId: number, tokenHash: string, mark: number): boolean {
  prune(Date.now());
  return revocations().recent.some((entry) => {
    if (entry.mark <= mark) return false;
    if (entry.tokenHash !== undefined) return entry.tokenHash === tokenHash;
    return (
      entry.userId === userId &&
      (entry.keepTokenHash === undefined || entry.keepTokenHash !== tokenHash)
    );
  });
}

function registry(): Set<Entry> {
  const globalRef = globalThis as GlobalWithRegistry;
  globalRef.__bgSessionStreams ??= new Set();
  return globalRef.__bgSessionStreams;
}

/**
 * Inscrit un flux ouvert. Rend la désinscription, à appeler à sa fermeture
 * (idempotente).
 */
export function registerSessionStream(
  userId: number,
  tokenHash: string,
  close: () => void,
): () => void {
  const entry: Entry = { userId, tokenHash, close };
  registry().add(entry);
  return () => {
    registry().delete(entry);
  };
}

function closeMatching(predicate: (entry: Entry) => boolean): number {
  // Copie d'abord : `close` désinscrit l'entrée pendant le parcours.
  const targets = [...registry()].filter(predicate);
  for (const entry of targets) {
    registry().delete(entry);
    try {
      entry.close();
    } catch {
      // Un flux déjà terminé ne doit pas empêcher de fermer les suivants.
    }
  }
  return targets.length;
}

/**
 * Ferme les flux d'un compte — tous, ou tous sauf ceux de la session gardée
 * (`keepTokenHash`, « déconnecter mes autres appareils »).
 *
 * @returns le nombre de flux fermés.
 */
export function closeUserStreams(userId: number, options: { keepTokenHash?: string } = {}): number {
  const { keepTokenHash } = options;
  noteRevocation({ userId, keepTokenHash });
  return closeMatching(
    (entry) =>
      entry.userId === userId &&
      (keepTokenHash === undefined || entry.tokenHash !== keepTokenHash),
  );
}

/**
 * Ferme les flux ouverts par une session précise (déconnexion de cet appareil).
 * Une empreinte vide ne désigne aucune session réelle et ne ferme rien.
 */
export function closeSessionStreams(tokenHash: string): number {
  if (!tokenHash) return 0;
  noteRevocation({ tokenHash });
  return closeMatching((entry) => entry.tokenHash === tokenHash);
}

/** Oublie tous les flux inscrits (sans les fermer) et les révocations récentes. Réservé aux tests. */
export function resetSessionStreams(): void {
  registry().clear();
  revocations().recent = [];
}

/** Pour les tests : nombre de flux inscrits. */
export function registeredStreamCount(): number {
  return registry().size;
}
