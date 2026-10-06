import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { AboutSection } from "@/components/cyber/landing/AboutSection";
import { CyberButton } from "@/components/cyber";
import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { listBureauMembers } from "@/lib/server/bureau-service";
import { listAboutStats } from "@/lib/server/about-stats-service";
import { listAboutPillars } from "@/lib/server/about-pillars-service";
import { getSiteCopy, getSiteCopyEditor } from "@/lib/server/site-copy-service";
import { EditableCopy, SiteCopyEditorProvider } from "@/components/cyber/landing/EditableCopy";
import { JsonLd } from "@/components/seo/JsonLd";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { ORGANIZATION_FOUNDING_YEAR, organizationJsonLd } from "@/lib/shared/structured-data";
import { BureauSection } from "./BureauSection";
import styles from "./page.module.css";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";

const REGLEMENT_URL =
  "https://docs.google.com/document/d/1f3X3tbgs0U7Gwz0qSfotgW-HqMLKIb6DUKqlbz-ZCq8/preview";

/**
 * Objet de l'association (`association.organizationDescription`), tel qu'il
 * figure dans ses statuts et sur cette page.
 *
 * Distinct de la description de référencement : celle-ci est rédigée pour un
 * moteur et bornée en longueur, celui-là est ce que l'association dit d'elle.
 */

/**
 * La description était écrite en dur alors que la page, elle, se rédige depuis
 * l'interface (`site-copy.ts`) : elle annonçait « pour Overwatch et Marvel
 * Rivals » quand la production ne mentionne plus Marvel Rivals nulle part sur
 * cette page, et taisait l'objet statutaire qui y est désormais affiché — des
 * événements « en ligne et en LAN », la fédération des équipes, la formation des
 * acteurs. Elle est recalée sur ce que la page dit réellement.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).association;
  return pageMetadata({
    title: meta.title,
    description: meta.description,
    shareDescription: meta.shareDescription,
    path: "/association",
    shareCard: "association",
    locale,
  });
}

/** Les quatre principes du manifeste, dans l'ordre (`association.manifesto.<clé>`). */
const MANIFESTO_KEYS = ["purpose", "values", "vision", "commitment"] as const;

/**
 * Page traduite (`/en/association`, lot 5b — `docs/features/I18N.md`
 * § Association, bénévoles, recrutement). Les textes éditables servent
 * l'anglais enregistré ou d'origine (`resolveSiteCopy`) ; le contenu du staff
 * (bureau, chiffres, cartes « À propos ») n'est rendu sous `/en` qu'avec son
 * anglais (`staff-translation.ts`).
 */
export default async function AssociationPage() {
  const locale = await requestLocale();
  const [user, bureauMembers, aboutStats, aboutPillars, copy] = await Promise.all([
    getCurrentUser(),
    listBureauMembers(),
    listAboutStats(),
    listAboutPillars(),
    getSiteCopy(locale),
  ]);
  const messages = messagesFor(locale).association;
  // Gestion de l'association : administrateurs + Community Managers.
  const isAdmin = can(user, "showcase");
  // Éditeur bilingue (FR + EN obligatoire) : ses textes ne voyagent que pour le staff.
  const copyEditor = isAdmin ? await getSiteCopyEditor() : null;

  return (
    <PublicPageShell>
      <SiteCopyEditorProvider entries={copyEditor ?? null}>
        {/*
          Le même nœud qu'à l'accueil, à la même identité : c'est *la* page qui
          parle de l'association, et un moteur doit y retrouver la structure
          qu'il connaît déjà plutôt qu'une seconde du même nom.
        */}
        <JsonLd data={organizationJsonLd(siteCanonicalBase(), messages.organizationDescription)} />
        {/* HERO */}
        <section className={`${styles.section} ${styles.heroSection}`}>
          <div className="fabric" />
          <EditableCopy
            copyKey="association.hero.eyebrow"
            value={copy["association.hero.eyebrow"]}
            canEdit={isAdmin}
          >
            <span className="eyebrow">{copy["association.hero.eyebrow"]}</span>
          </EditableCopy>
          <div className={styles.heroGrid}>
            <div>
              <EditableCopy
                copyKey="association.hero.title"
                value={copy["association.hero.title"]}
                canEdit={isAdmin}
              >
                <h1 className={`display ${styles.heroTitle}`}>
                  {copy["association.hero.title"].split("\n").map((line, index, lines) => (
                    <span key={line + index} className={index > 0 && index === lines.length - 1 ? "text-gradient" : undefined}>
                      {line}
                      {index < lines.length - 1 ? <br /> : null}
                    </span>
                  ))}
                </h1>
              </EditableCopy>
            </div>
            {/* Un `<div>` et non un `<aside>` : ces faits (et les avantages de
                l'adhésion, plus bas) sont le contenu de la page, pas un contenu
                complémentaire — et un repère `complementary` imbriqué dans
                `<main>` n'est pas un repère de premier niveau (RGAA 12.6). */}
            <div className={styles.heroSide}>
              <div className={styles.heroFact}>
                <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 11, letterSpacing: "0.2em" }}>
                  {messages.hero.foundedIn}
                </span>
                <span className="num" style={{ fontSize: 28 }}>{ORGANIZATION_FOUNDING_YEAR}</span>
              </div>
              <div className={styles.heroFact}>
                <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 11, letterSpacing: "0.2em" }}>
                  {messages.hero.seat}
                </span>
                <span style={{ fontSize: 17 }}>{messages.hero.seatValue}</span>
              </div>
              <div className={styles.heroFact}>
                <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 11, letterSpacing: "0.2em" }}>
                  {messages.hero.status}
                </span>
                <span style={{ fontSize: 17 }}>{messages.hero.statusValue}</span>
              </div>
            </div>
          </div>
        </section>

        {/* ABOUT SECTION */}
        <AboutSection stats={aboutStats} pillars={aboutPillars} isAdmin={isAdmin} copy={copy} locale={locale} />

        {/* MANIFESTE */}
        <section id="manifeste" className={styles.section}>
          <header className={styles.head}>
            <div>
              <span className="eyebrow">{messages.manifesto.eyebrow}</span>
              <h2 className={styles.sectionTitle}>{messages.manifesto.title}</h2>
            </div>
            <span className={styles.meta}>{messages.manifesto.meta}</span>
          </header>
          <div className={styles.manifesteGrid}>
            <EditableCopy
              copyKey="association.manifesto.lede"
              value={copy["association.manifesto.lede"]}
              canEdit={isAdmin}
            >
              <p className={styles.lede}>{copy["association.manifesto.lede"]}</p>
            </EditableCopy>
            <ol className={styles.principles}>
              {MANIFESTO_KEYS.map((key) => messages.manifesto[key]).map((item, index) => (
                <li key={item.title} className={styles.principle}>
                  <span className={`mono ${styles.principleNum}`}>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className={styles.principleTitle}>{item.title}</h3>
                    <p className={styles.principleText}>{item.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* BUREAU */}
        <BureauSection initialMembers={bureauMembers} isAdmin={isAdmin} locale={locale} messages={messages.bureau} />

        {/* ADHÉRER */}
        <section className={styles.section}>
          <header className={styles.head}>
            <div>
              <span className="eyebrow">{messages.membership.eyebrow}</span>
              <h2 className={styles.sectionTitle}>{messages.membership.title}</h2>
            </div>
            <span className={styles.meta}>{messages.membership.meta}</span>
          </header>
          <div className={styles.adhererGrid}>
            <div className={styles.adhererText}>
              <EditableCopy
                copyKey="association.membership.lede"
                value={copy["association.membership.lede"]}
                canEdit={isAdmin}
              >
                <p className={styles.lede}>{copy["association.membership.lede"]}</p>
              </EditableCopy>
              {/* Un compte joueur n'est pas une adhésion : les statuts
                  subordonnent la qualité de membre au bulletin, à l'agrément du
                  bureau et à l'âge de 16 ans. La section les distingue plutôt
                  que de promettre qu'un compte fait un adhérent. */}
              <p className={styles.adhererBody}>
                {user ? messages.membership.bodyMember : messages.membership.bodyGuest}
              </p>
            </div>
            <div className={styles.adhererSide}>
              <div className={styles.adhererPerks}>
                {[
                  [messages.membership.ageValue, messages.membership.ageLabel],
                  [messages.membership.durationValue, messages.membership.durationLabel],
                  [messages.membership.approvalValue, messages.membership.approvalLabel],
                ].map(([value, label]) => (
                  <div key={label} className={styles.adhererPerk}>
                    <span className={`num ${styles.adhererPerkValue}`}>{value}</span>
                    <span className="mono">{label}</span>
                  </div>
                ))}
              </div>
              <div className={styles.ctaRow}>
                <CyberButton variant="primary" asChild>
                  <a href="/bulletin_adhesion.docx" download hrefLang="fr">
                    {messages.membership.download}
                  </a>
                </CyberButton>
                {/* Le compte joueur reste proposé à côté, sous son nom : il
                    ouvre les tournois, pas l'adhésion. */}
                <CyberButton variant="ghost" asChild>
                  {user ? (
                    <LocaleLink href="/tournois">{messages.membership.tournaments}</LocaleLink>
                  ) : (
                    <LocaleLink href="/connexion">{messages.membership.createAccount}</LocaleLink>
                  )}
                </CyberButton>
                <CyberButton variant="ghost" asChild>
                  <a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
                    {messages.membership.discord}
                  </a>
                </CyberButton>
              </div>
            </div>
          </div>
        </section>

        {/* DOCUMENTS */}
        <section className={styles.section}>
          <header className={styles.head}>
            <div>
              <span className="eyebrow">{messages.documents.eyebrow}</span>
              <h2 className={styles.sectionTitle}>{messages.documents.title}</h2>
            </div>
            <span className={styles.meta}>{messages.documents.meta}</span>
          </header>
          <ul className={styles.docList}>
            <li>
              {/* Documents officiels, rédigés en français seulement. */}
              <a href="/statuts.pdf" target="_blank" rel="noreferrer" hrefLang="fr" className={styles.docItem}>
                <span>{messages.documents.statutes}</span>
                <span className={styles.docMeta}>{messages.documents.pdf}</span>
              </a>
            </li>
            <li>
              <a href={REGLEMENT_URL} target="_blank" rel="noreferrer" hrefLang="fr" className={styles.docItem}>
                <span>{messages.documents.rules}</span>
                <span className={styles.docMeta}>{messages.documents.doc}</span>
              </a>
            </li>
            <li>
              <a href="/bulletin_adhesion.docx" download hrefLang="fr" className={styles.docItem}>
                <span>{messages.documents.form}</span>
                <span className={styles.docMeta}>{messages.documents.docx}</span>
              </a>
            </li>
          </ul>
        </section>
      </SiteCopyEditorProvider>
    </PublicPageShell>
  );
}
