/**
 * Garde d'un envoi : un seul à la fois (`docs/features/BUSY_BUTTONS.md`).
 *
 * Les boutons restent focalisables pendant une requête (`aria-disabled` +
 * `aria-busy`, jamais `disabled` natif) : rien n'empêche donc un second clic,
 * une Entrée répétée ou un double clic parti **avant** que l'état « occupé »
 * soit rendu. Le drapeau `flag` (un `useRef`) se pose **avant** la première
 * attente et se lève dans `finally`, quoi qu'il arrive (refus, exception,
 * retour anticipé de la tâche) : aucun bouton ne reste bloqué.
 *
 * Rend le résultat de la tâche, ou `undefined` si un envoi était déjà en cours
 * (la tâche n'est alors pas lancée). Module **pur**.
 */
export type BusyFlag = { current: boolean };

export async function runExclusive<T>(
  flag: BusyFlag,
  setBusy: (busy: boolean) => void,
  task: () => Promise<T>,
): Promise<T | undefined> {
  if (flag.current) return undefined;
  flag.current = true;
  setBusy(true);
  try {
    return await task();
  } finally {
    flag.current = false;
    setBusy(false);
  }
}
