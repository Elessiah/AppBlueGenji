import { isChunkLoadError, LAZY_RELOAD_COOLDOWN_MS, reloadAfterChunkError, type OnceLoader } from "@/lib/shared/lazy-component";

/** Délai avant un nouvel essai quand le rechargement de la page n'a pas eu lieu. */
export const SUSPEND_RETRY_MS = 10_000;

/**
 * Nouveaux essais après un fichier manquant, avant d'abandonner : de quoi
 * dépasser l'attente entre deux rechargements (`LAZY_RELOAD_COOLDOWN_MS`), pour
 * qu'un rechargement refusé tout de suite ait encore sa chance.
 */
export const SUSPEND_MAX_RETRIES = Math.ceil(LAZY_RELOAD_COOLDOWN_MS / SUSPEND_RETRY_MS) + 1;

/** Les chargeurs dont le morceau a manqué, avec l'attente partagée jusqu'au nouvel essai. */
const retrying = new WeakMap<object, Promise<void>>();

/** Fichiers manquants d'affilée, par chargeur (remis à zéro au premier succès). */
const failures = new WeakMap<object, number>();

/** L'erreur à remonter au rendu suivant (un bogue, ou trop d'essais) — levée une fois, puis oubliée. */
const surfaced = new WeakMap<object, { error: unknown }>();

/**
 * Suspend le rendu (le `dynamic()` qui l'enveloppe montre son attente) jusqu'à
 * ce que `loader` ait chargé, puis React rend de nouveau. Un fichier manquant
 * (`isChunkLoadError`) programme le rechargement de la page
 * (`reloadAfterChunkError`, comme `orReload`) ; si celui-ci n'a pas lieu
 * (rechargement récent, stockage bloqué, page quittée), un nouvel essai part
 * après {@link SUSPEND_RETRY_MS}, au plus {@link SUSPEND_MAX_RETRIES} fois —
 * jamais une requête par rendu, jamais une attente sans fin. Toute autre erreur
 * est un bogue, que ni un rechargement ni un nouvel essai ne réparent : comme
 * dans `orReload`, elle remonte (levée au rendu suivant, vers la limite
 * d'erreur), sans rechargement ; de même le fichier toujours manquant après le
 * dernier essai. Levée une seule fois : un nouveau montage retente.
 */
export function suspendOn(loader: Pick<OnceLoader<unknown>, "load">): never {
  const failure = surfaced.get(loader);
  if (failure) {
    surfaced.delete(loader);
    throw failure.error;
  }
  const pending = retrying.get(loader);
  if (pending) throw pending;
  throw loader.load().then(
    () => {
      failures.delete(loader);
    },
    (error: unknown) => {
      // Plusieurs rendus suspendus sur le même chargeur reçoivent chacun le
      // rejet : un seul rechargement et un seul minuteur pour tous.
      const already = retrying.get(loader);
      if (already) return already;
      if (surfaced.has(loader)) return;
      const count = (failures.get(loader) ?? 0) + 1;
      if (!isChunkLoadError(error) || count > SUSPEND_MAX_RETRIES) {
        failures.delete(loader);
        surfaced.set(loader, { error });
        return;
      }
      failures.set(loader, count);
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
