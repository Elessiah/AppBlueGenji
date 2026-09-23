/**
 * Surcharges partielles d'une ligne mysql2, pour les fabriques de test.
 *
 * `Partial<T>` ne suffit pas : `RowDataPacket` déclare un `constructor` au nom
 * littéral (`"RowDataPacket"`), que TypeScript confronte au `constructor`
 * hérité de tout littéral d'objet — `{ state: "RUNNING" }` est alors refusé.
 * La clé est retirée ; les colonnes connues gardent leur type.
 */
export type RowOverrides<T> = {
  [K in keyof T as K extends "constructor" ? never : K]?: T[K];
};
