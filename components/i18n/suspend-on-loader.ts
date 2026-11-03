import { reloadAfterChunkError, type OnceLoader } from "@/lib/shared/lazy-component";

/** Les chargeurs dont le morceau a manqué : la page se recharge, rien ne repart d'ici là. */
const failed = new WeakSet<object>();
/** Une attente qui ne se résout jamais : la page se recharge avant. */
const UNTIL_RELOAD: Promise<never> = new Promise<never>(() => undefined);

/**
 * Suspend le rendu (le `dynamic()` qui l'enveloppe montre son attente) jusqu'à
 * ce que `loader` ait chargé, puis React rend de nouveau. Un échec programme le
 * rechargement de la page (`reloadAfterChunkError`, comme `orReload`) et laisse
 * l'écran en attente d'ici là, sans relancer la requête à chaque rendu.
 */
export function suspendOn(loader: Pick<OnceLoader<unknown>, "load">): never {
  if (failed.has(loader)) throw UNTIL_RELOAD;
  throw loader.load().then(
    () => undefined,
    () => {
      failed.add(loader);
      reloadAfterChunkError();
    },
  );
}
