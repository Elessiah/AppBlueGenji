import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { CyberCard, Pill } from "@/components/cyber";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { RuleText } from "@/components/rules/RuleText";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import type { Locale } from "@/lib/shared/locales";
import type { MessageValues } from "@/lib/shared/message-format";
import {
  availableRuleModes,
  localizedCommonRules,
  localizedRuleModes,
  ruleTextValues,
  upcomingRuleModes,
  type RuleSection,
  type RulesMessages,
  type TournamentRuleMode,
} from "@/lib/shared/tournament-rules";
import { RULE_MODE_TONE, RULE_STATUS_PILL } from "@/lib/shared/rules-display";
import styles from "./page.module.css";
import tones from "./tones.module.css";

/**
 * La description ne citait que quatre modes sur les six que le registre expose
 * depuis : « BlueGenji Survie » et le multi-phases y manquaient, alors que ce
 * sont justement les deux qui n'existent nulle part ailleurs et qu'on cherche
 * par leur nom. Une description qui n'annonce pas ce que la page contient prive
 * la page des recherches qu'elle mérite.
 *
 * Page traduite (`/en/regles`, `docs/features/I18N.md`) : métadonnées dans la
 * langue de la requête, canonique et `hreflang` compris.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).rules;
  return pageMetadata({
    title: meta.indexTitle,
    description: meta.indexDescription,
    shareDescription: meta.indexShareDescription,
    path: "/regles",
    locale,
  });
}

function ModeCard({ mode, text }: Readonly<{ mode: TournamentRuleMode; text: RulesMessages["index"] }>) {
  const soon = mode.status === "SOON";
  return (
    <CyberCard lift ticks className={`${styles.modeCard} ${tones.tone}`} tone={RULE_MODE_TONE[mode.diagram]} style={{ height: "100%" }}>
      <LocaleLink href={`/regles/${mode.slug}`} className={styles.card}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>{mode.label}</h3>
          <Pill variant={RULE_STATUS_PILL[mode.status]}>{soon ? text.statusSoon : text.statusAvailable}</Pill>
        </div>
        <p className={styles.cardTagline}>{mode.tagline}</p>
        <dl className={styles.facts}>
          {mode.facts.slice(0, 4).map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <dt className={styles.factLabel}>{fact.label}</dt>
              <dd className={styles.factValue} style={{ margin: 0 }}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
        <span className={styles.cardCta}>{text.readRules}</span>
      </LocaleLink>
    </CyberCard>
  );
}

function CommonRuleCard({
  rule,
  locale,
  values,
}: Readonly<{ rule: RuleSection; locale: Locale; values: MessageValues }>) {
  return (
    <CyberCard className={styles.commonCard}>
      <h3 className={styles.commonTitle}>{rule.title}</h3>
      {rule.body.map((paragraph) => (
        <p key={paragraph} className={styles.commonBody}>
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
    </CyberCard>
  );
}

export default async function ReglesPage() {
  const locale = await requestLocale();
  const messages = messagesFor(locale).rules;
  const text = messages.index;
  const modes = localizedRuleModes(messages);
  const available = availableRuleModes(modes);
  const upcoming = upcomingRuleModes(modes);
  const values = ruleTextValues(locale, messages);

  return (
    <PublicPageShell>
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">{text.eyebrow}</span>
        <h1 className={`display ${styles.heroTitle}`}>
          {text.heroTitle}
          <br />
          <span className="text-gradient">{text.heroTitleAccent}</span>
        </h1>
        <p className={styles.heroLead}>{text.heroLead}</p>
      </section>

      <section className={styles.section} style={{ paddingTop: 0 }}>
        <div className={styles.head}>
          <div>
            <span className="eyebrow">{text.availableEyebrow}</span>
            <h2 className={styles.sectionTitle}>{text.availableTitle}</h2>
          </div>
          <p className={styles.headNote}>{text.availableNote}</p>
        </div>
        <div className={styles.grid}>
          {available.map((mode) => (
            <ModeCard key={mode.slug} mode={mode} text={text} />
          ))}
        </div>
      </section>

      {upcoming.length > 0 && (
        <section className={styles.section} style={{ paddingTop: 0 }}>
          <div className={styles.head}>
            <div>
              <span className="eyebrow">{text.upcomingEyebrow}</span>
              <h2 className={styles.sectionTitle}>{text.upcomingTitle}</h2>
            </div>
            <p className={styles.headNote}>{text.upcomingNote}</p>
          </div>
          <div className={styles.grid}>
            {upcoming.map((mode) => (
              <ModeCard key={mode.slug} mode={mode} text={text} />
            ))}
          </div>
        </section>
      )}

      <section className={styles.section} style={{ paddingTop: 0, paddingBottom: 72 }}>
        <div className={styles.head}>
          <div>
            <span className="eyebrow">{text.commonEyebrow}</span>
            <h2 className={styles.sectionTitle}>{text.commonTitle}</h2>
          </div>
          <p className={styles.headNote}>{text.commonNote}</p>
        </div>
        <div className={styles.commonGrid}>
          {localizedCommonRules(messages).map((rule) => (
            <CommonRuleCard key={rule.title} rule={rule} locale={locale} values={values} />
          ))}
        </div>
      </section>
    </PublicPageShell>
  );
}
