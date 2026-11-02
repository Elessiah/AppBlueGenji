/**
 * Regroupement des lignes du journal Discord (`docs/features/LOG_BATCHING.md`).
 *
 * Module pur : les constantes du regroupement et la mise en messages d'un lot.
 * Le minuteur et l'envoi vivent côté serveur (`lib/server/bot-log-batcher.ts`).
 */

/** Silence attendu après la dernière ligne d'un lot avant de l'envoyer (5 min). */
export const BOT_LOG_BATCH_WINDOW_MS = 5 * 60 * 1000;

/**
 * Âge maximal d'un lot : il part au plus tard 10 min après sa première ligne,
 * quoi que dise le silence (un filet de lignes espacées ne le repousse pas).
 */
export const BOT_LOG_BATCH_MAX_AGE_MS = 10 * 60 * 1000;

/** Lignes au-delà desquelles un lot part sans attendre la fin du silence. */
export const BOT_LOG_BATCH_MAX_LINES = 5;

/**
 * Longueur maximale d'un message envoyé au bot. Discord refuse au-delà de
 * 2 000 caractères, et le bot préfixe chaque message de `[AppBlueGenji] `
 * (15 caractères) : la marge couvre ce préfixe.
 */
export const BOT_LOG_MESSAGE_MAX_CHARS = 1900;

/** Marque de citation de `discordQuote` : une rangée qui la porte est un texte d'utilisateur. */
const QUOTE_PREFIX = "> ";

/** Barre oblique inverse, qui échappe le caractère qu'elle suit. */
const BACKSLASH = String.fromCodePoint(92);

/** Vrai quand `text` finit par une barre oblique inverse qui échappe encore le caractère suivant. */
function endsWithOpenEscape(text: string): boolean {
  let count = 0;
  for (let index = text.length - 1; index >= 0 && text[index] === BACKSLASH; index -= 1) count += 1;
  return count % 2 === 1;
}

/**
 * Coupe une rangée trop longue en morceaux d'au plus `maxChars`, sans couper un
 * caractère **ni une séquence d'échappement** : la barre oblique inverse qui
 * neutralise `<`, `*` ou `` ` `` (`discordInline`, `discordQuote`) reste collée
 * au caractère qu'elle échappe — sinon le morceau suivant, qui ouvre un nouveau
 * message, commencerait par un `<@&rôle>` actif. Une rangée citée (`> `) reste
 * citée dans chacun de ses morceaux.
 */
function splitLongRow(row: string, maxChars: number): string[] {
  const prefix = row.startsWith(QUOTE_PREFIX) && maxChars > QUOTE_PREFIX.length + 2 ? QUOTE_PREFIX : "";
  const pieces: string[] = [];
  let current = "";
  for (const char of row) {
    if (current.length + char.length > maxChars) {
      let carry = "";
      if (endsWithOpenEscape(current) && current.length > prefix.length + 1) {
        carry = BACKSLASH;
        current = current.slice(0, -1);
      }
      pieces.push(current);
      current = prefix + carry;
    }
    current += char;
  }
  if (current && current !== prefix) pieces.push(current);
  return pieces;
}

/**
 * Coupe une entrée trop longue : d'abord entre ses rangées (le relevé des
 * arbitres, un texte cité sur plusieurs lignes), qui se regroupent tant que la
 * limite le permet ; une rangée qui dépasse seule la limite passe par
 * {@link splitLongRow}.
 */
function splitLongEntry(entry: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const row of entry.split("\n")) {
    const parts = row.length <= maxChars ? [row] : splitLongRow(row, maxChars);
    for (const part of parts) {
      if (!current) current = part;
      else if (current.length + 1 + part.length <= maxChars) current += `\n${part}`;
      else {
        pieces.push(current);
        current = part;
      }
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Rangée de tête d'un message qui poursuit une ligne coupée. Le bot préfixe
 * chaque message de `[AppBlueGenji] ` : sans cette rangée, la suite d'une ligne
 * ouvrirait le message juste après ce préfixe, et un texte d'utilisateur — une
 * rangée citée de `discordQuote`, dont la marque `> ` ne serait plus en début
 * de ligne, ou le milieu d'un nom — s'y lirait comme une ligne écrite par le site.
 */
export const BOT_LOG_CONTINUATION_LEAD = "(suite)";

/**
 * Met les lignes d'un lot en messages : dans l'ordre, une ligne par rangée,
 * autant de lignes par message que la limite le permet. Une ligne n'est coupée
 * que si elle dépasse seule la limite — entre ses rangées d'abord, jamais au
 * milieu d'une séquence d'échappement — et chaque message qui en poursuit une
 * s'ouvre sur {@link BOT_LOG_CONTINUATION_LEAD}. Les lignes vides sont ignorées.
 */
export function packBotLogLines(lines: readonly string[], maxChars: number = BOT_LOG_MESSAGE_MAX_CHARS): string[] {
  const limit = Math.max(2, Math.floor(maxChars));
  // La rangée de tête ne se pose que si la limite lui laisse la place (toujours
  // en production) ; les morceaux sont alors taillés pour la recevoir.
  const leadRoom = limit - BOT_LOG_CONTINUATION_LEAD.length - 1;
  const withLead = leadRoom >= 16;
  const pieceLimit = withLead ? leadRoom : limit;
  const messages: string[] = [];
  let current = "";
  const open = (piece: string, continued: boolean) => {
    current = continued && withLead ? `${BOT_LOG_CONTINUATION_LEAD}\n${piece}` : piece;
  };
  const push = (piece: string, continued: boolean) => {
    if (!current) {
      open(piece, continued);
    } else if (current.length + 1 + piece.length <= limit) {
      current += `\n${piece}`;
    } else {
      messages.push(current);
      open(piece, continued);
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length <= limit) {
      push(line, false);
      continue;
    }
    splitLongEntry(line, pieceLimit).forEach((piece, index) => push(piece, index > 0));
  }
  if (current) messages.push(current);
  return messages;
}

/** Clé d'un lot : le salon de destination, puis le tournoi quand la ligne en relève. */
export function botLogBatchKey(channel: string, tournamentId?: number | null): string {
  return typeof tournamentId === "number" && Number.isInteger(tournamentId) && tournamentId > 0
    ? `${channel}:tournament:${tournamentId}`
    : `${channel}:global`;
}
