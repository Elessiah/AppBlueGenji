/**
 * Structure des modes de règles — sans aucun texte de règle.
 *
 * Séparé de `tournament-rules.ts` pour le **bouton d'aide** des pages de
 * tournoi (`components/rules/RulesHelpFab.tsx`, composant client) : il n'a
 * besoin que de l'adresse des règles et du nom du mode. Importer
 * `tournament-rules.ts` lui ferait embarquer tout `messages/fr/rules.json`
 * (≈ 38 Ko) dans le paquet JavaScript de `/tournois` et `/tournois/<id>`.
 *
 * `tournament-rules.ts` réexporte tout ce module : les pages `/regles`
 * continuent de l'importer de là.
 */
import type { TournamentFormat } from "./types";

/** `SOON` = mode décrit mais pas encore ouvert à la création. */
export type RuleStatus = "AVAILABLE" | "SOON";

/** Identifiant du schéma illustrant le mode (rendu par `components/rules`). */
export type RuleDiagram = "SINGLE" | "DOUBLE" | "SWISS" | "SURVIVAL" | "MULTI" | "BG_SURVIE";

/** Ce qui ne dépend pas de la langue : l'adresse, le format, l'état, le schéma. */
export type RuleModeDefinition = {
  /** Segment d'URL : `/regles/<slug>` — le même en anglais (`/en/regles/<slug>`). */
  slug: string;
  format: TournamentFormat;
  status: RuleStatus;
  diagram: RuleDiagram;
};

/** Les modes, dans l'ordre d'affichage. Leurs textes : `rules.modes.<FORMAT>`. */
export const RULE_MODE_DEFINITIONS: readonly RuleModeDefinition[] = [
  { slug: "elimination-simple", format: "SINGLE", status: "AVAILABLE", diagram: "SINGLE" },
  { slug: "double-elimination", format: "DOUBLE", status: "AVAILABLE", diagram: "DOUBLE" },
  { slug: "bluegenji-survie", format: "BG_SURVIE", status: "AVAILABLE", diagram: "BG_SURVIE" },
  { slug: "survie", format: "SURVIVAL", status: "AVAILABLE", diagram: "SURVIVAL" },
  { slug: "ronde-suisse", format: "SWISS", status: "AVAILABLE", diagram: "SWISS" },
  { slug: "multi-phases", format: "MULTI", status: "AVAILABLE", diagram: "MULTI" },
];

/**
 * Nom français de chaque mode, tel que `rules.modes.<FORMAT>.label` dans
 * `messages/fr/rules.json` — un test garde les deux identiques. Seul usage :
 * le libellé du bouton d'aide, encore en français (lot 8a de la migration).
 */
export const RULE_MODE_LABELS_FR: Readonly<Record<TournamentFormat, string>> = {
  SINGLE: "Élimination simple",
  DOUBLE: "Double élimination",
  BG_SURVIE: "BlueGenji Survie",
  SURVIVAL: "Survie par coupes",
  SWISS: "Ronde suisse",
  MULTI: "Tournoi multi-phases",
};

/** URL des règles d'un format, ou l'index si le format est inconnu. */
export function rulesHrefForFormat(format: TournamentFormat): string {
  const definition = RULE_MODE_DEFINITIONS.find((m) => m.format === format);
  return definition ? `/regles/${definition.slug}` : "/regles";
}
