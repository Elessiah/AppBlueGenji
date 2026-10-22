"use client";

import { CyberButton, CyberCard } from "@/components/cyber";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { TargetThumb } from "@/components/reports/TargetPicker";
import { PlayerLink, TeamLink } from "@/components/entity-link";
import {
  REPORT_CATEGORY_RULES,
  REPORT_STATUS_PILL,
  reportTargetHref,
  type ConcernedReportView,
} from "@/lib/shared/content-reports";
import { formatQuarantineDate, isImmediateLogoRemoval } from "@/lib/shared/logo-quarantine";
import { INTL_LOCALE, type Locale } from "@/lib/shared/locales";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import { visibleText } from "@/lib/shared/visible-text";
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
  // Un nom enregistré avant `visibleText` n'est pas réécrit en base : nettoyé ici
  // (commandes de direction, invisibles), il ne réordonne pas la phrase.
  const label = visibleText(target.label);
  if (!target.exists) return <span>{label}</span>;
  if (target.type === "USER") return <PlayerLink userId={target.id}>{label}</PlayerLink>;
  if (target.type === "TEAM") return <TeamLink teamId={target.id}>{label}</TeamLink>;
  return (
    <LocaleLink href={reportTargetHref(target)} className="entity-link">
      {label}
    </LocaleLink>
  );
}

// `richNodes` : un lien (`<team>`) imbriqué dans le gras reçoit sa clé.
const strong = { strong: (chunks: React.ReactNode[]) => <strong>{richNodes(chunks)}</strong> };

/**
 * Le nom de l'équipe d'un logo, dans la phrase en gras : cliquable vers sa
 * fiche (`TeamLink`) tant que l'équipe existe (cible du signalement), texte
 * sinon — une équipe dissoute depuis n'a plus de fiche.
 */
function teamTags(teamId: number, exists: boolean) {
  return {
    ...strong,
    team: (chunks: React.ReactNode[]) =>
      exists ? <TeamLink teamId={teamId}>{richNodes(chunks)}</TeamLink> : <>{richNodes(chunks)}</>,
  };
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
  const definition = REPORT_CATEGORY_RULES[report.category];
  const hidden = report.quarantines.filter((quarantine) => quarantine.status === "HIDDEN");
  // Supprimé sans délai, ou masqué puis supprimé (échéance, contestation
  // rejetée) : la décision reste lisible, pas seulement tant qu'elle attend.
  const removed = report.quarantines.filter((quarantine) => quarantine.status === "PURGED");
  const teamExists = (teamId: number) =>
    report.targets.some((target) => target.type === "TEAM" && target.id === teamId && target.exists);

  return (
    <>
      <span className="eyebrow">{t("concerned.eyebrow", { id: String(report.id) })}</span>
      <h1 className={`display ${styles.title}`}>{t("concerned.heading")}</h1>
      {/* Le droit de contester reste visible ; les exemples passent derrière
          le « i » (INFO_HINTS.md). */}
      <div className={styles.lead}>
        <InfoHintRow>
          <p>{t("concerned.lead")}</p>
          <InfoHint id="concerned-lead-more" subject={t("concerned.contest")}>
            <p>{t("concerned.leadMore")}</p>
          </InfoHint>
        </InfoHintRow>
      </div>

      {/* Alertes rendues avec la page, jamais mises à jour : pas de région
          d'annonce (`role="status"`), qui relirait aussi le lien d'équipe. */}
      {hidden.map((quarantine) =>
        quarantine.targetType === "TEAM" ? (
          <div key={quarantine.id} className={styles.alert}>
            {richNodes(
              text.rich(
                "concerned.logoHidden",
                {
                  name: visibleText(quarantine.targetName),
                  since: formatParisDay(quarantine.hiddenAt, locale),
                  purge: formatParisDay(quarantine.purgeAfter, locale),
                },
                teamTags(quarantine.targetId, teamExists(quarantine.targetId)),
              ),
            )}
          </div>
        ) : (
          <div key={quarantine.id} className={styles.alert}>
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
          <div key={quarantine.id} className={styles.alert}>
            {richNodes(
              text.rich(
                isImmediateLogoRemoval(quarantine) ? "concerned.logoRemovedImmediately" : "concerned.logoRemoved",
                { name: visibleText(quarantine.targetName), date: formatParisDay(quarantine.closedAt ?? quarantine.hiddenAt, locale) },
                teamTags(quarantine.targetId, teamExists(quarantine.targetId)),
              ),
            )}
          </div>
        ) : (
          <div key={quarantine.id} className={styles.alert}>
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
        {/* Texte libre d'un tiers, sauts de ligne gardés : `dir="auto"` isole sa
            direction (une commande U+202E n'en déborde pas) — revue de sécurité du lot 9-2. */}
        <blockquote className={styles.quote} dir="auto">
          {report.description}
        </blockquote>

        {report.myContests.length > 0 && (
          <>
            <h2 className={styles.subtitle}>{t("concerned.myContests")}</h2>
            <ul className={styles.contests}>
              {report.myContests.map((contest) => (
                <li key={contest.id}>
                  <span className={styles.muted}>{t("concerned.sentOn", { date: formatParisDay(contest.createdAt, locale) })}</span>
                  <p dir="auto">{contest.description}</p>
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
