"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
// Import direct, voulu (revue de performance du lot 9-2) : contester est
// l'action de cette page, ses textes sont déjà dans le morceau (la vue les
// lit) ; chargé à l'ouverture, le formulaire ajouterait une attente et un échec
// possible à ce geste pour ~4 Ko de code.
import { ReportProblemDialog } from "@/components/reports/ReportProblemDialog";
import { primeReportDialog } from "@/components/reports/report-form-loader";
import type { ConcernedReportView } from "@/lib/shared/content-reports";
import { useLocalePathname } from "@/components/i18n/locale-navigation";
import { useReportsText } from "@/components/reports/reports-text";
import { concernedReportLoadFailure } from "@/lib/shared/concerned-report-load";
import { ConcernedReport } from "./_components/ConcernedReport";
import styles from "./concerned.module.css";

// Le pied de page de cette page ne retélécharge pas le formulaire qu'elle porte déjà.
primeReportDialog(ReportProblemDialog);

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error" }
  | { status: "ready"; report: ConcernedReportView };

/**
 * Un signalement, pour une personne qu'il vise — la page vers laquelle mène le
 * message privé qui l'a prévenue.
 *
 * Elle dit ce qui est reproché et à quoi (seulement ce qui la concerne), si un
 * logo de son équipe est masqué et jusqu'à quand, et comment contester. Rien de
 * l'auteur du signalement : ni compte, ni nom, ni adresse.
 */
export default function ConcernedReportPage() {
  const params = useParams<{ id: string }>();
  // Chemin sans préfixe de langue, comme le bouton du pied de page.
  const { path: pathname } = useLocalePathname();
  const { t } = useReportsText();
  const reportId = Number(params.id);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [contesting, setContesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/reports/${reportId}`, { cache: "no-store" });
      if (!response.ok) {
        setState({ status: concernedReportLoadFailure(response.status) });
        return;
      }
      const body = (await response.json()) as { report: ConcernedReportView };
      setState({ status: "ready", report: body.report });
    } catch {
      setState({ status: concernedReportLoadFailure(null) });
    }
  }, [reportId]);

  /** « Réessayer » : retour à l'état de chargement (le focus reste sur la page, annoncé par `aria-busy`). */
  const retry = useCallback(() => {
    setState({ status: "loading" });
    void load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <section className={`container ${styles.page}`} aria-busy="true">
        <p className={styles.muted}>{t("concerned.loading")}</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className={`container ${styles.page}`}>
        <h1 className={`display ${styles.title}`}>{t("concerned.errorTitle")}</h1>
        <p className={styles.muted}>{t("concerned.errorBody")}</p>
        <div>
          <button type="button" className="btn" onClick={retry}>
            {t("concerned.retry")}
          </button>
        </div>
      </section>
    );
  }

  if (state.status === "missing") {
    return (
      <section className={`container ${styles.page}`}>
        <h1 className={`display ${styles.title}`}>{t("concerned.notFoundTitle")}</h1>
        <p className={styles.muted}>{t("concerned.notFoundBody")}</p>
      </section>
    );
  }

  return (
    <section className={`fade-in container ${styles.page}`}>
      <ConcernedReport report={state.report} onContest={() => setContesting(true)} />

      {contesting && (
        <ReportProblemDialog
          pathname={pathname}
          authenticated
          contestOf={state.report.id}
          onClose={() => setContesting(false)}
          onSubmitted={() => void load()}
        />
      )}
    </section>
  );
}
