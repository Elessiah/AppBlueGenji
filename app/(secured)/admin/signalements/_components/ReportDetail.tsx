"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import {
  REPORT_CATEGORY_DEFINITIONS,
  REPORT_RESOLUTION_NOTE_MAX_LENGTH,
  REPORT_STATUS_LABELS,
  RIGHTS_RELATION_LABELS,
  type ReportAction,
  type ReportView,
} from "@/lib/shared/content-reports";
import { formatQuarantineDate } from "@/lib/shared/logo-quarantine";
import { relativeAge } from "../_lib/report-filters";
import { ReportTargetCard } from "./ReportTargetCard";
import { StatusPill } from "./StatusPill";
import styles from "../reports.module.css";

interface ReportDetailProps {
  report: ReportView;
  busy: boolean;
  onAction: (action: ReportAction, note?: string) => void;
  onHideLogo: (teamId: number) => void;
  onDeleteLogo: (teamId: number) => void;
  onRestore: (quarantineId: number) => void;
  onPurge: (quarantineId: number) => void;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Le dossier d'un signalement : tout ce qu'il faut pour trancher **sans
 * quitter la page** — ce qui est visé (avec les gestes sur le logo), ce qui est
 * reproché, qui l'a envoyé et comment le joindre, les contestations reçues —, et
 * les gestes de traitement en tête, là où l'œil tombe.
 */
export function ReportDetail({
  report,
  busy,
  onAction,
  onHideLogo,
  onDeleteLogo,
  onRestore,
  onPurge,
}: ReportDetailProps) {
  const titleId = useId();
  const noteId = useId();
  const definition = REPORT_CATEGORY_DEFINITIONS[report.category];
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");

  // Un autre dossier, un autre brouillon : la note ne suit pas la sélection.
  useEffect(() => {
    setResolving(false);
    setNote("");
  }, [report.id]);

  return (
    <article className={styles.detail} aria-labelledby={titleId}>
      <header className={styles.detailHead}>
        <div>
          <span className="eyebrow">
            <span aria-hidden="true">{definition.icon}</span> {definition.label.toUpperCase()}
          </span>
          <h2 id={titleId} className={styles.detailTitle}>
            Signalement n° {report.id}
          </h2>
        </div>
        <StatusPill status={report.status} contested={report.contests.length > 0} />
      </header>

      <div className={styles.actions} role="group" aria-label="Traitement du signalement">
        {report.status === "OPEN" && (
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionPrimary}`}
            disabled={busy}
            onClick={() => onAction("TAKE")}
          >
            Prendre en charge
          </button>
        )}
        {report.status === "IN_PROGRESS" && (
          <button type="button" className={styles.actionButton} disabled={busy} onClick={() => onAction("RELEASE")}>
            Remettre en attente
          </button>
        )}
        {report.status !== "RESOLVED" && !resolving && (
          <button type="button" className={styles.actionButton} disabled={busy} onClick={() => setResolving(true)}>
            Résoudre et archiver…
          </button>
        )}
        {report.status === "RESOLVED" && (
          <button type="button" className={styles.actionButton} disabled={busy} onClick={() => onAction("REOPEN")}>
            Rouvrir
          </button>
        )}
        {resolving && (
          <div className={styles.resolveBox}>
            <div className="field">
              <label htmlFor={noteId}>Décision prise (facultatif, visible des seuls administrateurs)</label>
              <textarea
                id={noteId}
                rows={3}
                value={note}
                maxLength={REPORT_RESOLUTION_NOTE_MAX_LENGTH}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Logo retiré, contestation acceptée, signalement infondé…"
              />
            </div>
            <div className={styles.targetActions}>
              <button
                type="button"
                className={`${styles.actionButton} ${styles.actionPrimary}`}
                disabled={busy}
                onClick={() => onAction("RESOLVE", note)}
              >
                Archiver
              </button>
              <button type="button" className={styles.actionButton} disabled={busy} onClick={() => setResolving(false)}>
                Annuler
              </button>
            </div>
            <p className={styles.muted}>
              Archivé, le signalement est effacé 30 jours plus tard — sauf s&apos;il tient encore un logo masqué, qu&apos;il
              garde jusqu&apos;à l&apos;échéance.
            </p>
          </div>
        )}
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>Reçu</dt>
          <dd>
            {formatDateTime(report.createdAt)} ({relativeAge(report.createdAt)})
          </dd>
        </div>
        <div>
          {/* Rouvert, un dossier garde qui l'avait pris : « pris en charge »
              tout court contredirait l'état « À traiter » juste au-dessus. */}
          <dt>{report.status === "OPEN" && report.assignee ? "Précédemment pris par" : "Pris en charge par"}</dt>
          <dd>{report.assignee ? report.assignee.pseudo : "Personne"}</dd>
        </div>
        <div>
          <dt>Page d&apos;origine</dt>
          <dd>
            {report.pagePath ? (
              <Link href={report.pagePath} target="_blank" rel="noreferrer" className={styles.inlineLink}>
                {report.pagePath}
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
        {report.resolvedAt && (
          <div>
            <dt>Archivé</dt>
            <dd>
              {formatDateTime(report.resolvedAt)}
              {report.purgeAt ? ` · effacé le ${formatQuarantineDate(new Date(report.purgeAt))}` : ""}
            </dd>
          </div>
        )}
      </dl>

      {report.resolutionNote && (
        <>
          {/* Un dossier rouvert (contestation) garde la décision d'avant : elle
              se lit comme telle, pas comme celle du jour. */}
          <h3 className={styles.sectionTitle}>
            {report.status === "RESOLVED" ? "Décision" : "Décision précédente"}
          </h3>
          <blockquote className={styles.quote}>{report.resolutionNote}</blockquote>
        </>
      )}

      {report.targets.length > 0 && (
        <>
          <h3 className={styles.sectionTitle}>Ce qui est visé</h3>
          <ul className={styles.targets}>
            {report.targets.map((target) => (
              <ReportTargetCard
                key={`${target.type}-${target.id}`}
                target={target}
                category={report.category}
                quarantines={
                  target.type === "TEAM"
                    ? report.quarantines.filter((quarantine) => quarantine.teamId === target.id)
                    : []
                }
                busy={busy}
                onHideLogo={onHideLogo}
                onDeleteLogo={onDeleteLogo}
                onRestore={onRestore}
                onPurge={onPurge}
              />
            ))}
          </ul>
        </>
      )}

      <h3 className={styles.sectionTitle}>Description</h3>
      <blockquote className={styles.quote}>{report.description}</blockquote>

      <h3 className={styles.sectionTitle}>Signalant</h3>
      <dl className={styles.facts}>
        <div>
          <dt>Compte</dt>
          <dd>
            {report.reporter ? (
              <Link
                href={`/joueurs/${report.reporter.userId}`}
                target="_blank"
                rel="noreferrer"
                className={styles.inlineLink}
              >
                {report.reporter.pseudo}
              </Link>
            ) : (
              "Visiteur sans compte"
            )}
          </dd>
        </div>
        {report.contactName && (
          <div>
            <dt>Nom</dt>
            <dd>{report.contactName}</dd>
          </div>
        )}
        <div>
          <dt>Adresse</dt>
          <dd>
            {report.contactEmail ? (
              <a href={`mailto:${report.contactEmail}`} className={styles.inlineLink}>
                {report.contactEmail}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        {report.rightsRelation && (
          <div>
            <dt>Qualité</dt>
            <dd>{RIGHTS_RELATION_LABELS[report.rightsRelation]}</dd>
          </div>
        )}
      </dl>

      {report.contests.length > 0 && (
        <>
          <h3 className={styles.sectionTitle}>Contestations ({report.contests.length})</h3>
          <ul className={styles.contests}>
            {report.contests.map((contest) => (
              <li key={contest.id} className={styles.contest}>
                <div className={styles.contestMeta}>
                  <span>
                    <span aria-hidden="true">⚖</span> n° {contest.id} · {formatDateTime(contest.createdAt)}
                  </span>
                  {contest.author ? (
                    <Link
                      href={`/joueurs/${contest.author.userId}`}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.inlineLink}
                    >
                      {contest.author.pseudo}
                    </Link>
                  ) : (
                    <span>Compte supprimé</span>
                  )}
                  {contest.contactEmail && (
                    <a href={`mailto:${contest.contactEmail}`} className={styles.inlineLink}>
                      {contest.contactEmail}
                    </a>
                  )}
                </div>
                <p>{contest.description}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className={styles.muted}>
        Statut : {REPORT_STATUS_LABELS[report.status]} · dernière modification {relativeAge(report.updatedAt)}.
      </p>
    </article>
  );
}
