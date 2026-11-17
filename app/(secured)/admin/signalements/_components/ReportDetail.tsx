"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  REPORT_RESOLUTION_NOTE_MAX_LENGTH,
  REPORT_RETENTION_DAYS_AFTER_RESOLUTION,
  REPORT_STATUS_LABELS,
  RIGHTS_RELATION_LABELS,
  reportFollowUpDuty,
  type ReportAction,
  type ReportTargetRef,
  type ReportView,
} from "@/lib/shared/content-reports";
import { REPORT_CATEGORY_DEFINITIONS } from "@/lib/shared/content-report-categories";
import { leadsToApi } from "@/lib/shared/safe-redirect";
import { LOGO_QUARANTINE_MONTHS, formatQuarantineDate, type ContestOutcome } from "@/lib/shared/logo-quarantine";
import { relativeAge } from "../_lib/report-filters";
import {
  ACTIONS_SCOPE,
  focusAfterGesture,
  gestureState,
  pressedGestureOf,
  reportGesture,
  type PressedGesture,
} from "../_lib/report-gestures";
import { BusyButton } from "@/components/ui/busy-button";
import { ModerationPlayerLink } from "./ModerationPlayerLink";
import { ReportTargetCard } from "./ReportTargetCard";
import { StatusPill } from "./StatusPill";
import styles from "../reports.module.css";

interface ReportDetailProps {
  report: ReportView;
  /** Geste en attente (`report-gestures.ts`), `null` hors envoi. */
  pending: string | null;
  onAction: (action: ReportAction, note?: string) => void;
  onHideLogo: (target: ReportTargetRef) => void;
  onDeleteLogo: (target: ReportTargetRef) => void;
  onRestore: (quarantineId: number) => void;
  onPurge: (quarantineId: number) => void;
  onContestOutcome: (quarantineId: number, outcome: ContestOutcome) => void;
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
  pending,
  onAction,
  onHideLogo,
  onDeleteLogo,
  onRestore,
  onPurge,
  onContestOutcome,
}: Readonly<ReportDetailProps>) {
  const titleId = useId();
  const noteId = useId();
  const definition = REPORT_CATEGORY_DEFINITIONS[report.category];
  // Le site n'envoie aucun courriel : ce retour part de l'association, à la main.
  const followUp = reportFollowUpDuty(report.category);
  // Calculé par le serveur sur `reporter_user_id`, comme la purge : le pseudo
  // de l'auteur peut manquer quand son compte, lui, compte encore.
  const heldForNotifier = report.heldForNotifier;
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  const busy = pending !== null;
  const articleRef = useRef<HTMLElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const resolveRef = useRef<HTMLButtonElement>(null);
  // Le bouton pressé disparaît souvent au retour du geste (« Prendre en
  // charge » devient « Remettre en attente ») : le focus tomberait sur la page.
  const pressed = useRef<PressedGesture | null>(null);
  // Ouvrir ou refermer la note d'archivage retire le bouton pressé : le focus
  // va au champ, puis revient à « Résoudre et archiver… ».
  const focusAfterToggle = useRef<"note" | "resolve" | null>(null);

  // Un autre dossier, un autre brouillon : la note ne suit pas la sélection.
  useEffect(() => {
    setResolving(false);
    setNote("");
  }, [report.id]);

  // Archivé (ici ou par un autre administrateur), le dossier n'a plus rien à
  // archiver : la boîte se referme, sans quoi « Archiver » mènerait à un refus.
  // Les autres changements d'état (prise en charge) laissent la note en cours.
  const archived = report.status === "RESOLVED";
  useEffect(() => {
    if (!archived) return;
    setResolving(false);
    setNote("");
  }, [archived]);

  // Avant la peinture : aucune image où le focus est perdu.
  useLayoutEffect(() => {
    const target = focusAfterToggle.current;
    focusAfterToggle.current = null;
    if (target === "note") noteRef.current?.focus();
    else if (target === "resolve") resolveRef.current?.focus();
  }, [resolving]);

  useLayoutEffect(() => {
    const last = pressed.current;
    if (!last) return;
    const root = articleRef.current;
    const active = document.activeElement;
    // Un focus parti ailleurs entre-temps (la liste, un lien) n'est pas repris.
    if (root && (active === null || active === document.body)) focusAfterGesture(root, last)?.focus();
    if (pending === null) pressed.current = null;
  }, [report, pending]);

  const openResolve = () => {
    focusAfterToggle.current = "note";
    setResolving(true);
  };
  const cancelResolve = () => {
    focusAfterToggle.current = "resolve";
    setResolving(false);
  };

  return (
    <article
      ref={articleRef}
      className={styles.detail}
      aria-labelledby={titleId}
      onClickCapture={(event) => {
        const gesture = pressedGestureOf(event.target);
        if (gesture) pressed.current = gesture;
      }}
    >
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

      <fieldset
        className={`native-group ${styles.actions}`}
        aria-label="Traitement du signalement"
        data-focus-scope={ACTIONS_SCOPE}
      >
        {report.status === "OPEN" && (
          <BusyButton
            {...gestureState(pending, reportGesture.action("TAKE"))}
            data-gesture={reportGesture.action("TAKE")}
            className={`${styles.actionButton} ${styles.actionPrimary}`}
            onClick={() => onAction("TAKE")}
          >
            Prendre en charge
          </BusyButton>
        )}
        {report.status === "IN_PROGRESS" && (
          <BusyButton
            {...gestureState(pending, reportGesture.action("RELEASE"))}
            data-gesture={reportGesture.action("RELEASE")}
            className={styles.actionButton}
            onClick={() => onAction("RELEASE")}
          >
            Remettre en attente
          </BusyButton>
        )}
        {report.status !== "RESOLVED" && !resolving && (
          <BusyButton ref={resolveRef} busy={false} blocked={busy} className={styles.actionButton} onClick={openResolve}>
            Résoudre et archiver…
          </BusyButton>
        )}
        {report.status === "RESOLVED" && (
          <BusyButton
            {...gestureState(pending, reportGesture.action("REOPEN"))}
            data-gesture={reportGesture.action("REOPEN")}
            className={styles.actionButton}
            onClick={() => onAction("REOPEN")}
          >
            Rouvrir
          </BusyButton>
        )}
        {resolving && !archived && (
          <div className={styles.resolveBox}>
            <div className="field">
              <label htmlFor={noteId}>Décision prise (facultatif, visible des seuls administrateurs)</label>
              <textarea
                ref={noteRef}
                id={noteId}
                rows={3}
                // Ce qui est affiché est ce qui part (`BUSY_BUTTONS.md`).
                readOnly={busy}
                value={note}
                maxLength={REPORT_RESOLUTION_NOTE_MAX_LENGTH}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Logo retiré, contestation acceptée, signalement infondé…"
              />
            </div>
            <div className={styles.targetActions}>
              <BusyButton
                {...gestureState(pending, reportGesture.action("RESOLVE"))}
                data-gesture={reportGesture.action("RESOLVE")}
                className={`${styles.actionButton} ${styles.actionPrimary}`}
                onClick={() => onAction("RESOLVE", note)}
              >
                Archiver
              </BusyButton>
              <BusyButton busy={false} blocked={busy} className={styles.actionButton} onClick={cancelResolve}>
                Annuler
              </BusyButton>
            </div>
            <p className={styles.muted}>
              {/* La durée que tient la purge (`reportRetainedUntil`) : une notification de
                  droit d'auteur ou de modération envoyée depuis un compte attend la fin du
                  délai où son auteur peut contester la décision. */}
              {heldForNotifier
                ? `Archivé, le signalement est effacé ${LOGO_QUARANTINE_MONTHS} mois plus tard, le temps que son auteur puisse contester la décision — au-delà de ces ${LOGO_QUARANTINE_MONTHS} mois s'il tient une image (logo, avatar) masquée ou supprimée encore contestable.`
                : `Archivé, le signalement est effacé ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours plus tard — au-delà de ces ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours s'il tient une image (logo, avatar) masquée ou supprimée encore contestable.`}
            </p>
          </div>
        )}
      </fieldset>

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
            {/* Un chemin d'API (dossier enregistré avant la règle de
                normalizeReportPagePath) se lit, il ne s'ouvre pas d'un clic. */}
            {report.pagePath && !leadsToApi(report.pagePath) ? (
              <Link href={report.pagePath} target="_blank" rel="noreferrer" className={styles.inlineLink}>
                {report.pagePath}
                <span className="sr-only"> (nouvel onglet)</span>
              </Link>
            ) : (
              (report.pagePath ?? "—")
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
                quarantines={report.quarantines.filter(
                  (quarantine) => quarantine.targetType === target.type && quarantine.targetId === target.id,
                )}
                pending={pending}
                onHideLogo={onHideLogo}
                onDeleteLogo={onDeleteLogo}
                onRestore={onRestore}
                onPurge={onPurge}
                onContestOutcome={onContestOutcome}
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
              <ModerationPlayerLink userId={report.reporter.userId} pseudo={report.reporter.pseudo} />
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
        {followUp && (
          <div>
            <dt>Retour dû</dt>
            <dd>{followUp}</dd>
          </div>
        )}
      </dl>

      {report.contests.length > 0 && (
        <>
          <h3 className={styles.sectionTitle}>Contestations ({report.contests.length})</h3>
          {/* Une contestation n'est jamais listée seule : son retour dû se
              rappelle ici, sous le signalement qu'elle vise. */}
          <p className={styles.muted}>Retour dû : {reportFollowUpDuty("CONTEST")}</p>
          <ul className={styles.contests}>
            {report.contests.map((contest) => (
              <li key={contest.id} className={styles.contest}>
                <div className={styles.contestMeta}>
                  <span>
                    <span aria-hidden="true">⚖</span> n° {contest.id} · {formatDateTime(contest.createdAt)}
                  </span>
                  {contest.author ? (
                    <ModerationPlayerLink userId={contest.author.userId} pseudo={contest.author.pseudo} />
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
