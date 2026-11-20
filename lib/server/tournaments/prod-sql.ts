/**
 * Fragments SQL de la prod d'un match (`docs/features/MATCH_PROD.md`), sans
 * dépendance au moteur : `match-prod.ts`, `match-launch.ts` et le planning
 * les lisent sans s'importer l'un l'autre.
 */
import { jsonRoleLiteral } from "@/lib/server/privacy-consent";
import { rolesGranting } from "@/lib/shared/permissions";

/**
 * Le compte (alias `u` de `bg_users`) tient-il la permission `prod` ? Rôles
 * lus en base (jamais ceux d'une session), constantes du code vérifiées par
 * `jsonRoleLiteral`.
 */
export function prodRoleSql(alias: string): string {
  return `(${alias}.is_admin = 1${rolesGranting("prod")
    .map((role) => ` OR JSON_CONTAINS(${alias}.platform_roles_json, ${jsonRoleLiteral(role)})`)
    .join("")})`;
}

/** {@link prodRoleSql} sur l'alias `u` de `bg_users`. */
export const PROD_ROLE_SQL = prodRoleSql("u");

/**
 * Ligne de `bg_planning_assignments` **tenue** (choix du staff ou proposition
 * confirmée) — la même règle pour le décompte de l'équité, la vue du planning
 * et les refus de la prod. `alias` : celui de la table dans la requête
 * appelante (vide : colonnes sans préfixe).
 */
export function heldPlanningRowSql(alias = ""): string {
  const column = (name: string) => (alias === "" ? name : `${alias}.${name}`);
  return `(${column("source")} = 'MANUAL' OR ${column("confirmed")} = 1)`;
}
