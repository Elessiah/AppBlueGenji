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

/**
 * Fichiers qui ne sont lus qu'en production, et qu'un `NODE_ENV` absent ignore
 * — dérivés d'`envFileOrder`, seule règle de nommage du module.
 */
export const PRODUCTION_ENV_FILES: readonly string[] = envFileOrder("production").filter(
  (file) => !envFileOrder("development").includes(file),
);

/**
 * Phrase à afficher quand un script va manquer la configuration de production
 * faute de `NODE_ENV`, ou `null` s'il n'y a rien à dire.
 *
 * Le shell du serveur n'exporte pas `NODE_ENV` (seul pm2 le pose), si bien que
 * `npm run backfill:avatars` y retombait sur `development`, ne lisait pas
 * `.env.production` et mourait sur `Missing required environment variable
 * DB_HOST` — un message qui ne dit rien de la cause. On **n'en déduit pas**
 * pour autant la production : un poste de développement peut garder un
 * `.env.production`, et un script qui choisirait seul la base de production
 * est bien pire qu'un script qui s'arrête. On nomme la cause et le geste.
 *
 * Ne parle que lorsque le cas est sans ambiguïté : `NODE_ENV` absent, un
 * fichier de production présent, **aucun** des fichiers que l'on s'apprête à
 * lire, et une configuration toujours manquante — un shell qui exporte déjà la
 * base n'a rien à relancer.
 *
 * @param nodeEnv Valeur brute de `NODE_ENV`, `undefined` ou vide si non posée.
 * @param existingFiles Chemins (parmi ceux d'`envFileOrder` et de
 *   `PRODUCTION_ENV_FILES`) qui existent sur le disque.
 * @param scriptName Nom du script npm lancé (`npm_lifecycle_event`), pour
 *   écrire la commande à relancer telle quelle.
 * @param configured `true` si la configuration est déjà là malgré tout
 *   (`DB_HOST` exporté par le shell) : il n'y a alors rien à signaler.
 */
export function missingNodeEnvNotice(
  nodeEnv: string | undefined,
  existingFiles: readonly string[],
  scriptName?: string,
  configured = false,
): string | null {
  if (nodeEnv || configured) return null;
  const present = new Set(existingFiles);
  const productionFile = PRODUCTION_ENV_FILES.find((file) => present.has(file));
  if (!productionFile) return null;
  if (envFileOrder("development").some((file) => present.has(file))) return null;
  const command = `NODE_ENV=production npm run ${scriptName || "<script>"}`;
  return `⚠ NODE_ENV n'est pas défini : ${productionFile} n'a pas été lu. Sur le serveur, relancer avec : ${command}`;
}
