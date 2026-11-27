/**
 * Rôles Overwatch lus dans une annonce GETI : Tank, DPS, Support, Flex, et
 * leurs sous-rôles (« main tank », « hitscan », « flex support »), en français,
 * en anglais et en abrégé.
 *
 * Module pur : importable côté serveur comme côté client.
 */
import { NOT_AFTER_WORD, NOT_BEFORE_WORD, aliasKey, aliasTable, inReferenceOrder } from "@/lib/shared/geti/normalize";
import { GETI_ROLES, GETI_SUB_ROLES, type GetiRole, type GetiSubRole } from "@/lib/shared/geti/types";

type RoleKind = GetiRole | GetiSubRole;

/** Alias en minuscules, sans accents ; une espace tolère tiret ou rien. */
const ROLE_ALIASES: Readonly<Record<RoleKind, readonly string[]>> = {
  MAIN_TANK: ["main tank", "mt"],
  OFF_TANK: ["off tank", "ot"],
  TANK: ["tank", "tanks", "tanker", "tankeur"],
  HITSCAN: ["hitscan dps", "dps hitscan", "hitscan", "hit scan"],
  FLEX_DPS: ["flex dps", "fdps", "projectile dps", "dps projectile", "proj dps"],
  DPS: ["dps", "damage", "degats", "dmg"],
  MAIN_SUPPORT: ["main support", "main supp", "main sup", "main heal", "main healer", "ms"],
  FLEX_SUPPORT: ["flex support", "flex supp", "flex sup", "flex heal", "flex healer", "fs"],
  SUPPORT: [
    "support",
    "supports",
    "supp",
    "supps",
    "sup",
    "heal",
    "heals",
    "healer",
    "healers",
    "healeur",
    "soigneur",
    "soigneurs",
    "soutien",
  ],
  FLEX: ["flex", "all roles", "all role", "tous roles", "tous les roles", "polyvalent", "polyvalente", "fill"],
};

const SUB_ROLE_PARENT: Readonly<Record<GetiSubRole, GetiRole>> = {
  MAIN_TANK: "TANK",
  OFF_TANK: "TANK",
  HITSCAN: "DPS",
  FLEX_DPS: "DPS",
  MAIN_SUPPORT: "SUPPORT",
  FLEX_SUPPORT: "SUPPORT",
};

/** Abréviations de deux lettres, ambiguës derrière un nombre (« 20 ms » de ping). */
const SHORT_ABBREVIATIONS = new Set(["mt", "ot", "ms", "fs"]);

const ROLE_TABLE = aliasTable(ROLE_ALIASES);
const ROLE_PATTERN = new RegExp(`${NOT_AFTER_WORD}(${ROLE_TABLE.pattern})${NOT_BEFORE_WORD}`, "gu");

/** Un rôle repéré dans le texte, avec sa position. */
export type GetiRoleToken = {
  start: number;
  end: number;
  role: GetiRole;
  subRole: GetiSubRole | null;
};

function isSubRole(kind: RoleKind): kind is GetiSubRole {
  return kind in SUB_ROLE_PARENT;
}

/**
 * Repère les rôles d'un texte préparé.
 *
 * @param lower Texte sans accents, en minuscules (`prepareGetiText`).
 * @returns Les rôles, dans l'ordre du texte.
 */
export function findGetiRoleTokens(lower: string): GetiRoleToken[] {
  const tokens: GetiRoleToken[] = [];
  for (const match of lower.matchAll(ROLE_PATTERN)) {
    const key = aliasKey(match[1]);
    const kind = ROLE_TABLE.lookup.get(key);
    if (kind === undefined) continue;
    const start = match.index;
    if (SHORT_ABBREVIATIONS.has(key) && /\d\s?$/u.test(lower.slice(Math.max(0, start - 2), start))) continue;
    tokens.push(
      isSubRole(kind)
        ? { start, end: start + match[0].length, role: SUB_ROLE_PARENT[kind], subRole: kind }
        : { start, end: start + match[0].length, role: kind, subRole: null },
    );
  }
  return tokens;
}

/** Rôles distincts, dans l'ordre Tank, DPS, Support, Flex. */
export function getiRolesOf(tokens: readonly GetiRoleToken[]): GetiRole[] {
  return inReferenceOrder(
    GETI_ROLES,
    tokens.map((token) => token.role),
  );
}

/** Sous-rôles distincts, dans l'ordre de {@link GETI_SUB_ROLES}. */
export function getiSubRolesOf(tokens: readonly GetiRoleToken[]): GetiSubRole[] {
  return inReferenceOrder(
    GETI_SUB_ROLES,
    tokens.flatMap((token) => (token.subRole === null ? [] : [token.subRole])),
  );
}
