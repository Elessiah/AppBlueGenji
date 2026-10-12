"use client";

import { CyberButton, CyberCard } from "@/components/cyber";
import { TargetThumb } from "@/components/reports/TargetPicker";
import { PlayerLink, TeamLink } from "@/components/entity-link";
import {
  REPORT_CATEGORY_DEFINITIONS,
  REPORT_STATUS_PILL,
  reportTargetHref,
  type ConcernedReportView,
} from "@/lib/shared/content-reports";
import { formatQuarantineDate, isImmediateLogoRemoval } from "@/lib/shared/logo-quarantine";
import { INTL_LOCALE, type Locale } from "@/lib/shared/locales";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { richNodes } from "@/components/i18n/shell-text";
import { useReportsText } from "@/components/reports/reports-text";
import styles from "../concerned.module.css";

/**
 * Les dates de la page (réception, contestations, vie d'une image), **en heure
 * de Paris** comme partout ailleurs (`formatQuarantineDate`), dans la langue de
 * la page : un même instant se lit au même jour d'une ligne à l'autre.
 */
function formatParisDay(iso: string, locale: Locale): string {
  return formatQuarantineDate(new Date(iso), INTL_LOCALE[locale]);
}

/** Le nom d'une cible : fiche d'un joueur ou d'une équipe par son lien dédié, tournoi par son adresse. */
function TargetName({ target }: Readonly<{ target: ConcernedReportView["targets"][number] }>) {
  if (!target.exists) return <span>{target.label}</span>;
  if (target.type === "USER") return <PlayerLink userId={target.id}>{target.label}</PlayerLink>;
  if (target.type === "TEAM") return <TeamLink teamId={target.id}>{target.label}</TeamLink>;
  return (
    <LocaleLink href={reportTargetHref(target)} className="entity-link">
      {target.label}
    </LocaleLink>
  );
}

const strong = { strong: (chunks: React.ReactNode[]) => <strong>{chunks}</strong> };

/** Le nom de l'équipe d'un logo, cliquable vers sa fiche (`TeamLink`), dans la phrase en gras. */
function teamTags(teamId: number) {
  return { ...strong, team: (chunks: React.ReactNode[]) => <TeamLink teamId={teamId}>{chunks}</TeamLink> };
}

/**
 * Le signalement lu par la personne qu'il vise, une fois chargé : ce qui est
 * reproché et à quoi, les images masquées ou supprimées à sa suite, ses
 * contestations et le geste pour en ajouter une. Séparé de la page (qui
 * charge, et ouvre le formulaire de contestation) pour se rendre seul.
 */
export function ConcernedReport({
  report,
  onContest,
}: Readonly<{ report: ConcernedReportView; onContest: () => void }>) {
  const text = useReportsText();
  const { t, locale } = text;
  const definition = REPORT_CATEGORY_DEFINITIONS[report.category];
  const hidden = report.quarantines.filter((quarantine) => quarantine.status === "HIDDEN");
  // Supprimé sans délai, ou masqué puis supprimé (échéance, contestation
  // rejetée) : la décision reste lisible, pas seulement tant qu'elle attend.
  const removed = report.quarantines.filter((quarantine) => quarantine.status === "PURGED");

  return (
    <>
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
                  since: formatParisDay(quarantine.hiddenAt, locale),
                  purge: formatParisDay(quarantine.purgeAfter, locale),
                },
                teamTags(quarantine.targetId),
              ),
            )}
          </div>
        ) : (
          <div /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ key={quarantine.id} className={styles.alert} role="status">
            {richNodes(
              text.rich(
                "concerned.avatarHidden",
                { since: formatParisDay(quarantine.hiddenAt, locale), purge: formatParisDay(quarantine.purgeAfter, locale) },
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
                { name: quarantine.targetName, date: formatParisDay(quarantine.closedAt ?? quarantine.hiddenAt, locale) },
                teamTags(quarantine.targetId),
              ),
            )}
          </div>
        ) : (
          <div /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ key={quarantine.id} className={styles.alert} role="status">
            {richNodes(
              text.rich(
                isImmediateLogoRemoval(quarantine) ? "concerned.avatarRemovedImmediately" : "concerned.avatarRemoved",
                { date: formatParisDay(quarantine.closedAt ?? quarantine.hiddenAt, locale) },
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
            <dd>{formatParisDay(report.createdAt, locale)}</dd>
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
              <TargetName target={target} />
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
                  <span className={styles.muted}>{t("concerned.sentOn", { date: formatParisDay(contest.createdAt, locale) })}</span>
                  <p>{contest.description}</p>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className={styles.actions}>
          <CyberButton variant="primary" type="button" onClick={onContest}>
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
    </>
  );
}
