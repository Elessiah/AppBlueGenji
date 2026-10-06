/**
 * Registre des **règles des modes de tournoi**, source unique des pages
 * `/regles` et `/regles/[slug]`.
 *
 * Le contenu est décrit en données (et non en JSX) pour trois raisons : les
 * pages restent génériques, le lien « bouton d'aide » d'une page de tournoi se
 * résout depuis le format stocké en base ({@link ruleModeForFormat}), et les
 * tests peuvent vérifier l'intégrité du registre (slugs uniques, couverture de
 * tous les formats).
 *
 * Ce module ne garde que la **structure** (slug, format, état, schéma) ; les
 * textes vivent dans les messages de l'espace `rules`
 * (`messages/<langue>/rules.json`, `docs/features/I18N.md`), sous la clé du
 * format. Ce sont des messages ICU : arguments (`{launchDelay}`) remplis par
 * {@link ruleTextValues}, gras en `<b>…</b>` — rendus par `RuleText`
 * (`components/rules/RuleText.tsx`).
 *
 * Module `shared` : importable côté serveur comme côté client. Seul le
 * français y est importé (le bouton d'aide des pages de tournoi, client et pas
 * encore traduit, lit {@link TOURNAMENT_RULE_MODES}) ; l'anglais n'est lu que
 * par le serveur (`messagesFor`).
 */
import frRules from "@/messages/fr/rules.json";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "./constants";
import type { Messages } from "./i18n-messages";
import type { Locale } from "./locales";
import { formatMessage, type MessageValues } from "./message-format";
import { MIN_MINUTES_PER_REPORTED_MAP } from "./score-report-deadline";
import { LAUNCH_AUTO_DELAY_MINUTES } from "./match-launch";
import { RANKING_BASE_POINTS } from "./ranking";
import type { TournamentFormat } from "./types";

/** `SOON` = mode décrit mais pas encore ouvert à la création. */
export type RuleStatus = "AVAILABLE" | "SOON";

/** Identifiant du schéma illustrant le mode (rendu par `components/rules`). */
export type RuleDiagram = "SINGLE" | "DOUBLE" | "SWISS" | "SURVIVAL" | "MULTI" | "BG_SURVIE";

/** Messages de l'espace `rules`, dans une langue. */
export type RulesMessages = Messages["rules"];

export type RuleFact = { label: string; value: string };

/** Textes : messages ICU (`{seedingRule}`, `<b>…</b>`), voir {@link ruleTextValues}. */
export type RuleSection = {
  title: string;
  /** Paragraphes introductifs (peut être vide si la section n'a que des points). */
  body: string[];
  bullets?: string[];
};

/** Ce qui ne dépend pas de la langue : l'adresse, le format, l'état, le schéma. */
export type RuleModeDefinition = {
  /** Segment d'URL : `/regles/<slug>` — le même en anglais (`/en/regles/<slug>`). */
  slug: string;
  format: TournamentFormat;
  status: RuleStatus;
  diagram: RuleDiagram;
};

export type TournamentRuleMode = RuleModeDefinition & {
  label: string;
  tagline: string;
  /** Chiffres clés affichés en tête de page et sur la carte d'index. */
  facts: RuleFact[];
  /** Le mode en trois phrases, avant d'entrer dans le détail. */
  principles: string[];
  diagramCaption: string;
  sections: RuleSection[];
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

/** Les modes avec leurs textes dans une langue (messages de l'espace `rules`). */
export function localizedRuleModes(messages: RulesMessages): TournamentRuleMode[] {
  return RULE_MODE_DEFINITIONS.map((definition) => ({ ...definition, ...messages.modes[definition.format] }));
}

/**
 * Règles transverses, identiques à tous les modes : elles vivent à part plutôt
 * que dupliquées dans chaque mode, et sont affichées en bas de chaque page.
 */
export function localizedCommonRules(messages: RulesMessages): RuleSection[] {
  return messages.common;
}

/**
 * Valeurs des arguments des textes de règles : les délais **réellement**
 * appliqués par le moteur, et la règle de seeding.
 *
 * La règle de seeding est écrite une fois (`rules.seedingRule`) et citée par
 * trois modes (`{seedingRule}`) ; elle dérive de {@link RANKING_BASE_POINTS}.
 * Les pages annonçaient autrefois « victoire = 3 points, défaite = 1 point » —
 * l'ancien barème de la carte d'annuaire, retiré du code par la PR #88 sans que
 * le texte suive. Deux phrases copiées dérivent ; une source unique, non.
 */
export function ruleTextValues(locale: Locale, messages: RulesMessages): MessageValues {
  return {
    launchDelay: LAUNCH_AUTO_DELAY_MINUTES,
    reportTimeout: SCORE_REPORT_TIMEOUT_MINUTES,
    minutesPerMap: MIN_MINUTES_PER_REPORTED_MAP,
    seedingRule: formatMessage(locale, messages.seedingRule, { basePoints: RANKING_BASE_POINTS }),
  };
}

/** Règles communes, en français (écrans pas encore traduits, tests). */
export const COMMON_RULES: RuleSection[] = localizedCommonRules(frRules);

/** Les modes, en français (bouton d'aide des pages de tournoi, tests). */
export const TOURNAMENT_RULE_MODES: TournamentRuleMode[] = localizedRuleModes(frRules);

/** Modes ouverts à la création, dans l'ordre d'affichage. */
export function availableRuleModes(modes: TournamentRuleMode[] = TOURNAMENT_RULE_MODES): TournamentRuleMode[] {
  return modes.filter((m) => m.status === "AVAILABLE");
}

/** Modes documentés mais pas encore ouverts. */
export function upcomingRuleModes(modes: TournamentRuleMode[] = TOURNAMENT_RULE_MODES): TournamentRuleMode[] {
  return modes.filter((m) => m.status === "SOON");
}

/** Résout un mode depuis son slug d'URL (null si inconnu). */
export function ruleModeBySlug(
  slug: string,
  modes: TournamentRuleMode[] = TOURNAMENT_RULE_MODES,
): TournamentRuleMode | null {
  return modes.find((m) => m.slug === slug) ?? null;
}

/**
 * Résout un mode depuis le format stocké en base — utilisé par le bouton d'aide
 * flottant des pages de tournoi.
 */
export function ruleModeForFormat(format: TournamentFormat): TournamentRuleMode | null {
  return TOURNAMENT_RULE_MODES.find((m) => m.format === format) ?? null;
}

/** URL des règles d'un format, ou l'index si le format est inconnu. */
export function rulesHrefForFormat(format: TournamentFormat): string {
  const definition = RULE_MODE_DEFINITIONS.find((m) => m.format === format);
  return definition ? `/regles/${definition.slug}` : "/regles";
}
