import { isSchemaNoOpError } from "@/lib/server/mysql-errors";

/**
 * Ce qu'on fait d'une migration qui a échoué : la **dire**, jamais l'avaler, et
 * ne jamais faire tomber le démarrage avec elle.
 *
 * Les trois issues possibles ne se valent pas, et le choix s'est fait contre les
 * deux autres :
 *
 * - **Avaler** (`catch {}`) laisse le schéma en arrière du code sans qu'aucune
 *   trace n'existe. Pour le retrait de l'adresse e-mail, c'est pire qu'un
 *   schéma en retard : les adresses restent, et plus rien ne les efface.
 * - **Relancer** fait 500 sur **toute** requête, `createOnceGate` n'ayant pas de
 *   mémoire de l'échec : la passe entière se rejoue à chaque appel, sans recul,
 *   pendant que les autres processus expirent sur le verrou nommé. Un
 *   dépassement de délai de verrou sur `bg_users` — la table la plus chaude du
 *   site — suffit à y entrer, et c'est un incident transitoire.
 * - **Journaliser et poursuivre**, ce que fait cette fonction. Le site reste
 *   debout, la migration se rejoue au prochain démarrage, et la panne est
 *   lisible là où on la cherche (`pm2 logs`, cf. `docs/DEPLOYMENT.md`).
 *
 * Le cas nominal — la colonne est déjà là, ou déjà partie — ne journalise rien :
 * il se produit à chaque démarrage, et une ligne par entrée noierait la seule
 * qui compte.
 */
export function reportSchemaFailure(error: unknown, statement: string): void {
  // L'instruction est passée au prédicat : le même code MySQL ne dit pas la même
  // chose sur un `ADD COLUMN` et sur un `ADD INDEX` (voir `mysql-errors.ts`).
  if (isSchemaNoOpError(error, statement)) return;
  console.error(
    `[migrations] « ${statement} » a échoué — le schéma reste en arrière du code.`,
    error,
  );
}
