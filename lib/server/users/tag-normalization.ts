import { isDiscordNumericId } from "@/lib/shared/discord-identity";

/**
 * Un tag Discord tel qu'on le range en base : sans espaces autour, sans le `@`
 * que le client Discord colle devant, et **jamais un identifiant numérique**.
 *
 * Le dernier point est la seule règle qui compte ici. La résolution accepte un
 * identifiant à la place d'un tag (repli quand le bot ne partage aucun serveur
 * avec le joueur), mais un identifiant n'est pas un pseudo : l'écrire dans
 * `discord_pseudo` afficherait un nombre de dix-huit chiffres partout où
 * l'arbitrage attend un nom, et le joueur croirait avoir certifié son tag.
 *
 * Rend `null` pour tout ce qui n'est pas un tag — l'appelant n'a alors rien à
 * certifier, et le dit.
 */
export function normalizeDiscordHandle(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim().replace(/^@/, "");
  if (trimmed.length === 0) return null;
  // Prédicat partagé avec la page de connexion, qui doit annoncer l'exposition
  // exactement quand cette fonction va certifier : deux lectures du même motif
  // divergeraient en une phrase fausse.
  if (isDiscordNumericId(trimmed)) return null;
  return trimmed.slice(0, 64);
}

/**
 * Le BattleTag tel qu'il s'écrit en base, ou `null`.
 *
 * Borné à la largeur de la colonne (64), et `null` s'il est vide : un compte
 * Battle.net sans BattleTag existe, et la colonne dit alors « aucun » plutôt
 * qu'une chaîne vide. Les deux écrivains Blizzard gardent alors la saisie du
 * joueur, marquée tapée (`BLIZZARD_BATTLETAG_SET_SQL`) : jamais vérifiée.
 */
export function normalizeBattletag(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 64);
}
