/**
 * Issue d'une relecture de fiche lancée par un geste : `true` si elle a eu lieu,
 * `false` si elle a échoué. Une relecture en arrière-plan qui échoue laisse
 * l'écran sur l'état d'avant le geste sans rien dire ; l'appelant le signale.
 *
 * `onReload` rend `false` (échec), `true` ou rien (réussi), ou rejette (échec) :
 * un seul endroit décide de ce que ces trois formes veulent dire.
 */
export async function reloadSucceeded(onReload: () => Promise<boolean | void> | boolean | void): Promise<boolean> {
  try {
    return (await onReload()) !== false;
  } catch {
    return false;
  }
}
