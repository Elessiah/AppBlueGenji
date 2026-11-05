/**
 * Un identifiant lu en base (`BIGINT` nul ou non, que `mysql2` peut rendre en
 * texte) : un nombre, ou `null`. Une seule définition, pour tout le serveur
 * comme pour les modules purs.
 */
export function nullableId(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}
