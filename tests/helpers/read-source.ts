import { readdirSync, readFileSync, statSync } from "node:fs";
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

/** Fichiers `.ts` d'un dossier, sous-dossiers compris, dans l'ordre alphabétique. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.name.endsWith(".ts") ? [path] : [];
    });
}

/**
 * Lit plusieurs sources comme une seule — fichiers ou dossiers (tous leurs
 * `.ts`), dans l'ordre donné. Sert aux tests qui relisent un module découpé en
 * plusieurs fichiers (`lib/server/database.ts` et `lib/server/database/`, par
 * exemple) : ils cherchent une instruction sans avoir à savoir où elle vit.
 */
export function readSources(...paths: string[]): string {
  return paths
    .flatMap((path) => {
      const absolute = isAbsolute(path) ? path : join(ROOT, path);
      return statSync(absolute).isDirectory() ? sourceFiles(absolute) : [absolute];
    })
    .map((file) => readSource(file))
    .join("\n");
}

/**
 * Le schéma tel qu'il est joué : le pool (`lib/server/database.ts`), puis les
 * modules de `lib/server/database/` **dans l'ordre d'exécution** de
 * `runMigrations` — les `CREATE TABLE` par domaine, les migrations, les
 * rattrapages et le filet. Les tests de schéma découpent ce texte entre deux
 * repères ; l'ordre est donc celui de la passe, pas celui de l'alphabet.
 */
const DATABASE_SOURCES = [
  "lib/server/database.ts",
  "lib/server/database/report-schema-failure.ts",
  "lib/server/database/declared-tables.ts",
  "lib/server/database/schema/accounts.ts",
  "lib/server/database/schema/teams.ts",
  "lib/server/database/schema/tournaments.ts",
  "lib/server/database/schema/standings.ts",
  "lib/server/database/schema/phases.ts",
  "lib/server/database/schema/notifications.ts",
  "lib/server/database/schema/showcase.ts",
  "lib/server/database/schema/compliance.ts",
  "lib/server/database/recent-schema-changes.ts",
  "lib/server/database/data-migrations.ts",
  "lib/server/database/catch-ups.ts",
  "lib/server/database/run-migrations.ts",
  "lib/server/database/schema-check.ts",
];

/** Toute la couche schéma lue comme un seul texte (voir `DATABASE_SOURCES`). */
export function readDatabaseSource(): string {
  return readSources(...DATABASE_SOURCES);
}
