import { REPORT_STATUS_LABELS, REPORT_STATUS_PILL, type ReportStatus } from "@/lib/shared/content-reports";
import styles from "../reports.module.css";

/** État d'un signalement, et « contesté » à côté quand quelqu'un attend une réponse. */
export function StatusPill({ status, contested }: Readonly<{ status: ReportStatus; contested: boolean }>) {
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      <span className={`${styles.pill} cy-tag-${REPORT_STATUS_PILL[status]}`}>{REPORT_STATUS_LABELS[status]}</span>
      {contested && (
        <span className={`${styles.pill} ${styles.pillContest}`}>
          <span aria-hidden="true">⚖</span> Contesté
        </span>
      )}
    </span>
  );
}
