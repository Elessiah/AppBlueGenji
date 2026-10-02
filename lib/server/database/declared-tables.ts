import type { Pool } from "mysql2/promise";

/**
 * Les `CREATE TABLE` **tels qu'ils ont été déclarés**, retenus au passage.
 *
 * Le filet de schéma s'en sert pour savoir ce que le code attend, au lieu d'une
 * liste de témoins choisis à la main. Une liste choisie ne voit que ce qu'on a
 * pensé à y mettre — cinq colonnes sur les soixante-dix repliées —, et
 * l'argument qui la justifiait (« les migrations sont jouées dans l'ordre »)
 * est celui que le filet de schéma réfute déjà pour les index : chaque ancien `ALTER`
 * était tolérant **indépendamment**, donc chacun pouvait manquer seul.
 *
 * Retenir la déclaration plutôt que la recopier est ce qui rend l'attente
 * exacte par construction : une colonne ajoutée à une table neuve entre dans la
 * surveillance sans que personne ait à y penser, ce qui est la seule façon de
 * fermer une panne qui tient justement à ce qu'on l'oublie.
 */
export const DECLARED_TABLES: string[] = [];

export async function createTable(db: Pool, ddl: string): Promise<void> {
  DECLARED_TABLES.push(ddl);
  await db.execute(ddl);
}

/** Premiers mots d'une clause de clé : elle décrit la table, pas une colonne. */
const KEY_CLAUSE_WORDS = new Set(["PRIMARY", "UNIQUE", "KEY", "INDEX", "CONSTRAINT", "FOREIGN", "FULLTEXT", "SPATIAL"]);

/**
 * Les colonnes déclarées par un `CREATE TABLE`, et le nom de sa table.
 *
 * Le découpage se fait sur les virgules de **premier niveau** du corps, et non
 * sur ses lignes : une définition n'occupe pas toujours une ligne, et trois
 * écritures parfaitement ordinaires fabriquaient chacune une colonne
 * inexistante — donc une alerte de retard sur un schéma à jour, et un filet
 * qu'on finit par éteindre. La ligne de continuation d'une `FOREIGN KEY`
 * (`REFERENCES bg_users(id) …`) commence par un mot qu'aucune liste de mots
 * réservés n'écarte ; un commentaire `--` glissé entre deux colonnes se lit
 * comme une définition de plus ; et une virgule prise dans un `DEFAULT 'a, b'`
 * couperait une définition en deux. D'où un parcours qui compte les
 * parenthèses et connaît les apostrophes.
 *
 * Ce qui reste écarté par son premier mot, ce sont les **clauses de clé**
 * (`PRIMARY`, `UNIQUE`, `KEY`, `INDEX`, `CONSTRAINT`, `FOREIGN`, …) : elles
 * décrivent la table, pas une colonne.
 */
export function declaredColumns(ddl: string): { table: string; columns: string[] } | null {
  const named = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(/.exec(ddl);
  if (!named) return null;
  // On découpe le corps sur ses virgules **de premier niveau** plutôt que sur
  // ses lignes : une clé étrangère écrite sur deux lignes laisse une ligne de
  // continuation (`REFERENCES bg_users(id) …`) que la lecture ligne à ligne
  // prenait pour une colonne nommée « REFERENCES ».
  const body = ddl
    .slice(named.index + named[0].length)
    // Un commentaire SQL peut tomber entre deux colonnes : sa première ligne se
    // lirait comme une définition de plus.
    .replace(/--[^\n]*/g, "");
  const columns: string[] = [];
  for (const definition of splitTopLevelDefinitions(body)) {
    const word = /^`?(\w+)`?\s+\S/.exec(definition.trim().replace(/\s+/g, " "));
    if (!word) continue;
    if (KEY_CLAUSE_WORDS.has(word[1].toUpperCase())) continue;
    columns.push(word[1]);
  }
  return { table: named[1], columns };
}

/** Ce que chaque parenthèse fait à la profondeur d'imbrication. */
const PAREN_DEPTH_STEP: Readonly<Record<string, number>> = { "(": 1, ")": -1 };

/**
 * Découpe le corps d'un `CREATE TABLE` (ce qui suit sa parenthèse ouvrante) sur
 * ses virgules **de premier niveau**, en s'arrêtant à la parenthèse qui le
 * ferme.
 */
function splitTopLevelDefinitions(body: string): string[] {
  const definitions: string[] = [];
  let depth = 1;
  let quote: string | null = null;
  let current = "";
  for (const char of body) {
    // Une virgule entre apostrophes appartient à une valeur par défaut, pas au
    // découpage : sans cette garde, `DEFAULT 'a,b'` fabriquerait une colonne.
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    depth += PAREN_DEPTH_STEP[char] ?? 0;
    // Seule une parenthèse fermante fait tomber la profondeur à zéro : c'est
    // celle qui ferme le corps.
    if (depth === 0) break;
    if (char === "," && depth === 1) {
      definitions.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  definitions.push(current);
  return definitions;
}
