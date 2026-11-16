/**
 * Borne des noms essayés par la question des liens (`POST
 * /api/players/profileless`, revue sécurité EF-65, cycles 2 et 3).
 *
 * La route ne dit « sans fiche » que d'un compte nommé de son nom
 * d'aujourd'hui. Or le pseudo d'un compte supprimé est tiré d'une liste
 * publique de mille (`lib/shared/anonymous-pseudos.ts`) : sans borne, essayer
 * pour un identifiant les pseudos d'emprunt possibles dirait s'il est celui
 * d'un compte supprimé (D86).
 *
 * La borne est tenue **par compte demandé, tous visiteurs confondus** — et non
 * par visiteur : multiplier les comptes ou les sessions n'ajoute aucun essai,
 * et le serveur ne garde rien de ce qu'un visiteur a vu. Pour chaque compte de
 * la liste des comptes sans fiche, au plus {@link PROFILELESS_WRONG_NAMES_PER_ACCOUNT}
 * noms **faux** distincts sont jugés par {@link PROFILELESS_GUESS_WINDOW_MS} ;
 * au-delà, un nom nouveau n'est **pas jugé** : la réponse le tait comme un
 * compte qui a sa fiche. Un nom déjà jugé l'est de nouveau sans rien compter,
 * et un nom juste, une fois jugé, le reste tant qu'il est le nom du compte : la
 * page qui montre ce joueur continue de le rendre en texte après la borne.
 *
 * Un compte hors de la liste n'a pas de borne : sa réponse est « a sa fiche »
 * quel que soit le nom — l'épuiser ne dirait rien. La mémoire (d'un seul
 * processus, le site tourne en un processus pm2) ne suit donc que les comptes
 * de la liste, quelques noms chacun : elle ne croît pas avec les identifiants
 * envoyés. Un redémarrage la remet à zéro (au plus quelques essais de plus par
 * déploiement). Qui épuise la borne d'un compte avant toute page qui le montre
 * ne fait que laisser son nom en lien (vers la fiche 404) jusqu'à la fenêtre
 * suivante — sans rien apprendre.
 */

/** Noms faux distincts jugés par compte demandé, dans une fenêtre, tous visiteurs confondus. */
export const PROFILELESS_WRONG_NAMES_PER_ACCOUNT = 4;

/** Durée d'une fenêtre, par compte demandé. */
export const PROFILELESS_GUESS_WINDOW_MS = 24 * 60 * 60_000;

/** Comptes suivis au-delà de la liste avant de faire le ménage (comptes sortis de la liste). */
export const PROFILELESS_PRUNE_SLACK = 256;

type AccountBudget = { resetAt: number; wrong: Set<string>; known: Set<string> };

const budgets = new Map<number, AccountBudget>();

/**
 * Ce nom (forme comparée) de ce compte est-il jugé ? `names` : la liste des
 * comptes sans fiche et de leurs noms d'aujourd'hui. Hors liste : `true`
 * (rien à borner, la réponse y est « a sa fiche »).
 */
export function admitProfilelessName(
  id: number,
  key: string,
  names: ReadonlyMap<number, ReadonlySet<string>>,
  now: number = Date.now(),
): boolean {
  const current = names.get(id);
  if (current === undefined) return true;
  if (budgets.size > names.size + PROFILELESS_PRUNE_SLACK) {
    for (const tracked of budgets.keys()) if (!names.has(tracked)) budgets.delete(tracked);
  }
  let budget = budgets.get(id);
  if (budget === undefined) {
    budget = { resetAt: now + PROFILELESS_GUESS_WINDOW_MS, wrong: new Set(), known: new Set() };
    budgets.set(id, budget);
  } else if (budget.resetAt <= now) {
    budget.wrong.clear();
    budget.resetAt = now + PROFILELESS_GUESS_WINDOW_MS;
  }
  // Un nom juste d'hier qui ne l'est plus (renommage) ne se garde pas.
  for (const known of budget.known) if (!current.has(known)) budget.known.delete(known);
  if (budget.known.has(key) || budget.wrong.has(key)) return true;
  if (budget.wrong.size >= PROFILELESS_WRONG_NAMES_PER_ACCOUNT) return false;
  (current.has(key) ? budget.known : budget.wrong).add(key);
  return true;
}

/** Comptes suivis (tests). */
export function trackedProfilelessBudgetsForTests(): number {
  return budgets.size;
}

/** Tests : oublie toutes les bornes. */
export function resetProfilelessGuessesForTests(): void {
  budgets.clear();
}
