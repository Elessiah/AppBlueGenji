"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import {
  REPORT_CATEGORY_DEFINITIONS,
  type ReportAction,
  type ReportView,
} from "@/lib/shared/content-reports";
import {
  CATEGORY_TABS,
  DEFAULT_FILTERS,
  activeCountsByTab,
  categoryTabLabel,
  filterReports,
  relativeAge,
  statusSummary,
  targetSummary,
  type ReportFilters,
} from "./_lib/report-filters";
import { adminFetch, adminReportErrorMessage, jsonBody } from "./_lib/admin-errors";
import { ReportDetail } from "./_components/ReportDetail";
import { StatusPill } from "./_components/StatusPill";
import styles from "./reports.module.css";

const ACTION_SUCCESS: Record<ReportAction, string> = {
  TAKE: "Signalement pris en charge.",
  RELEASE: "Signalement remis en attente.",
  RESOLVE: "Signalement archivé.",
  REOPEN: "Signalement rouvert.",
};

/**
 * Panneau des signalements (permission `moderation`).
 *
 * Pensé pour traiter vite : la liste s'ouvre sur ce qui attend (à traiter et
 * contestés en tête, le plus ancien d'abord), le dossier sélectionné se lit à
 * côté sans changer de page, et chaque geste — prendre en charge, masquer un
 * logo, archiver — se fait depuis le dossier. L'adresse porte le signalement
 * ouvert (`?id=`) : c'est le lien des alertes Discord.
 */
export default function ReportsAdminPage() {
  // `useSearchParams` exige une frontière de suspense au rendu serveur.
  return (
    <Suspense>
      <ReportsPanel />
    </Suspense>
  );
}

function ReportsPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showError, showSuccess } = useToast();
  const [reports, setReports] = useState<ReportView[] | null>(null);
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_FILTERS);
  const [busy, setBusy] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const selectedId = Number(searchParams.get("id")) || null;

  const load = useCallback(async () => {
    try {
      const body = await adminFetch<{ reports: ReportView[] }>("/api/admin/reports", undefined, "REPORTS_LOAD_FAILED");
      setReports(body.reports);
    } catch (error) {
      showError(adminReportErrorMessage((error as Error).message));
      setReports((current) => current ?? []);
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Arrivé par le lien d'une alerte sur un signalement archivé ou d'une autre
  // catégorie : les filtres s'ouvrent sur lui plutôt que de le cacher.
  const alignedOn = useRef<number | null>(null);
  useEffect(() => {
    if (!reports || selectedId === null || alignedOn.current === selectedId) return;
    const target = reports.find((report) => report.id === selectedId);
    if (!target) return;
    alignedOn.current = selectedId;
    setFilters((current) => {
      const status = target.status === "RESOLVED" ? "ARCHIVED" : "ACTIVE";
      const category =
        current.category === "ALL" || current.category === target.category ? current.category : "ALL";
      return { ...current, status, category, contestedOnly: current.contestedOnly && target.contests.length > 0 };
    });
  }, [reports, selectedId]);

  const visible = useMemo(() => (reports ? filterReports(reports, filters) : []), [reports, filters]);

  // Sur grand écran, le premier dossier de la liste (le plus urgent) s'ouvre
  // d'office : un clic de moins pour qui vient traiter. Sur mobile, le dossier
  // est sous la liste, l'ouvrir d'office ferait défiler sans qu'on l'ait demandé.
  useEffect(() => {
    if (selectedId !== null || visible.length === 0) return;
    if (window.matchMedia("(max-width: 900px)").matches) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("id", String(visible[0].id));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [selectedId, visible, searchParams, router, pathname]);
  const counts = useMemo(() => activeCountsByTab(reports ?? []), [reports]);
  const summary = useMemo(() => statusSummary(reports ?? []), [reports]);
  const selected = reports?.find((report) => report.id === selectedId) ?? null;

  const select = (id: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("id", String(id));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // Sur mobile, le dossier est sous la liste : on l'amène à l'écran.
    if (window.matchMedia("(max-width: 900px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const run = async (task: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
      showSuccess(success);
    } catch (error) {
      showError(adminReportErrorMessage((error as Error).message));
    } finally {
      await load();
      setBusy(false);
    }
  };

  const onAction = (action: ReportAction, note?: string) => {
    if (!selected) return;
    void run(
      () => adminFetch(`/api/admin/reports/${selected.id}`, jsonBody("PATCH", { action, note }), "REPORT_ACTION_FAILED"),
      ACTION_SUCCESS[action],
    );
  };

  const onHideLogo = (teamId: number) => {
    if (!selected) return;
    void run(
      () =>
        adminFetch(
          `/api/admin/reports/${selected.id}/logo-quarantine`,
          jsonBody("POST", { teamId }),
          "LOGO_HIDE_FAILED",
        ),
      "Logo masqué. L'équipe est prévenue et peut contester.",
    );
  };

  // Depuis un dossier, la suppression passe par le signalement : elle y reste
  // inscrite, et l'équipe est prévenue avec le lien pour contester.
  const onDeleteLogo = (teamId: number) => {
    if (!selected) return;
    void run(
      () =>
        adminFetch(
          `/api/admin/reports/${selected.id}/logo-removal`,
          jsonBody("POST", { teamId }),
          "TEAM_LOGO_REMOVE_FAILED",
        ),
      "Logo supprimé définitivement. L'équipe est prévenue et peut contester.",
    );
  };

  const onRestore = (quarantineId: number) =>
    void run(
      () =>
        adminFetch(`/api/admin/logo-quarantines/${quarantineId}/restore`, { method: "POST" }, "LOGO_RESTORE_FAILED"),
      "Logo rétabli. L'équipe est prévenue.",
    );

  const onPurge = (quarantineId: number) =>
    void run(
      () => adminFetch(`/api/admin/logo-quarantines/${quarantineId}`, { method: "DELETE" }, "LOGO_PURGE_FAILED"),
      "Logo supprimé définitivement.",
    );

  return (
    <section className={`container ${styles.page}`}>
      <header className={styles.head}>
        <div>
          <span className="eyebrow">MODÉRATION · ADMINISTRATEURS</span>
          <h1 className={`display ${styles.title}`}>Signalements</h1>
        </div>
        <ul className={styles.summary} aria-label="Vue d'ensemble">
          <li className={`${styles.stat} ${summary.open > 0 ? styles.statUrgent : ""}`}>
            <span className={styles.statValue}>{summary.open}</span>
            <span className={styles.statLabel}>à traiter</span>
          </li>
          <li className={styles.stat}>
            <span className={styles.statValue}>{summary.inProgress}</span>
            <span className={styles.statLabel}>en cours</span>
          </li>
          <li className={`${styles.stat} ${summary.contested > 0 ? styles.statUrgent : ""}`}>
            <span className={styles.statValue}>{summary.contested}</span>
            <span className={styles.statLabel}>contestés</span>
          </li>
          <li className={styles.stat}>
            <span className={styles.statValue}>{summary.archived}</span>
            <span className={styles.statLabel}>archivés</span>
          </li>
        </ul>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="group" aria-label="Catégorie">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={styles.tab}
              aria-pressed={filters.category === tab}
              onClick={() => setFilters((current) => ({ ...current, category: tab }))}
            >
              {tab !== "ALL" && <span aria-hidden="true">{REPORT_CATEGORY_DEFINITIONS[tab].icon}</span>}
              {categoryTabLabel(tab)}
              {counts[tab] > 0 && (
                <span className={styles.tabCount}>
                  {counts[tab]}
                  <span className="sr-only"> actifs</span>
                </span>
              )}
            </button>
          ))}
        </div>
        <div className={styles.segmented} role="group" aria-label="État">
          <button
            type="button"
            className={styles.segment}
            aria-pressed={filters.status === "ACTIVE"}
            onClick={() => setFilters((current) => ({ ...current, status: "ACTIVE" }))}
          >
            Actifs
          </button>
          <button
            type="button"
            className={styles.segment}
            aria-pressed={filters.status === "ARCHIVED"}
            onClick={() => setFilters((current) => ({ ...current, status: "ARCHIVED" }))}
          >
            Archivés
          </button>
          <button
            type="button"
            className={styles.chipToggle}
            aria-pressed={filters.contestedOnly}
            onClick={() => setFilters((current) => ({ ...current, contestedOnly: !current.contestedOnly }))}
          >
            <span aria-hidden="true">⚖</span> Contestés seulement
          </button>
          <button type="button" className={styles.segment} onClick={() => void load()} disabled={busy}>
            Actualiser
          </button>
        </div>
      </div>

      <div className={styles.layout}>
        <div>
          {reports === null ? (
            <p className={styles.empty} aria-busy="true">
              Chargement des signalements…
            </p>
          ) : visible.length === 0 ? (
            <p className={styles.empty}>
              {filters.status === "ACTIVE" ? "Rien à traiter ici. 🎉" : "Aucun signalement archivé."}
            </p>
          ) : (
            <ul className={styles.list} aria-label="Signalements">
              {visible.map((report) => {
                const definition = REPORT_CATEGORY_DEFINITIONS[report.category];
                const summaryLine = targetSummary(report);
                return (
                  <li key={report.id}>
                    <button
                      type="button"
                      className={styles.item}
                      aria-current={report.id === selectedId ? "true" : undefined}
                      onClick={() => select(report.id)}
                    >
                      <span className={styles.itemIcon} aria-hidden="true">
                        {definition.icon}
                      </span>
                      <span className={styles.itemTop}>
                        <span>
                          n° {report.id} · {definition.label}
                        </span>
                        <StatusPill status={report.status} contested={report.contests.length > 0} />
                      </span>
                      <span className={styles.itemMeta}>
                        {relativeAge(report.createdAt)}
                        {report.assignee ? ` · ${report.assignee.pseudo}` : ""}
                      </span>
                      <span className={styles.itemTargets}>{summaryLine || report.pagePath || "—"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div ref={detailRef}>
          {selected ? (
            <ReportDetail
              report={selected}
              busy={busy}
              onAction={onAction}
              onHideLogo={onHideLogo}
              onDeleteLogo={onDeleteLogo}
              onRestore={onRestore}
              onPurge={onPurge}
            />
          ) : (
            <p className={styles.empty}>
              {selectedId !== null && reports !== null
                ? "Ce signalement n'existe plus : il a été effacé."
                : "Choisis un signalement dans la liste pour l'ouvrir."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
