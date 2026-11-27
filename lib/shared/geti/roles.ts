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
  TANK: ["tank", "tanks", "tanker", "tankeur", "flex tank"],
  HITSCAN: ["hitscan dps", "dps hitscan", "hitscan", "hit scan", "hs dps", "dps hs", "hs"],
  FLEX_DPS: ["flex dps", "dps flex", "fdps", "projectile dps", "dps projectile", "proj dps"],
  DPS: ["dps", "damage", "degats", "dmg"],
  MAIN_SUPPORT: [
    "main support",
    "main supp",
    "main sup",
    "main heal",
    "main healer",
    "support main",
    "supp main",
    "sup main",
    "ms",
  ],
  FLEX_SUPPORT: [
    "flex support",
    "flex supp",
    "flex sup",
    "flex heal",
    "flex healer",
    "support flex",
    "supp flex",
    "sup flex",
    "heal flex",
    "fs",
  ],
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
const SHORT_ABBREVIATIONS = new Set(["mt", "ot", "ms", "fs", "hs"]);
/**
 * « flex » est aussi un verbe : « can flex to Juno », « peut flex sur Ana »,
 * « flex on other heroes » ne disent pas un joueur polyvalent.
 */
const FLEX_VERB_AFTER = /^\s(?:to|on|onto|sur|vers|into)(?![\p{L}\p{N}])/u;
/** « support » et « soutien » sont aussi des mots de politesse (« merci pour votre soutien »). */
const POLITE_WORDS = new Set(["support", "supports", "soutien"]);
/** Verbes qui font du mot un rôle tenu : « merci de jouer le support ». */
const ROLE_VERBS = String.raw`(?:jouer|joue|jouez|etre|faire|prendre|devenir|venir|rejoindre|tenir|play|playing|be|become|take|join|main)${NOT_BEFORE_WORD}`;
/**
 * Un remerciement juste avant, relié par « pour / for / de / du » : « merci pour
 * votre soutien », « thanks a lot for the support », « thank you very much for
 * your support », « merci pour tout votre soutien ». « je serai ton support »,
 * « thx we need a support » ou « merci de jouer le support » restent un rôle.
 */
const POLITE_BEFORE = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:merci|thanks?|thank you|thx)(?: [\p{L}']+){0,3}? (?:pour|for|de|du|d')(?: (?!${ROLE_VERBS})[\p{L}']+){0,2} ?$`,
  "u",
);

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
    if (POLITE_WORDS.has(key) && POLITE_BEFORE.test(lower.slice(Math.max(0, start - 60), start))) continue;
    if (key === "flex" && FLEX_VERB_AFTER.test(lower.slice(start + match[0].length, start + match[0].length + 8))) continue;
    // « tank flex » : un tank qui joue tous les tanks, pas un joueur polyvalent en plus.
    const previous = tokens.at(-1);
    if (key === "flex" && previous?.role === "TANK" && lower.slice(previous.end, start) === " ") continue;
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
