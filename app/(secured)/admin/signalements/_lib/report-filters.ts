/**
 * Tri et filtres du panneau des signalements — module pur.
 *
 * Le panneau reçoit tous les signalements conservés d'un coup (la purge en
 * borne le nombre) et les range ici : par catégorie, par état, et en tête ce
 * qui attend le plus. Rien ne dépend du rendu, tout se teste sans navigateur.
 */
import {
  PRIMARY_REPORT_CATEGORIES,
  REPORT_CATEGORY_DEFINITIONS,
  REPORT_TARGET_LABELS,
  type ReportCategory,
  type ReportStatus,
  type ReportView,
} from "@/lib/shared/content-reports";

/** Onglet de catégorie : une catégorie d'origine, ou toutes. */
export type CategoryTab = "ALL" | Exclude<ReportCategory, "CONTEST">;

/** Vue d'état : ce qui reste à faire, ou les archives. */
export type StatusView = "ACTIVE" | "ARCHIVED";

export interface ReportFilters {
  category: CategoryTab;
  status: StatusView;
  /** Seulement les signalements contestés. */
  contestedOnly: boolean;
}

export const DEFAULT_FILTERS: ReportFilters = { category: "ALL", status: "ACTIVE", contestedOnly: false };

export const CATEGORY_TABS: readonly CategoryTab[] = [
  "ALL",
  ...(PRIMARY_REPORT_CATEGORIES as readonly Exclude<ReportCategory, "CONTEST">[]),
];

export function categoryTabLabel(tab: CategoryTab): string {
  return tab === "ALL" ? "Tous" : REPORT_CATEGORY_DEFINITIONS[tab].label;
}

function matchesStatus(status: ReportStatus, view: StatusView): boolean {
  return view === "ARCHIVED" ? status === "RESOLVED" : status !== "RESOLVED";
}

/**
 * Rang d'urgence : à traiter d'abord, puis en cours, puis archivé ; et, à
 * état égal, un signalement contesté passe devant — quelqu'un attend une
 * réponse de l'association.
 */
function urgency(report: ReportView): number {
  const byStatus = report.status === "OPEN" ? 0 : report.status === "IN_PROGRESS" ? 2 : 4;
  return byStatus + (report.contests.length > 0 ? 0 : 1);
}

/**
 * Les signalements à afficher, dans l'ordre de traitement : le plus urgent en
 * tête, puis le plus ancien d'abord à urgence égale (premier arrivé, premier
 * servi) — sauf dans les archives, où l'on cherche d'abord le plus récent.
 */
export function filterReports(reports: readonly ReportView[], filters: ReportFilters): ReportView[] {
  const kept = reports.filter(
    (report) =>
      (filters.category === "ALL" || report.category === filters.category) &&
      matchesStatus(report.status, filters.status) &&
      (!filters.contestedOnly || report.contests.length > 0),
  );
  return kept.sort((a, b) => {
    if (filters.status === "ARCHIVED") {
      return b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id;
    }
    return urgency(a) - urgency(b) || a.createdAt.localeCompare(b.createdAt) || a.id - b.id;
  });
}

/** Nombre de signalements **actifs** par onglet — la pastille de chaque onglet. */
export function activeCountsByTab(reports: readonly ReportView[]): Record<CategoryTab, number> {
  const counts = Object.fromEntries(CATEGORY_TABS.map((tab) => [tab, 0])) as Record<CategoryTab, number>;
  for (const report of reports) {
    if (report.status === "RESOLVED" || report.category === "CONTEST") continue;
    counts.ALL += 1;
    counts[report.category] += 1;
  }
  return counts;
}

export interface StatusSummary {
  open: number;
  inProgress: number;
  archived: number;
  contested: number;
}

export function statusSummary(reports: readonly ReportView[]): StatusSummary {
  return {
    open: reports.filter((report) => report.status === "OPEN").length,
    inProgress: reports.filter((report) => report.status === "IN_PROGRESS").length,
    archived: reports.filter((report) => report.status === "RESOLVED").length,
    contested: reports.filter((report) => report.status !== "RESOLVED" && report.contests.length > 0).length,
  };
}

/**
 * Résumé d'une ligne de la liste : les équipes et les tournois par leur nom,
 * les joueurs par leur nombre ou leur pseudo s'il n'y en a qu'un. Vide pour un
 * signalement sans cible (un bug).
 */
export function targetSummary(report: ReportView): string {
  const parts: string[] = [];
  for (const type of ["TEAM", "USER", "TOURNAMENT"] as const) {
    const ofType = report.targets.filter((target) => target.type === type);
    if (ofType.length === 0) continue;
    if (ofType.length === 1) {
      parts.push(ofType[0].label);
    } else {
      parts.push(`${ofType.length} ${REPORT_TARGET_LABELS[type].many}`);
    }
  }
  return parts.join(" · ");
}

/**
 * Âge lisible d'un signalement (« il y a 12 min », « il y a 3 j ») : c'est ce
 * qui dit, d'un coup d'œil, depuis combien de temps quelqu'un attend.
 */
export function relativeAge(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}
