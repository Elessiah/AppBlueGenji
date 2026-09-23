import { existsSync } from "node:fs";
import { config } from "dotenv";
import { envFileOrder, missingNodeEnvNotice, PRODUCTION_ENV_FILES } from "@/lib/shared/env-files";

/**
 * Charge l'environnement d'un script `tsx`, comme Next le ferait.
 *
 * À importer **en premier**, à la place de `dotenv/config` : le chargement est
 * un effet de bord du module, et non un appel à écrire après les imports. Ce
 * n'est pas du zèle — `lib/server/bot-docs.ts` lit `process.env.BOT_DOCS_PATH`
 * au niveau module, donc dès qu'il est importé ; un appel placé après les
 * imports s'exécuterait trop tard pour lui.
 *
 *     import "./script-env";
 *
 * L'ordre des fichiers est décidé par `lib/shared/env-files.ts`, qui est pur et
 * testé. Ici il ne reste que la lecture : dotenv ignore sans bruit un fichier
 * absent, et n'écrase jamais une variable déjà posée — c'est ce qui rend la
 * liste ordonnée suffisante, sans avoir à savoir lequel existe.
 *
 * `NODE_ENV` absent vaut `development`, comme chez Next. Si c'est la raison
 * pour laquelle `.env.production` ne sera pas lu, on le dit avant que le script
 * ne meure sur une variable manquante (`missingNodeEnvNotice`).
 */
export function loadScriptEnv(nodeEnv: string | undefined = process.env.NODE_ENV): void {
  const files = envFileOrder(nodeEnv || "development");
  for (const path of files) {
    config({ path, quiet: true });
  }

  const candidates = [...new Set([...files, ...PRODUCTION_ENV_FILES])];
  const notice = missingNodeEnvNotice(
    nodeEnv,
    candidates.filter((path) => existsSync(path)),
    process.env.npm_lifecycle_event,
  );
  if (notice) console.warn(notice);
}

loadScriptEnv();
