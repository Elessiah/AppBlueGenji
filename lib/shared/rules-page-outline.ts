/**
 * Plan d'une page `/regles/<mode>` : ses sections, leurs ancres, et le
 * sommaire qui les liste.
 *
 * La page empilait neuf blocs de même poids (pastilles, chiffres, principe,
 * schéma, une carte par règle, une carte par règle commune, autres modes) sans
 * rien pour dire où l'on était ni ce qui comptait : on ne savait pas quoi
 * regarder. Le plan est écrit **une fois** ici et sert deux lecteurs — les
 * titres de la page et le sommaire —, sans quoi une ancre renommée d'un côté
 * laisserait un lien qui ne mène nulle part (`#…` inconnu ne fait rien, sans
 * erreur).
 *
 * Module **pur** : aucun rendu, testable seul.
 */
import type { RuleSection, TournamentRuleMode } from "./tournament-rules";

export type RulesOutlineEntry = {
  /** Identifiant d'ancre, sans `#`. */
  id: string;
  label: string;
  /** Sous-entrées : les règles détaillées du mode. */
  children?: RulesOutlineEntry[];
};

/** Ancres fixes des grandes sections de la page. */
export const RULES_PAGE_ANCHORS = {
  tournament: "ce-tournoi",
  essentials: "essentiel",
  details: "regles-du-mode",
  common: "regles-communes",
  others: "autres-modes",
} as const;

/** « Phase qualificative — l'endurance » → « phase-qualificative-l-endurance ». */
export function ruleAnchorSlug(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, ""); // NOSONAR typescript:S8786 — titres du registre des règles, source de confiance
}

/**
 * Ancre de chaque règle détaillée, préfixée pour ne jamais heurter une ancre
 * fixe, et rendue unique si deux titres donnent le même segment.
 */
export function ruleSectionAnchors(sections: ReadonlyArray<Pick<RuleSection, "title">>): string[] {
  const seen = new Map<string, number>();
  return sections.map((section) => {
    const base = `regle-${ruleAnchorSlug(section.title) || "section"}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

/** Libellés des grandes entrées du sommaire (`rules.toc`), dans la langue de la page. */
export type RulesOutlineLabels = Readonly<Record<keyof typeof RULES_PAGE_ANCHORS, string>>;

/**
 * Sommaire de la page. Les réglages du tournoi n'y figurent que s'ils sont
 * affichés ; les règles communes, repliées, n'ont qu'une entrée — elles sont
 * les mêmes sur toutes les pages, le lecteur vient pour le mode.
 *
 * `anchors` : les ancres des règles du mode, calculées sur leurs titres
 * **français** ({@link ruleSectionAnchors}) — une ancre ne change pas avec la
 * langue, `/en/regles/survie#regle-coupes` vise la même section que
 * `/regles/survie#regle-coupes`. Par défaut, celles des titres reçus.
 */
export function rulesPageOutline(
  mode: Pick<TournamentRuleMode, "sections">,
  options: { hasTournamentSettings: boolean; labels: RulesOutlineLabels; anchors?: readonly string[] },
): RulesOutlineEntry[] {
  const { labels } = options;
  const anchors = options.anchors ?? ruleSectionAnchors(mode.sections);
  const entries: RulesOutlineEntry[] = [];
  if (options.hasTournamentSettings) {
    entries.push({ id: RULES_PAGE_ANCHORS.tournament, label: labels.tournament });
  }
  entries.push(
    { id: RULES_PAGE_ANCHORS.essentials, label: labels.essentials },
    {
      id: RULES_PAGE_ANCHORS.details,
      label: labels.details,
      children: mode.sections.map((section, i) => ({ id: anchors[i], label: section.title })),
    },
    { id: RULES_PAGE_ANCHORS.common, label: labels.common },
    { id: RULES_PAGE_ANCHORS.others, label: labels.others },
  );
  return entries;
}

/** Toutes les ancres du sommaire, dans l'ordre de la page. */
export function outlineAnchorIds(entries: RulesOutlineEntry[]): string[] {
  return entries.flatMap((entry) => [entry.id, ...(entry.children ?? []).map((child) => child.id)]);
}
