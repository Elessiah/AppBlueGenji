import { REPORT_STATUS_LABELS, type ReportStatus } from "@/lib/shared/content-reports";
import styles from "../reports.module.css";

const TONES: Record<ReportStatus, string> = {
  OPEN: styles.pillOpen,
  IN_PROGRESS: styles.pillProgress,
  RESOLVED: styles.pillResolved,
};

/** État d'un signalement, et « contesté » à côté quand quelqu'un attend une réponse. */
export function StatusPill({ status, contested }: { status: ReportStatus; contested: boolean }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      <span className={`${styles.pill} ${TONES[status]}`}>{REPORT_STATUS_LABELS[status]}</span>
      {contested && (
        <span className={`${styles.pill} ${styles.pillContest}`}>
          <span aria-hidden="true">⚖</span> Contesté
        </span>
      )}
    </span>
  );
}
