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

type GlobalWithRegistry = typeof globalThis & {
  __bgSessionStreams?: Set<Entry>;
};

function registry(): Set<Entry> {
  const globalRef = globalThis as GlobalWithRegistry;
  if (!globalRef.__bgSessionStreams) globalRef.__bgSessionStreams = new Set();
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
  return closeMatching((entry) => entry.tokenHash === tokenHash);
}

/** Pour les tests : nombre de flux inscrits. */
export function registeredStreamCount(): number {
  return registry().size;
}
