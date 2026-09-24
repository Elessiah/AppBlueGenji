"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { CyberButton, CyberCard } from "@/components/cyber";
import { ReportProblemDialog } from "@/components/reports/ReportProblemDialog";
import { TargetThumb } from "@/components/reports/TargetPicker";
import {
  REPORT_CATEGORY_DEFINITIONS,
  REPORT_STATUS_LABELS,
  reportTargetHref,
  type ConcernedReportView,
} from "@/lib/shared/content-reports";
import { formatQuarantineDate } from "@/lib/shared/logo-quarantine";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import styles from "./concerned.module.css";

type LoadState = { status: "loading" } | { status: "missing" } | { status: "ready"; report: ConcernedReportView };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

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
  const pathname = usePathname() ?? "/";
  const reportId = Number(params.id);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [contesting, setContesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/reports/${reportId}`, { cache: "no-store" });
      if (!response.ok) {
        setState({ status: "missing" });
        return;
      }
      const body = (await response.json()) as { report: ConcernedReportView };
      setState({ status: "ready", report: body.report });
    } catch {
      setState({ status: "missing" });
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <section className={`container ${styles.page}`} aria-busy="true">
        <p className={styles.muted}>Chargement du signalement…</p>
      </section>
    );
  }

  if (state.status === "missing") {
    return (
      <section className={`container ${styles.page}`}>
        <h1 className={`display ${styles.title}`}>Signalement introuvable</h1>
        <p className={styles.muted}>
          Ce signalement n&apos;existe pas, a été effacé, ou ne te concerne pas : seuls les joueurs visés et les
          membres des équipes visées peuvent le consulter.
        </p>
      </section>
    );
  }

  const { report } = state;
  const definition = REPORT_CATEGORY_DEFINITIONS[report.category];
  const hidden = report.quarantines.filter((quarantine) => quarantine.status === "HIDDEN");

  return (
    <section className={`fade-in container ${styles.page}`}>
      <span className="eyebrow">SIGNALEMENT N° {report.id}</span>
      <h1 className={`display ${styles.title}`}>Un signalement te concerne</h1>
      <p className={styles.lead}>
        L&apos;association Bluegenji Esport examine ce signalement. Si tu le crois infondé — tu détiens les droits
        sur le logo, le contenu est le tien, le contexte est différent —, conteste-le : ta réponse est lue par les
        administrateurs avant toute décision définitive.
      </p>

      {hidden.map((quarantine) => (
        <div key={quarantine.id} className={styles.alert} role="status">
          <strong>Le logo de « {quarantine.teamName} » est masqué</strong> depuis le {formatDate(quarantine.hiddenAt)}.
          Sans contestation de votre part, il sera <strong>supprimé définitivement le{" "}
          {formatQuarantineDate(new Date(quarantine.purgeAfter))}</strong>. Si la contestation aboutit, il est
          rétabli tel quel.
        </div>
      ))}

      <CyberCard className={styles.card}>
        <dl className={styles.facts}>
          <div>
            <dt>Motif</dt>
            <dd>
              <span aria-hidden="true">{definition.icon}</span> {definition.label}
            </dd>
          </div>
          <div>
            <dt>Reçu le</dt>
            <dd>{formatDate(report.createdAt)}</dd>
          </div>
          <div>
            <dt>État</dt>
            <dd>{REPORT_STATUS_LABELS[report.status]}</dd>
          </div>
        </dl>

        <h2 className={styles.subtitle}>Ce qui est visé</h2>
        <ul className={styles.targets}>
          {report.targets.map((target) => (
            <li key={`${target.type}-${target.id}`}>
              <TargetThumb option={target} />
              {target.exists ? (
                <Link href={reportTargetHref(target)} className="entity-link">
                  {target.label}
                </Link>
              ) : (
                <span>{target.label}</span>
              )}
            </li>
          ))}
        </ul>

        <h2 className={styles.subtitle}>Ce qui est reproché</h2>
        <blockquote className={styles.quote}>{report.description}</blockquote>

        {report.myContests.length > 0 && (
          <>
            <h2 className={styles.subtitle}>Tes contestations</h2>
            <ul className={styles.contests}>
              {report.myContests.map((contest) => (
                <li key={contest.id}>
                  <span className={styles.muted}>Envoyée le {formatDate(contest.createdAt)}</span>
                  <p>{contest.description}</p>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className={styles.actions}>
          <CyberButton variant="primary" type="button" onClick={() => setContesting(true)}>
            {report.myContests.length > 0 ? "Ajouter une contestation" : "Contester ce signalement"}
          </CyberButton>
          <Link href={`${TERMS_PATH}#signalement`} className={styles.link}>
            Comment se passe un signalement ?
          </Link>
        </div>
        {report.status === "RESOLVED" && (
          <p className={styles.muted}>
            Ce signalement est archivé : le contester le rouvre, et l&apos;association en est prévenue.
          </p>
        )}
      </CyberCard>

      {contesting && (
        <ReportProblemDialog
          pathname={pathname}
          authenticated
          contestOf={report.id}
          onClose={() => setContesting(false)}
          onSubmitted={() => void load()}
        />
      )}
    </section>
  );
}
