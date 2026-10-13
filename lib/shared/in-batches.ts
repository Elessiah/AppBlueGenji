/**
 * Exécute `run` sur chaque élément, `size` à la fois au plus : les envois
 * d'un lot partent ensemble, le lot suivant attend qu'ils aient tous abouti.
 *
 * Assez pour ne pas attendre chaque aller-retour réseau l'un après l'autre,
 * assez borné pour ne pas noyer le Raspberry Pi (ni le bot) sous des centaines
 * de requêtes simultanées.
 */
export async function inBatches<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map(run));
  }
}
