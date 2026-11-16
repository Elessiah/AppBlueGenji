/**
 * Borne des noms essayés par la question des liens (`POST
 * /api/players/profileless`, revue sécurité EF-65, cycles 2 à 4).
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
 * le nom juste ne compte pas. Borne atteinte, **plus aucun nom** de ce compte
 * n'est jugé jusqu'à la fenêtre suivante, le nom juste compris (cycle 4 : un
 * nom juste encore jugé après la borne laissait balayer les mille pseudos
 * jusqu'à lui) : la réponse le tait comme un compte qui a sa fiche. Qui épuise
 * la borne d'un compte ne fait donc que laisser son nom en lien (vers la fiche
 * 404) jusqu'à la fenêtre suivante, sans rien apprendre ; c'est le prix,
 * cosmétique, de la borne.
 *
 * Un compte hors de la liste n'a pas de borne : sa réponse est « a sa fiche »
 * quel que soit le nom. La mémoire (d'un seul processus, le site tourne en un
 * processus pm2) ne suit que les comptes de la liste, au plus quatre noms
 * chacun, et **jamais en clair** : chaque nom faux n'y est qu'une empreinte
 * HMAC sous une clé tirée au démarrage et jamais écrite — l'ancien pseudo d'un
 * compte supprimé, envoyé par un onglet resté ouvert, n'y reste pas lisible.
 * Chaque nouvelle liste (échéance ou invalidation à une suppression) oublie
 * les comptes qui en sont sortis et les fenêtres échues. Un redémarrage remet
 * tout à zéro (au plus quatre essais de plus par déploiement).
 *
 * L'empreinte se calcule pour chaque couple, listé ou non : le travail d'une
 * question ne dépend du compte demandé que de quelques accès à une table.
 */
import { createHmac, randomBytes } from "node:crypto";

/** Noms faux distincts jugés par compte demandé, dans une fenêtre, tous visiteurs confondus. */
export const PROFILELESS_WRONG_NAMES_PER_ACCOUNT = 4;

/** Durée d'une fenêtre, par compte demandé. */
export const PROFILELESS_GUESS_WINDOW_MS = 24 * 60 * 60_000;

type AccountBudget = { resetAt: number; wrong: Set<string> };

const budgets = new Map<number, AccountBudget>();

/** Clé des empreintes : propre au processus, jamais écrite ni journalisée. */
const digestKey = randomBytes(32);

/** Liste sur laquelle le ménage a été fait en dernier. */
let prunedFor: ReadonlyMap<number, ReadonlySet<string>> | null = null;

function nameDigest(id: number, key: string): string {
  return createHmac("sha256", digestKey).update(`${id}\u0000${key}`).digest("base64url");
}

function pruneBudgets(names: ReadonlyMap<number, ReadonlySet<string>>, now: number): void {
  for (const [id, budget] of budgets) {
    if (!names.has(id) || budget.resetAt <= now) budgets.delete(id);
  }
  prunedFor = names;
}

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
  const digest = nameDigest(id, key);
  if (names !== prunedFor) pruneBudgets(names, now);
  const current = names.get(id);
  if (current === undefined) return true;
  let budget = budgets.get(id);
  if (budget === undefined) {
    budget = { resetAt: now + PROFILELESS_GUESS_WINDOW_MS, wrong: new Set() };
    budgets.set(id, budget);
  } else if (budget.resetAt <= now) {
    budget.wrong.clear();
    budget.resetAt = now + PROFILELESS_GUESS_WINDOW_MS;
  }
  if (budget.wrong.size >= PROFILELESS_WRONG_NAMES_PER_ACCOUNT) return false;
  if (!current.has(key)) budget.wrong.add(digest);
  return true;
}

/** Comptes suivis (tests). */
export function trackedProfilelessBudgetsForTests(): number {
  return budgets.size;
}

/** Noms faux retenus, tels que gardés en mémoire (tests). */
export function storedProfilelessWrongNamesForTests(id: number): string[] {
  return [...(budgets.get(id)?.wrong ?? [])];
}

/** Tests : oublie toutes les bornes. */
export function resetProfilelessGuessesForTests(): void {
  budgets.clear();
  prunedFor = null;
}
