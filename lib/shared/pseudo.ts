/**
 * Les bornes du pseudo d'un compte, partagées par le serveur qui les applique
 * et l'écran qui les annonce.
 *
 * `bg_users.pseudo` est un `VARCHAR(40)` : au-delà, MySQL refuse l'écriture
 * (`ER_DATA_TOO_LONG`) et son message brut — qui nomme la colonne — partait tel
 * quel dans le corps du 400. La borne est donc contrôlée **avant** la requête,
 * et nommée ici pour que la phrase d'erreur ne puisse pas annoncer un autre
 * nombre que celui que le serveur tient.
 *
 * Module **pur**.
 */

/** Longueur maximale d'un pseudo, en caractères — celle de la colonne. */
export const PSEUDO_MAX_LENGTH = 40;

/**
 * Longueur d'un pseudo telle que MySQL la compte : en **caractères**, pas en
 * unités UTF-16. `"🎮".length` vaut 2 alors que la colonne `utf8mb4` n'y voit
 * qu'un caractère — compter avec `.length` refuserait des pseudos que la base
 * accepte.
 */
export function pseudoLength(pseudo: string): number {
  return Array.from(pseudo).length;
}
