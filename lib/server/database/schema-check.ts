import type { Pool, RowDataPacket } from "mysql2/promise";
import { DECLARED_TABLES, declaredColumns } from "./declared-tables";

/**
 * Le **filet** de la consolidation : dire, au démarrage, qu'une base n'a pas
 * joué les `ALTER` qu'on a repliés.
 *
 * Toute la consolidation repose sur une prémisse — « la production porte déjà les
 * soixante-trois `ALTER` » — qui était jusqu'ici **affirmée et jamais
 * vérifiée**. Si elle est fausse d'une seule version, la base démarre sans
 * bruit (`CREATE TABLE IF NOT EXISTS` ne fait rien), et la panne se découvre en
 * production sur la première requête qui nomme une colonne absente. Une lecture
 * d'`information_schema` au démarrage change ce scénario en une ligne de log,
 * avant le premier visiteur.
 *
 * Les colonnes témoins sont prises dans le **dernier lot replié** — celui qui a
 * le plus de chances de manquer. En trouver une absente ne prouve pas que les
 * soixante-deux autres sont là, mais l'inverse est vrai : les migrations étant
 * jouées dans l'ordre, une base à jour sur le dernier lot l'est sur les
 * précédents.
 *
 * Elle **ne répare rien** et ne fait échouer personne : la réparation d'une base
 * en retard se fait à la main (`docs/DATABASE_SCHEMA.md`), et interrompre le
 * démarrage n'y aiderait pas — cela remplacerait un site dégradé par un site
 * éteint.
 */
export async function warnIfSchemaIsBehind(db: Pool): Promise<void> {
  // Une entrée par lot replié, la plus récente d'abord.
  const WITNESSES: readonly Witness[] = [
    { table: "bg_users", column: "email", absent: true },
    { table: "bg_tournaments", column: "game", expect: "'OW'", forbid: "'OW2'" },
    { table: "bg_tournaments", column: "match_format_max_maps" },
    { table: "bg_tournaments", column: "endurance_playoff_format_type" },
    { table: "bg_matches", column: "phase_id" },
  ];

  // **Trois `try` et non un seul**, et le découpage est le propos : les deux
  // sondes sont indépendantes, et les faire partager un `try` faisait jeter par
  // l'échec de la seconde les constats que la première venait d'établir — dont
  // le « les adresses sont encore là », qui est la raison d'être du filet.
  // Le rapport, lui, vit en dehors des deux : il doit dire ce qu'on sait, même
  // partiellement.
  const gaps: string[] = [];

  try {
    const [rows] = await db.execute<
      (RowDataPacket & { TABLE_NAME: string; COLUMN_NAME: string; COLUMN_TYPE: string })[]
    >(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND (TABLE_NAME, COLUMN_NAME) IN (${WITNESSES.map(() => "(?, ?)").join(", ")})`,
      WITNESSES.flatMap((w) => [w.table, w.column]),
    );
    const found = new Map(rows.map((r) => [`${r.TABLE_NAME}.${r.COLUMN_NAME}`, r.COLUMN_TYPE]));

    for (const witness of WITNESSES) {
      const gap = witnessGap(witness, found.get(`${witness.table}.${witness.column}`));
      if (gap !== null) gaps.push(gap);
    }

  } catch {
    // Le filet ne doit jamais devenir la panne : une base qui refuse
    // `information_schema` reste servie comme avant.
  }

  try {
    // **Toutes** les colonnes déclarées, et pas seulement des témoins choisis :
    // la liste vient des `CREATE TABLE` retenus par `createTable`, donc elle est
    // exacte par construction et suit une table modifiée sans qu'on y pense.
    const declared = DECLARED_TABLES.map(declaredColumns).filter((d) => d !== null);
    const [allRows] = await db.execute<(RowDataPacket & { t: string; c: string })[]>(
      `SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()`,
    );
    const present = new Set(allRows.map((r) => `${r.t}.${r.c}`));
    const missing = declared.flatMap(({ table, columns }) =>
      columns.filter((c) => !present.has(`${table}.${c}`)).map((c) => `${table}.${c}`),
    );
    // Une table entièrement absente n'est pas un retard de schéma : les
    // `CREATE TABLE` viennent de passer, et trois d'entre elles sont
    // volontairement tolérées. On ne signale que les colonnes manquantes d'une
    // table **présente**.
    const tables = new Set(allRows.map((r) => r.t));
    const lagging = missing.filter((name) => tables.has(name.split(".")[0]));
    if (lagging.length > 0) {
      gaps.push(`${lagging.length} colonne(s) déclarée(s) manquante(s) : ${lagging.join(", ")}`);
    }

    // Les **index** ne se lisent pas dans `COLUMNS`, et leur absence est la plus
    // silencieuse de toutes : une colonne manquante fait tomber la requête qui
    // la nomme, un index unique manquant ne fait **rien** — il cesse simplement
    // de trancher la course qu'il existe pour trancher. `mapTeamTagConflict`
    // continuerait de traduire un `ER_DUP_ENTRY` qui n'arrive plus jamais, et
    // deux équipes créées au même instant prendraient le même sigle.
    //
    // L'argument « les migrations sont jouées dans l'ordre » ne les couvre pas :
    // chaque ancien `ALTER` était tolérant **indépendamment**, et celui-ci
    // pouvait échouer de façon déterministe sur des données (des doublons à
    // libérer d'abord) pendant que les suivants passaient.
    const INDEX_WITNESSES: readonly (readonly [string, string])[] = [
      ["bg_teams", "uniq_bg_teams_tag"],
      ["bg_teams", "uniq_bg_teams_solo_user"],
    ];
    const [indexRows] = await db.execute<(RowDataPacket & { INDEX_NAME: string })[]>(
      `SELECT DISTINCT INDEX_NAME
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND (TABLE_NAME, INDEX_NAME) IN (${INDEX_WITNESSES.map(() => "(?, ?)").join(", ")})`,
      INDEX_WITNESSES.flatMap(([table, index]) => [table, index]),
    );
    const indexes = new Set(indexRows.map((r) => r.INDEX_NAME));
    for (const [table, index] of INDEX_WITNESSES) {
      if (!indexes.has(index)) gaps.push(`l'index ${index} manque sur ${table}`);
    }

    // La **clé primaire recomposée** des deux classements à phases. Son absence
    // ne fait rien tomber : avec `phase_id` présent mais la clé restée à deux
    // colonnes, le classement de la phase 2 d'un tournoi `MULTI` **écrase** la
    // ligne de la phase 1 pour la même équipe au lieu de lever. Un écrasement
    // silencieux est exactement ce qu'un filet doit rendre bruyant.
    const [pkRows] = await db.execute<(RowDataPacket & { t: string; n: number })[]>(
      `SELECT TABLE_NAME t, COUNT(*) n FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME = 'PRIMARY'
          AND TABLE_NAME IN ('bg_swiss_standings', 'bg_survival_standings')
        GROUP BY TABLE_NAME`,
    );
    for (const row of pkRows) {
      if (row.n < 3) {
        gaps.push(
          `la clé primaire de ${row.t} n'a que ${row.n} colonne(s) au lieu de 3 ` +
            `(sans phase_id, un classement de phase en écrase un autre en silence)`,
        );
      }
    }
  } catch {
    // Idem : l'écart sur les colonnes, lui, reste dit.
  }

  if (gaps.length > 0) {
    console.error(
      `[migrations] Cette base est en retard sur le schéma : ${gaps.join(" ; ")}. ` +
        `Les ALTER concernés ont été repliés dans les CREATE TABLE, qui ne rattrapent ` +
        `rien sur une base existante — il faut la migrer à la main (docs/DATABASE_SCHEMA.md).`,
    );
  }
}

/**
 * Un témoin, et ce qu'on attend de lui.
 *
 * `expect` couvre une classe que la seule **présence** d'une colonne ne voit
 * pas : un `ALTER … MODIFY` replié. La conversion de `game` de
 * `ENUM('OW2','MR')` vers `ENUM('OW','MR')` est la plus récente des trois, et
 * une base restée avant elle porte bien la colonne — elle rendrait simplement
 * « Data truncated for column 'game' » au premier tournoi écrit.
 *
 * `absent` couvre la classe symétrique : une colonne qui devait **partir**. Le
 * retrait de `bg_users.email` est au mieux best-effort — un dépassement de
 * délai de verrou suffit à le manquer — et il n'est jamais rejoué dans le
 * processus, la porte mémorisant une passe qui se résout désormais toujours.
 * Or plus rien d'autre n'efface ces adresses : `anonymizeOwnAccount` a perdu
 * son `email = NULL` dans la même version.
 */
type Witness = {
  table: string;
  column: string;
  /** Fragment attendu dans `COLUMN_TYPE`, pour un type replié par `MODIFY`. */
  expect?: string;
  /**
   * Fragment qui ne doit **plus** figurer dans `COLUMN_TYPE`.
   *
   * `expect` seul ne suffit pas sur un `ENUM` : une base à demi convertie
   * porte `enum('OW2','MR','OW')`, qui contient bien `'OW'` et passerait le
   * filet — alors qu'elle n'est ni réparée (la conversion est repliée) ni
   * signalée. Ce qui distingue une base à jour est l'**absence** de l'ancienne
   * valeur, pas la présence de la neuve.
   */
  forbid?: string;
  /** La colonne devait disparaître : la trouver **est** l'anomalie. */
  absent?: true;
};

/**
 * Ce qu'un témoin dit du schéma, d'après le `COLUMN_TYPE` lu (`undefined` :
 * colonne absente).
 *
 * @returns La ligne du rapport, ou `null` si le témoin est conforme.
 */
function witnessGap(witness: Witness, type: string | undefined): string | null {
  const name = `${witness.table}.${witness.column}`;
  if (witness.absent) {
    if (type !== undefined) {
      // Le filet dit l'état du **schéma**, jamais celui des données : il ne
      // lit qu'`information_schema`. Annoncer « les adresses y sont
      // encore » était donc une affirmation qu'il ne peut pas soutenir — et
      // fausse précisément dans le cas qui compte, celui où le repli sans
      // DDL vient de les vider : les deux lignes se contredisaient dans le
      // même démarrage. Ce qu'il sait, et qui suffit, c'est que la colonne
      // est toujours là. Combien d'adresses ont été effacées, c'est le repli
      // qui le dit, parce que lui seul a compté.
      return `${name} devrait avoir disparu — la colonne reste à retirer à la main`;
    }
  } else if (type === undefined) {
    return `${name} manque`;
  } else if (witness.expect && !type.includes(witness.expect)) {
    return `${name} est resté « ${type} », sans ${witness.expect}`;
  } else if (witness.forbid && type.includes(witness.forbid)) {
    return `${name} porte encore ${witness.forbid} : « ${type} »`;
  }
  return null;
}
