import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { ruleModeShareCardKey } from "@/lib/shared/page-share-cards";
import { notFound } from "next/navigation";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { RuleDiagramFigure } from "@/components/rules/RuleDiagram";
import { RuleText } from "@/components/rules/RuleText";
import { RulesToc } from "@/components/rules/RulesToc";
import {
  RULE_MODE_DEFINITIONS,
  TOURNAMENT_RULE_MODES,
  localizedCommonRules,
  localizedRuleModes,
  ruleModeBySlug,
  ruleTextValues,
  type RuleSection,
} from "@/lib/shared/tournament-rules";
import { JsonLd } from "@/components/seo/JsonLd";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { localeHref, type Locale } from "@/lib/shared/locales";
import { formatMessage, type MessageValues } from "@/lib/shared/message-format";
import { breadcrumbJsonLd } from "@/lib/shared/structured-data";
import { getCurrentUser } from "@/lib/server/auth";
import { getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";
import {
  parseRulesTournamentParam,
  type TournamentSettingsGroup,
} from "@/lib/shared/tournament-settings";
import { localizedTournamentSettingsGroups } from "@/lib/shared/tournament-settings-text";
import {
  RULES_PAGE_ANCHORS,
  ruleSectionAnchors,
  rulesPageOutline,
} from "@/lib/shared/rules-page-outline";
import { RULE_MODE_TONE } from "@/lib/shared/rules-display";
import styles from "./page.module.css";
import tones from "../tones.module.css";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type TournamentSettingsView = { id: number; name: string; groups: TournamentSettingsGroup[] };

/**
 * Réglages du tournoi désigné par `?tournoi=<id>` — le lien du bouton d'aide
 * d'une fiche de tournoi le porte. Même règle de lecture que la fiche : il faut
 * être connecté (l'espace des tournois l'est), et un tournoi non publié n'existe
 * que pour la permission `tournaments`. Tout refus, toute panne de lecture, rend
 * simplement la page générale du mode.
 */
async function loadTournamentSettings(
  tournamentId: number | null,
  locale: Locale,
): Promise<TournamentSettingsView | null> {
  if (tournamentId === null) return null;
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    const snapshot = await getVisibleTournamentSnapshot(tournamentId, {
      canManage: can(user, "tournaments"),
    });
    if (!snapshot) return null;
    return {
      id: snapshot.card.id,
      name: snapshot.card.name,
      // Dans la langue de la page (lot 8a-2) : le français reste celui de
      // `tournamentSettingsGroups`.
      groups: localizedTournamentSettingsGroups(
        {
          card: snapshot.card,
          phases: snapshot.phases,
          swiss: snapshot.swiss,
          endurance: snapshot.endurance,
          seedingSource: snapshot.seedingSource,
        },
        locale,
        messagesFor(locale),
      ),
    };
  } catch {
    return null;
  }
}

/**
 * Un slug par mode, le même dans les deux langues (`/en/regles/<slug>`).
 *
 * Les pages ne sont pas prérendues pour autant : la mise en page racine lit les
 * en-têtes de la requête (nonce CSP, langue `x-bg-locale`), si bien que chaque
 * page est rendue à la demande, dans la langue de l'adresse.
 */
export function generateStaticParams(): { slug: string }[] {
  return RULE_MODE_DEFINITIONS.map((mode) => ({ slug: mode.slug }));
}

export async function generateMetadata({ params }: Pick<PageProps, "params">): Promise<Metadata> {
  const { slug } = await params;
  const locale = await requestLocale();
  const messages = messagesFor(locale).rules;
  const mode = ruleModeBySlug(slug, localizedRuleModes(messages));
  if (!mode) return pageMetadata({
    title: messages.meta.indexTitle,
    description: messages.meta.unknownModeDescription,
    path: "/regles",
    shareCard: "rules",
    locale,
  });
  return pageMetadata({
    title: formatMessage(locale, messages.meta.modeTitle, { mode: mode.label }),
    description: mode.tagline,
    path: `/regles/${mode.slug}`,
    shareCard: ruleModeShareCardKey(mode.slug),
    locale,
  });
}

function RuleBody({ rule, locale, values }: Readonly<{ rule: RuleSection; locale: Locale; values: MessageValues }>) {
  return (
    <>
      {rule.body.map((paragraph) => (
        <p key={paragraph} className={styles.ruleBody}>
          <RuleText text={paragraph} locale={locale} values={values} />
        </p>
      ))}
      {rule.bullets && (
        <ul className={styles.bullets}>
          {rule.bullets.map((bullet) => (
            <li key={bullet}>
              <RuleText text={bullet} locale={locale} values={values} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SectionHead({ id, eyebrow, title }: Readonly<{ id: string; eyebrow: string; title: string }>) {
  return (
    <div className={styles.sectionHead}>
      <span className="eyebrow">{eyebrow}</span>
      <h2 id={id} className={styles.sectionTitle}>
        {title}
      </h2>
    </div>
  );
}

/**
 * Une page de règles se lit dans un ordre : ce qui vaut pour **ce** tournoi
 * (s'il est désigné), l'essentiel du mode, son détail, puis ce qui est commun à
 * tous. Le sommaire (`RulesToc`) dit où l'on est ; les règles communes, les
 * mêmes sur chaque page, sont repliées pour ne pas noyer celles du mode.
 */
export default async function RuleModePage({ params, searchParams }: Readonly<PageProps>) {
  const { slug } = await params;
  const locale = await requestLocale();
  const messages = messagesFor(locale).rules;
  const modes = localizedRuleModes(messages);
  const mode = ruleModeBySlug(slug, modes);
  if (!mode) notFound();
  const text = messages.mode;
  const values = ruleTextValues(locale, messages);
  // Les ancres descendent des titres **français**, dans les deux langues : un
  // lien vers une section garde son sens d'une langue à l'autre.
  const frenchMode = ruleModeBySlug(slug, TOURNAMENT_RULE_MODES) ?? mode;

  const tournamentSettings = await loadTournamentSettings(
    parseRulesTournamentParam((await searchParams).tournoi),
    locale,
  );

  const others = modes.filter((m) => m.slug !== mode.slug);
  const ruleAnchors = ruleSectionAnchors(frenchMode.sections);
  const outline = rulesPageOutline(mode, {
    hasTournamentSettings: tournamentSettings !== null,
    labels: messages.toc,
    anchors: ruleAnchors,
  });

  return (
    <PublicPageShell>
      {/*
        Le fil d'Ariane est ce qui remplace, dans un résultat de recherche,
        l'adresse brute par « bluegenji-esport.fr › Règles › Ronde suisse ».
        Une page de règles arrive rarement par l'accueil : elle doit dire seule
        d'où elle vient.

        Chemins dans la langue de la page (`/en/regles/…` sous `/en`), noms
        traduits. La page lisant la langue de la requête, elle est rendue à la
        demande : la racine du site (`siteCanonicalBase()`) est lue au rendu, et
        non figée à la compilation.
      */}
      <JsonLd
        data={breadcrumbJsonLd(siteCanonicalBase(), [
          { name: messages.breadcrumb.home, path: localeHref("/", locale) },
          { name: messages.breadcrumb.rules, path: localeHref("/regles", locale) },
          { name: mode.label, path: localeHref(`/regles/${mode.slug}`, locale) },
        ])}
      />

      <section className={`${styles.shell} ${styles.hero} ${tones.tone}`} data-tone={RULE_MODE_TONE[mode.diagram]}>
        <div className="fabric" />
        <LocaleLink href="/regles" className={styles.back}>
          {text.back}
        </LocaleLink>
        <h1 className={`display ${styles.title}`}>
          <span className="text-gradient">{mode.label}</span>
        </h1>
        <p className={styles.tagline}>{mode.tagline}</p>
        {mode.status === "SOON" && (
          <p className={styles.soonBanner}>
            <span aria-hidden="true">⏳</span>
            <span>
              <RuleText text={text.soonBanner} locale={locale} />
            </span>
          </p>
        )}
        <dl className={styles.facts}>
          {mode.facts.map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <dt className={styles.factLabel}>{fact.label}</dt>
              <dd className={styles.factValue}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className={`${styles.shell} ${styles.layout} ${tones.tone}`} data-tone={RULE_MODE_TONE[mode.diagram]}>
        <RulesToc entries={outline} label={messages.toc.label} heading={messages.toc.heading} />

        <div className={styles.content}>
          {tournamentSettings && (
            <section className={styles.section} aria-labelledby={RULES_PAGE_ANCHORS.tournament}>
              <div className={styles.tournamentPanel}>
                <div className={styles.tournamentHead}>
                  <span className="eyebrow">{text.tournamentEyebrow}</span>
                  <h2 id={RULES_PAGE_ANCHORS.tournament} className={styles.tournamentTitle}>
                    {formatMessage(locale, text.tournamentTitle, { name: tournamentSettings.name })}
                  </h2>
                  <p className={styles.settingsIntro}>{text.tournamentIntro}</p>
                  <LocaleLink
                    href={`/tournois/${tournamentSettings.id}`}
                    className={`entity-link ${styles.backToTournament}`}
                  >
                    {text.backToTournament}
                  </LocaleLink>
                </div>
                {tournamentSettings.groups.map((group) => (
                  <div key={group.title} className={styles.settingsGroup}>
                    <h3 className={styles.settingsGroupTitle}>{group.title}</h3>
                    <dl className={styles.settings}>
                      {group.settings.map((setting) => (
                        <div key={setting.label} className={styles.setting}>
                          <dt className={styles.factLabel}>{setting.label}</dt>
                          <dd className={styles.settingValue}>{setting.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={styles.section} aria-labelledby={RULES_PAGE_ANCHORS.essentials}>
            <SectionHead id={RULES_PAGE_ANCHORS.essentials} eyebrow={text.essentialsEyebrow} title={text.essentialsTitle} />
            <ol className={styles.principles}>
              {mode.principles.map((principle, i) => (
                <li key={principle} className={styles.principle}>
                  <span className={styles.principleNum} aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>
                    <RuleText text={principle} locale={locale} values={values} />
                  </span>
                </li>
              ))}
            </ol>
            <RuleDiagramFigure
              diagram={mode.diagram}
              caption={formatMessage(locale, mode.diagramCaption, values)}
              text={messages.diagram}
              locale={locale}
            />
          </section>

          <section className={styles.section} aria-labelledby={RULES_PAGE_ANCHORS.details}>
            <SectionHead id={RULES_PAGE_ANCHORS.details} eyebrow={text.detailsEyebrow} title={text.detailsTitle} />
            {mode.sections.map((rule, i) => (
              <article key={rule.title} className={styles.rule} aria-labelledby={ruleAnchors[i]}>
                <h3 id={ruleAnchors[i]} className={styles.ruleTitle}>
                  {rule.title}
                </h3>
                <RuleBody rule={rule} locale={locale} values={values} />
              </article>
            ))}
          </section>

          <section className={styles.section} aria-labelledby={RULES_PAGE_ANCHORS.common}>
            <SectionHead id={RULES_PAGE_ANCHORS.common} eyebrow={text.commonEyebrow} title={text.commonTitle} />
            <p className={styles.sectionIntro}>{text.commonIntro}</p>
            <div className={styles.accordion}>
              {localizedCommonRules(messages).map((rule) => (
                <details key={rule.title} className={styles.commonRule}>
                  <summary className={styles.commonSummary}>{rule.title}</summary>
                  <div className={styles.commonBody}>
                    <RuleBody rule={rule} locale={locale} values={values} />
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section className={styles.section} aria-labelledby={RULES_PAGE_ANCHORS.others}>
            <SectionHead id={RULES_PAGE_ANCHORS.others} eyebrow={text.othersEyebrow} title={text.othersTitle} />
            <div className={styles.otherModes}>
              {others.map((other) => (
                <LocaleLink
                  key={other.slug}
                  href={`/regles/${other.slug}`}
                  className={`${styles.otherMode} ${tones.tone}`}
                  data-tone={RULE_MODE_TONE[other.diagram]}
                >
                  {other.label}
                  {other.status === "SOON" && <span className={styles.soonTag}>{text.soonTag}</span>}
                </LocaleLink>
              ))}
            </div>
          </section>
        </div>
      </div>
    </PublicPageShell>
  );
}
