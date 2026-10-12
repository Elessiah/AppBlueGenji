/**
 * Envois d'un champ qui reste utilisable pendant qu'il enregistre (langue du
 * compte, lot 9-3) : un choix fait pendant un envoi est mis de côté, puis
 * envoyé à la suite — jamais perdu, jamais en parallèle.
 *
 * Logique pure, testée sans navigateur (`tests/app/profile-queued-saves.test.ts`).
 */
export type QueuedSavesOutcome<V> = {
  /** Valeur retenue par le serveur : le dernier envoi réussi (le départ sinon). */
  saved: V;
  /** Au moins un envoi a réussi. */
  stored: boolean;
  /** Le **dernier** choix du joueur est celui retenu : seul cas où dire « enregistré ». */
  confirmed: boolean;
  /**
   * Le champ montre le dernier choix du joueur, et c'est la valeur retenue —
   * même si aucun envoi n'a réussi (retour au départ pendant un envoi qui
   * échoue) : un refus rattaché au champ ne décrit plus rien.
   */
  upToDate: boolean;
};

export async function runQueuedSaves<V>(options: {
  /** Valeur enregistrée avant le geste. */
  start: V;
  /** Premier choix, différent de `start`. */
  first: V;
  /** Un envoi : `true` s'il a réussi. */
  put: (value: V) => Promise<boolean>;
  /** Le choix mis de côté pendant l'envoi (et l'oublie), `null` s'il n'y en a pas. */
  takeQueued: () => V | null;
  /** Affiche une valeur dans le champ. */
  show: (value: V) => void;
}): Promise<QueuedSavesOutcome<V>> {
  const { start, first, put, takeQueued, show } = options;
  let saved = start;
  let stored = false;
  let latest = first;
  let next: V | null = first;
  while (next !== null) {
    show(next);
    if (await put(next)) {
      saved = next;
      stored = true;
    }
    const after = takeQueued();
    if (after !== null) latest = after;
    next = after !== null && after !== saved ? after : null;
  }
  show(saved);
  return { saved, stored, confirmed: stored && saved === latest, upToDate: saved === latest };
}
