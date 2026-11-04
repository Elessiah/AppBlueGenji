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

/**
 * Les colonnes d'une ligne mysql2, **toutes requises** : `RowDataPacket` porte
 * des signatures d'index (`[column: string]: any`) qui font accepter n'importe
 * quel objet partiel. Elles sont retirées, avec le `constructor` littéral, pour
 * que l'oubli d'une colonne se voie à la compilation.
 */
export type RowColumns<T> = {
  [K in keyof T as K extends "constructor"
    ? never
    : string extends K
      ? never
      : number extends K
        ? never
        : K]: T[K];
};
