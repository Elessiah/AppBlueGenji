/**
 * Borne des noms essayés par la question des liens (`POST
 * /api/players/profileless`, revue sécurité EF-65, cycle 2).
 *
 * La route ne dit « sans fiche » que d'un compte nommé de son nom
 * d'aujourd'hui. Or le pseudo d'un compte supprimé est tiré d'une liste
 * publique de mille (`lib/shared/anonymous-pseudos.ts`) : sans borne, essayer
 * pour chaque identifiant les pseudos d'emprunt déjà portés rebâtirait la liste
 * des comptes supprimés (D86) en quelques centaines de questions. Une page ne
 * montre un compte que sous un ou deux noms (pseudo, nom d'entrée solo) : au
 * plus {@link PROFILELESS_NAMES_PER_ACCOUNT} noms distincts par compte et par
 * visiteur sur {@link PROFILELESS_GUESS_WINDOW_MS}, et au plus
 * {@link PROFILELESS_ACCOUNTS_PER_VIEWER} comptes. Au-delà, le couple n'est
 * **pas jugé** : la réponse le tait comme un compte qui a sa fiche — la borne
 * s'applique à tout identifiant, supprimé ou non, et ne dit donc rien.
 *
 * Mémoire d'un seul processus (le site tourne en un processus pm2), bornée à
 * {@link PROFILELESS_GUESS_MAX_PAIRS} couples : au-delà, les fenêtres échues
 * puis les plus anciennes sont oubliées.
 */
import { profilelessNameKey } from "./profileless-players";
import type { ProfilelessLookupEntry } from "@/lib/shared/profileless-lookup";

/** Noms distincts jugés par compte et par visiteur, dans une fenêtre. */
export const PROFILELESS_NAMES_PER_ACCOUNT = 3;

/** Comptes distincts jugés par visiteur, dans une fenêtre (bien plus qu'une journée de pages). */
export const PROFILELESS_ACCOUNTS_PER_VIEWER = 3_000;

/** Durée d'une fenêtre, par visiteur. */
export const PROFILELESS_GUESS_WINDOW_MS = 24 * 60 * 60_000;

/** Couples gardés au plus, tous visiteurs confondus. */
export const PROFILELESS_GUESS_MAX_PAIRS = 200_000;

type ViewerWindow = { resetAt: number; accounts: Map<number, Set<string>>; pairs: number };

const viewers = new Map<number, ViewerWindow>();
let totalPairs = 0;

function forget(viewerId: number, window: ViewerWindow): void {
  viewers.delete(viewerId);
  totalPairs -= window.pairs;
}

/**
 * Fait de la place : les fenêtres échues d'abord, puis les plus anciennes —
 * jamais celle du visiteur servi (`keep`), dont le décompte doit tenir.
 */
function makeRoom(now: number, keep: number): void {
  if (totalPairs < PROFILELESS_GUESS_MAX_PAIRS) return;
  for (const [viewerId, window] of viewers) {
    if (viewerId !== keep && window.resetAt <= now) forget(viewerId, window);
  }
  for (const [viewerId, window] of viewers) {
    if (totalPairs < PROFILELESS_GUESS_MAX_PAIRS) break;
    if (viewerId !== keep) forget(viewerId, window);
  }
}

/**
 * Les couples `{ id, name }` de ce visiteur qui seront jugés, dans leur ordre ;
 * les autres sont tus (aucun refus). Un couple déjà jugé dans la fenêtre l'est
 * de nouveau sans rien compter.
 */
export function admitProfilelessGuesses(
  viewerId: number,
  players: readonly ProfilelessLookupEntry[],
  now: number = Date.now(),
): ProfilelessLookupEntry[] {
  let window = viewers.get(viewerId);
  if (window !== undefined && window.resetAt <= now) {
    forget(viewerId, window);
    window = undefined;
  }
  if (window === undefined) {
    makeRoom(now, viewerId);
    window = { resetAt: now + PROFILELESS_GUESS_WINDOW_MS, accounts: new Map(), pairs: 0 };
    viewers.set(viewerId, window);
  }
  const admitted: ProfilelessLookupEntry[] = [];
  for (const player of players) {
    const key = profilelessNameKey(player.name);
    let names = window.accounts.get(player.id);
    if (names?.has(key)) {
      admitted.push(player);
      continue;
    }
    if (names === undefined) {
      if (window.accounts.size >= PROFILELESS_ACCOUNTS_PER_VIEWER) continue;
      names = new Set();
      window.accounts.set(player.id, names);
    }
    if (names.size >= PROFILELESS_NAMES_PER_ACCOUNT) continue;
    makeRoom(now, viewerId);
    names.add(key);
    window.pairs += 1;
    totalPairs += 1;
    admitted.push(player);
  }
  return admitted;
}

/** Tests : oublie toutes les fenêtres. */
export function resetProfilelessGuessesForTests(): void {
  viewers.clear();
  totalPairs = 0;
}
