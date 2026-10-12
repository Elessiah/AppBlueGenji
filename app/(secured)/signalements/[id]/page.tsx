"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CyberButton, CyberCard } from "@/components/cyber";
import { ReportProblemDialog } from "@/components/reports/ReportProblemDialog";
import { TargetThumb } from "@/components/reports/TargetPicker";
import {
  REPORT_CATEGORY_DEFINITIONS,
  REPORT_STATUS_PILL,
  reportTargetHref,
  type ConcernedReportView,
} from "@/lib/shared/content-reports";
import { isImmediateLogoRemoval } from "@/lib/shared/logo-quarantine";
import { INTL_LOCALE, type Locale } from "@/lib/shared/locales";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import { LocaleLink, useLocalePathname } from "@/components/i18n/locale-navigation";
import { richNodes } from "@/components/i18n/shell-text";
import { useReportsText } from "@/components/reports/reports-text";
import styles from "./concerned.module.css";

type LoadState = { status: "loading" } | { status: "missing" } | { status: "ready"; report: ConcernedReportView };

function formatDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(INTL_LOCALE[locale], { day: "numeric", month: "long", year: "numeric" });
}

/** L'échéance d'une suppression, **en heure de Paris** (`formatQuarantineDate`), dans la langue de la page. */
function formatPurgeDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(INTL_LOCALE[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
}

const strong = { strong: (chunks: React.ReactNode[]) => <strong>{chunks}</strong> };

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
  const text = useReportsText();
  const { t, locale } = text;
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
        <p className={styles.muted}>{t("concerned.loading")}</p>
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

  const { report } = state;
  const definition = REPORT_CATEGORY_DEFINITIONS[report.category];
  const hidden = report.quarantines.filter((quarantine) => quarantine.status === "HIDDEN");
  // Supprimé sans délai, ou masqué puis supprimé (échéance, contestation
  // rejetée) : la décision reste lisible, pas seulement tant qu'elle attend.
  const removed = report.quarantines.filter((quarantine) => quarantine.status === "PURGED");

  return (
    <section className={`fade-in container ${styles.page}`}>
      <span className="eyebrow">{t("concerned.eyebrow", { id: String(report.id) })}</span>
      <h1 className={`display ${styles.title}`}>{t("concerned.heading")}</h1>
      <p className={styles.lead}>{t("concerned.lead")}</p>

      {hidden.map((quarantine) =>
        quarantine.targetType === "TEAM" ? (
          <div /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ key={quarantine.id} className={styles.alert} role="status">
            {richNodes(
              text.rich(
                "concerned.logoHidden",
                {
                  name: quarantine.targetName,
                  since: formatDate(quarantine.hiddenAt, locale),
                  purge: formatPurgeDate(quarantine.purgeAfter, locale),
                },
                strong,
              ),
            )}
          </div>
        ) : (
          <div /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ key={quarantine.id} className={styles.alert} role="status">
            {richNodes(
              text.rich(
                "concerned.avatarHidden",
                { since: formatDate(quarantine.hiddenAt, locale), purge: formatPurgeDate(quarantine.purgeAfter, locale) },
                strong,
              ),
            )}
          </div>
        ),
      )}

      {removed.map((quarantine) =>
        quarantine.targetType === "TEAM" ? (
          <div /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ key={quarantine.id} className={styles.alert} role="status">
            {richNodes(
              text.rich(
                isImmediateLogoRemoval(quarantine) ? "concerned.logoRemovedImmediately" : "concerned.logoRemoved",
                { name: quarantine.targetName, date: formatDate(quarantine.closedAt ?? quarantine.hiddenAt, locale) },
                strong,
              ),
            )}
          </div>
        ) : (
          <div /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ key={quarantine.id} className={styles.alert} role="status">
            {richNodes(
              text.rich(
                isImmediateLogoRemoval(quarantine) ? "concerned.avatarRemovedImmediately" : "concerned.avatarRemoved",
                { date: formatDate(quarantine.closedAt ?? quarantine.hiddenAt, locale) },
                strong,
              ),
            )}
          </div>
        ),
      )}

      <CyberCard className={styles.card}>
        <dl className={styles.facts}>
          <div>
            <dt>{t("concerned.reason")}</dt>
            <dd>
              <span aria-hidden="true">{definition.icon}</span> {t(`categories.${report.category}.label`)}
            </dd>
          </div>
          <div>
            <dt>{t("concerned.received")}</dt>
            <dd>{formatDate(report.createdAt, locale)}</dd>
          </div>
          <div>
            <dt>{t("concerned.state")}</dt>
            <dd>
              <span className={`pill pill-${REPORT_STATUS_PILL[report.status]}`}>
                {t(`status.${report.status}`)}
              </span>
            </dd>
          </div>
        </dl>

        <h2 className={styles.subtitle}>{t("concerned.targetsTitle")}</h2>
        <ul className={styles.targets}>
          {report.targets.map((target) => (
            <li key={`${target.type}-${target.id}`}>
              <TargetThumb option={target} />
              {target.exists ? (
                <LocaleLink href={reportTargetHref(target)} className="entity-link">
                  {target.label}
                </LocaleLink>
              ) : (
                <span>{target.label}</span>
              )}
            </li>
          ))}
        </ul>

        <h2 className={styles.subtitle}>{t("concerned.reproachTitle")}</h2>
        <blockquote className={styles.quote}>{report.description}</blockquote>

        {report.myContests.length > 0 && (
          <>
            <h2 className={styles.subtitle}>{t("concerned.myContests")}</h2>
            <ul className={styles.contests}>
              {report.myContests.map((contest) => (
                <li key={contest.id}>
                  <span className={styles.muted}>{t("concerned.sentOn", { date: formatDate(contest.createdAt, locale) })}</span>
                  <p>{contest.description}</p>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className={styles.actions}>
          <CyberButton variant="primary" type="button" onClick={() => setContesting(true)}>
            {report.myContests.length > 0 ? t("concerned.addContest") : t("concerned.contest")}
          </CyberButton>
          <LocaleLink href={`${TERMS_PATH}#signalement`} className={styles.link}>
            {t("concerned.howItWorks")}
          </LocaleLink>
        </div>
        {report.status === "RESOLVED" && (
          <p className={styles.muted}>{t("concerned.archived")}</p>
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
