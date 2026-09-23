import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const ROOT = join(__dirname, "..", "..");

/**
 * Lit un fichier source du dépôt, **fins de ligne ramenées à `\n`**.
 *
 * Un poste Windows extrait les fichiers en CRLF (`core.autocrlf`) quand la CI
 * les lit en LF : un test qui ancre un motif sur `\n\}\n` passait sur l'une et
 * échouait sur l'autre, pour les mêmes octets versionnés. Tout test qui balaie
 * une source avec des motifs multilignes passe par ici.
 */
export function readSource(path: string): string {
  return readFileSync(isAbsolute(path) ? path : join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
}
