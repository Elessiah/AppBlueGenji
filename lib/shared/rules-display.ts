import type { RuleDiagram, RuleStatus } from "@/lib/shared/tournament-rules";

/**
 * Teintes des pages de règles (`/regles`, `/regles/[slug]`) — lot « Règles et
 * vitrine » de LANDING_ANIMATIONS.md. Chaque mode garde **la même** teinte sur
 * sa carte d'index, sa page et sa pastille « Autres modes », pour qu'on le
 * reconnaisse d'un écran à l'autre. Néons froids seulement (DESIGN_SYSTEM.md §
 * Palette « néon froid ») : aucun orange, ambre ni rouge.
 */
export type RuleTone = "blue" | "violet" | "cyan" | "teal" | "pink";

export const RULE_MODE_TONE: Record<RuleDiagram, RuleTone> = {
  SINGLE: "blue",
  DOUBLE: "violet",
  BG_SURVIE: "cyan",
  SURVIVAL: "teal",
  SWISS: "pink",
  MULTI: "violet",
};

/**
 * Pastille d'état d'un mode : vert d'eau « Disponible » (jouable), violet
 * « Bientôt » (à venir, comme un tournoi pas encore ouvert) — deux variantes
 * distinctes, jamais le gris pour un état qui a un sens.
 */
export const RULE_STATUS_PILL: Record<RuleStatus, "success" | "accent"> = {
  AVAILABLE: "success",
  SOON: "accent",
};
