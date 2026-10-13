/**
 * Exécute `run` sur chaque élément, `size` à la fois au plus : une réserve de
 * `size` exécutants prend l'élément suivant dès qu'il en termine un — un envoi
 * lent (un bot qui attend son délai) n'immobilise pas les autres places.
 *
 * Assez pour ne pas attendre chaque aller-retour réseau l'un après l'autre,
 * assez borné pour ne pas noyer le Raspberry Pi (ni le bot) sous des centaines
 * de requêtes simultanées. Un élément en échec ne retient pas les autres : tous
 * passent, puis la première erreur est levée — aucun exécutant n'est laissé
 * en cours sans que personne ne l'attende.
 */
export async function inBatches<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await run(item);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(size, 1), items.length) }, worker));
  if (failures.length > 0) throw failures[0];
}
