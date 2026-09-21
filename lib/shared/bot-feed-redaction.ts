/**
 * Effacement des identifiants Discord dans le flux d'activité du bot.
 *
 * `/bot` est une page de **vitrine**, lisible sans compte, et son bandeau
 * « Flux temps réel » affichait tel quel ce que le bot lui envoie — dont
 * « Code DM envoyé à 100000000000000001 », c'est-à-dire l'identifiant Discord
 * d'un joueur en train de se connecter, avec l'horodatage de sa connexion. Un
 * identifiant Discord n'est pas un secret, mais c'est une **coordonnée** : il
 * suffit à écrire à la personne, et le site n'expose ailleurs le tag d'un
 * joueur qu'une fois certifié, et jamais publiquement
 * (`lib/shared/discord-identity.ts`). Le publier ici défaisait cette règle par
 * la porte de derrière, sur la page la plus ouverte du site.
 *
 * Le filtrage est posé **à la sortie**, dans le relais SSE, et non chez le bot :
 * c'est le seul endroit qui voie tout ce qui part vers un navigateur, il couvre
 * du même geste le **rattrapage** (`getBacklog`, qui rejoue les évènements déjà
 * écrits en base avec leur identifiant) et tout évènement qu'un module du bot
 * ajouterait demain.
 *
 * La règle ne connaît **aucun type d'évènement** : tout *snowflake* est effacé,
 * où qu'il se trouve — dans le texte du résumé comme dans un champ à part —, et
 * un champ dont la valeur *est* un identifiant disparaît entièrement plutôt que
 * de laisser une clé qui n'annonce plus rien.
 */

/**
 * Un identifiant Discord est un entier de 17 à 20 chiffres. Les gardes
 * `(?<!\d)` / `(?!\d)` évitent de rogner un nombre plus long, et la borne basse
 * met hors d'atteinte les nombres que le flux porte légitimement : un
 * horodatage `Date.now()` (13 chiffres), un identifiant de ligne, une date.
 */
const SNOWFLAKE_PATTERN = /(?<!\d)\d{17,20}(?!\d)/g;

/** Ce qui prend la place d'un identifiant effacé, dans une interface en français. */
export const REDACTED_DISCORD_ID = "[masqué]";

/** Vrai si la chaîne entière est un identifiant Discord, aux espaces près. */
export function isDiscordSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value.trim());
}

/** Efface tout identifiant Discord contenu dans un texte libre. */
export function redactSnowflakes(text: string): string {
  return text.replace(SNOWFLAKE_PATTERN, REDACTED_DISCORD_ID);
}

/**
 * Efface les identifiants d'un évènement décodé.
 *
 * Une chaîne qui n'est **qu'** un identifiant (`target`, `userId`, `guildId`…)
 * ne porte rien d'autre : sa clé est retirée. Une chaîne qui en contient un au
 * milieu d'une phrase (`summary`) garde sa phrase.
 */
export function redactFeedPayload(value: unknown): unknown {
  if (typeof value === "string") return redactSnowflakes(value);
  if (Array.isArray(value)) return value.map(redactFeedPayload);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === "string" && isDiscordSnowflake(entry)) continue;
      out[key] = redactFeedPayload(entry);
    }
    return out;
  }
  return value;
}

/**
 * Efface une ligne du protocole SSE.
 *
 * Seules les lignes `data:` portent de la donnée ; `id:` est laissée
 * **intacte**, c'est la clé de reprise (`Last-Event-ID`) et la rogner casserait
 * la reconnexion. Une charge utile qui n'est pas du JSON — le bot n'en produit
 * pas, mais le relais ne le suppose pas — retombe sur l'effacement textuel.
 */
export function redactSseLine(line: string): string {
  if (line.startsWith("id:")) return line;
  if (!line.startsWith("data:")) return redactSnowflakes(line);

  const payload = line.slice("data:".length);
  const trimmed = payload.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return `data: ${JSON.stringify(redactFeedPayload(JSON.parse(trimmed)))}`;
    } catch {
      // Charge utile tronquée ou invalide : on efface quand même.
    }
  }
  return `data:${redactSnowflakes(payload)}`;
}

/** Efface un fragment de flux SSE, ligne à ligne, en préservant les sauts de ligne. */
export function redactSseChunk(chunk: string): string {
  return chunk.split("\n").map(redactSseLine).join("\n");
}
