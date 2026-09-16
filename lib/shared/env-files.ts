/**
 * Quels fichiers d'environnement lire, et dans quel ordre.
 *
 * Next charge lui-même `.env.production` quand il tourne en production, si bien
 * qu'aucune route n'a jamais eu à s'en soucier. Les scripts lancés par `tsx`
 * (`npm run seed`, `npm run backfill:avatars`) ne passent pas par Next : ils
 * écrivaient `import "dotenv/config"`, qui ne connaît **que** `.env`. Sur le
 * serveur, où la configuration vit dans `.env.production` et où `.env` n'existe
 * pas, le script mourait donc sur `Missing required environment variable
 * DB_HOST` — constaté en production le 16/09/2026, sur le script écrit exprès
 * pour y être lancé.
 *
 * L'ordre reproduit celui de Next, décroissant en priorité. Il compte : dotenv
 * **n'écrase jamais** une variable déjà posée, donc le premier fichier qui
 * nomme une clé la fixe, et `process.env` (ce que le shell a exporté) gagne sur
 * tous.
 *
 * `.env.local` est écarté en `test`, comme chez Next : un fichier local est la
 * configuration d'une machine, et une suite de tests qui lirait celle du
 * développeur ne rendrait pas le même résultat chez deux personnes.
 *
 * Module **pur** : il ne lit aucun fichier et ne touche pas à `process.env`, il
 * ne fait que nommer. Le chargement vit dans `lib/server/script-env.ts`.
 *
 * @param nodeEnv Valeur de `NODE_ENV` (`"production"`, `"test"`, `"development"`…).
 * @returns Les chemins relatifs à essayer, du plus prioritaire au moins.
 */
export function envFileOrder(nodeEnv: string): string[] {
  const files = [`.env.${nodeEnv}.local`, ".env.local", `.env.${nodeEnv}`, ".env"];
  return nodeEnv === "test" ? files.filter((file) => !file.endsWith(".local")) : files;
}
