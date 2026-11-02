/**
 * Regroupement des lignes du journal Discord (`docs/features/LOG_BATCHING.md`).
 *
 * Module pur : les constantes du regroupement et la mise en messages d'un lot.
 * Le minuteur et l'envoi vivent côté serveur (`lib/server/bot-log-batcher.ts`).
 */

/** Silence attendu après la dernière ligne d'un lot avant de l'envoyer (5 min). */
export const BOT_LOG_BATCH_WINDOW_MS = 5 * 60 * 1000;

/** Lignes au-delà desquelles un lot part sans attendre la fin du silence. */
export const BOT_LOG_BATCH_MAX_LINES = 5;

/**
 * Longueur maximale d'un message envoyé au bot. Discord refuse au-delà de
 * 2 000 caractères, et le bot préfixe chaque message de `[AppBlueGenji] `
 * (15 caractères) : la marge couvre ce préfixe.
 */
export const BOT_LOG_MESSAGE_MAX_CHARS = 1900;

/** Découpe une ligne trop longue en morceaux d'au plus `maxChars`, sans couper un caractère. */
function splitLongLine(line: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const char of line) {
    if (current.length + char.length > maxChars) {
      pieces.push(current);
      current = "";
    }
    current += char;
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Met les lignes d'un lot en messages : dans l'ordre, une ligne par rangée,
 * autant de lignes par message que la limite le permet. Une ligne n'est coupée
 * que si elle dépasse seule la limite. Les lignes vides sont ignorées.
 */
export function packBotLogLines(lines: readonly string[], maxChars: number = BOT_LOG_MESSAGE_MAX_CHARS): string[] {
  const limit = Math.max(2, Math.floor(maxChars));
  const messages: string[] = [];
  let current = "";
  const push = (piece: string) => {
    if (!current) {
      current = piece;
    } else if (current.length + 1 + piece.length <= limit) {
      current += `\n${piece}`;
    } else {
      messages.push(current);
      current = piece;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length <= limit) push(line);
    else for (const piece of splitLongLine(line, limit)) push(piece);
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
