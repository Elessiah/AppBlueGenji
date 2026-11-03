import { isChunkLoadError, reloadAfterChunkError, type OnceLoader } from "@/lib/shared/lazy-component";

/** Délai avant un nouvel essai quand le rechargement de la page n'a pas eu lieu. */
export const SUSPEND_RETRY_MS = 10_000;

/** Les chargeurs dont le morceau a manqué, avec l'attente partagée jusqu'au nouvel essai. */
const retrying = new WeakMap<object, Promise<void>>();

/** Les chargeurs dont le module lui-même a levé une erreur (un bogue) : elle remonte au rendu suivant. */
const broken = new WeakMap<object, { error: unknown }>();

/**
 * Suspend le rendu (le `dynamic()` qui l'enveloppe montre son attente) jusqu'à
 * ce que `loader` ait chargé, puis React rend de nouveau. Un fichier manquant
 * (`isChunkLoadError`) programme le rechargement de la page
 * (`reloadAfterChunkError`, comme `orReload`) ; si celui-ci n'a pas lieu
 * (rechargement récent, stockage bloqué, page quittée), un nouvel essai part
 * après {@link SUSPEND_RETRY_MS} — jamais une requête par rendu, jamais une
 * attente sans fin. Toute autre erreur est un bogue, que ni un rechargement ni
 * un nouvel essai ne réparent : comme dans `orReload`, elle remonte (levée au
 * rendu suivant, vers la limite d'erreur), sans rechargement.
 */
export function suspendOn(loader: Pick<OnceLoader<unknown>, "load">): never {
  const failure = broken.get(loader);
  if (failure) throw failure.error;
  const pending = retrying.get(loader);
  if (pending) throw pending;
  throw loader.load().then(
    () => undefined,
    (error: unknown) => {
      if (!isChunkLoadError(error)) {
        broken.set(loader, { error });
        return;
      }
      // Plusieurs rendus suspendus sur le même chargeur reçoivent chacun le
      // rejet : un seul rechargement et un seul minuteur pour tous.
      const already = retrying.get(loader);
      if (already) return already;
      reloadAfterChunkError();
      const retry = new Promise<void>((resolve) => {
        setTimeout(() => {
          retrying.delete(loader);
          resolve();
        }, SUSPEND_RETRY_MS);
      });
      retrying.set(loader, retry);
      return retry;
    },
  );
}
