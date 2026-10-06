import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { notFound, permanentRedirect } from "next/navigation";
import "../../bot.css";
import "../docs.css";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { CyberButton } from "@/components/cyber";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { findBotDocSection, loadBotDocCached } from "@/lib/server/bot-docs";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import {
  botDocFile,
  botDocLanguage,
  visibleBotDocSections,
  BOT_LEGAL_LINKS,
  LEGACY_BOT_DOC_REDIRECTS,
} from "@/lib/shared/bot-doc-sections";
import { botText } from "@/lib/shared/bot-text";
import { INTL_LOCALE } from "@/lib/shared/locales";
import { getCurrentUser } from "@/lib/server/auth";
import { isStaffMember } from "@/lib/shared/permissions";

/**
 * Les fichiers sources vivent dans le projet du bot (dossier voisin) et sont
 * relus au plus une fois par minute (`loadBotDocCached`) : une mise à jour de la
 * doc du bot se propage ici toute seule, sans rebuild de l'app. Pas de
 * `export const revalidate` : la mise en page racine lit `headers()` (nonce de
 * la CSP), la page est rendue à chaque requête quoi qu'on y déclare.
 *
 * Page traduite (`/en/bot/docs/…`, lot 5a — `docs/features/I18N.md` § Bot) :
 * le guide sert `help.md` sous `/en` et `helpfr.md` en français
 * (`botDocFile`) ; une page réservée au staff, rédigée en français seulement,
 * est servie telle quelle sous `/en`, annoncée `lang="fr"`.
 */

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const [user, locale] = await Promise.all([getCurrentUser(), requestLocale()]);
  const { t } = botText(locale, messagesFor(locale).bot);
  const section = findBotDocSection(slug?.[0], isStaffMember(user));
  if (!section) {
    return pageMetadata({
      title: t("docs.meta.title"),
      description: t("docs.meta.description"),
      path: "/bot/docs",
      shareCard: "botDocs",
      locale,
    });
  }
  return pageMetadata({
    title: t("docs.meta.sectionTitle", { section: t(`docs.sections.${section.textKey}.title`) }),
    description: t(`docs.sections.${section.textKey}.summary`),
    path: `/bot/docs/${section.slug}`,
    // La carte est celle de la documentation entière : son texte de
    // remplacement (`shareCardAlt`) ne nomme pas la section, elle non plus.
    shareCard: "botDocs",
    locale,
  });
}

/** Morceaux d'un texte riche, chacun sous sa clé. */
function richNodes(parts: ReadonlyArray<ReactNode>): ReactNode {
  return parts.map((part, index) => (typeof part === "string" ? part : <Fragment key={index}>{part}</Fragment>));
}

export default async function BotDocsPage({ params }: Readonly<PageProps>) {
  const { slug } = await params;
  if (slug && slug.length > 1) notFound();
  // `hasOwn` : un segment reçu peut nommer une propriété du prototype.
  const wanted = slug?.[0];
  if (wanted && Object.hasOwn(LEGACY_BOT_DOC_REDIRECTS, wanted)) permanentRedirect(LEGACY_BOT_DOC_REDIRECTS[wanted]);

  const [user, locale] = await Promise.all([getCurrentUser(), requestLocale()]);
  const text = botText(locale, messagesFor(locale).bot);
  const { t } = text;
  const isStaff = isStaffMember(user);
  const sections = visibleBotDocSections(isStaff);
  const section = findBotDocSection(slug?.[0], isStaff);
  if (!section) notFound();

  const doc = await loadBotDocCached(section, locale);
  const file = botDocFile(section, locale);
  // Langue réelle du document : sous `/en`, une page sans version anglaise
  // reste française (staff seulement), et le dit.
  const docLanguage = botDocLanguage(section, locale);
  const foreign = docLanguage !== locale;

  return (
    <>
      <PublicHeader />

      <main className="bot-main">
        <div className="container bot-container">
          <div className="bot-crumb">
            <span>{t("crumb.brand")}</span>
            <span className="sep">/</span>
            <LocaleLink href="/bot" style={{ color: "inherit", textDecoration: "none" }}>
              {t("crumb.here")}
            </LocaleLink>
            <span className="sep">/</span>
            <span className="here">{t("crumb.docs")}</span>
          </div>

          <div className="bot-hero">
            <div className="bot-name">
              <span className="bot-tag">
                <span className="sq" />
                {t(`docs.sections.${section.textKey}.eyebrow`)}
              </span>
              <h1 className="bot-title">
                {t("docs.titleLead")}
                <span className="accent">{t("docs.titleAccent")}</span>
              </h1>
              <div className="bot-handle">
                <span className="h">{t(`docs.sections.${section.textKey}.summary`)}</span>
              </div>
            </div>

            <div className="bot-cta">
              <div className="row-actions">
                <CyberButton asChild variant="ghost">
                  <LocaleLink href="/bot">{t("docs.back")}</LocaleLink>
                </CyberButton>
              </div>
              <span
                className="mono"
                style={{ fontSize: 11, letterSpacing: "0.18em", color: "var(--ink-dim)" }}
              >
                {t("docs.source", { file: file.toUpperCase() })}
              </span>
            </div>
          </div>

          <div className="docs-layout">
            <nav className="panel docs-nav">
              <div className="panel-head">
                <span className="title">{t("docs.navTitle")}</span>
                <span className="meta">{t("docs.pages", { count: sections.length + BOT_LEGAL_LINKS.length })}</span>
              </div>
              <div className="panel-body">
                {sections.map((s) => (
                  <LocaleLink
                    key={s.slug}
                    href={`/bot/docs/${s.slug}`}
                    className={`docs-link${s.slug === section.slug ? " active" : ""}`}
                    aria-current={s.slug === section.slug ? "page" : undefined}
                  >
                    <span className="t">{t(`docs.sections.${s.textKey}.title`)}</span>
                    <span className="s">{t(`docs.sections.${s.textKey}.summary`)}</span>
                  </LocaleLink>
                ))}
                {/* Pages légales du bot : servies à leur propre adresse, hors
                    du registre `/bot/docs`, mais listées ici pour occuper la
                    place laissée par les pages techniques masquées. */}
                {BOT_LEGAL_LINKS.map((link) => (
                  <LocaleLink key={link.slug} href={link.href} className="docs-link">
                    <span className="t">{t(`docs.legal.${link.textKey}.title`)}</span>
                    <span className="s">{t(`docs.legal.${link.textKey}.summary`)}</span>
                  </LocaleLink>
                ))}
              </div>
            </nav>

            <article className="panel" lang={foreign ? docLanguage : undefined}>
              <div className="panel-head">
                <span className="title" lang={foreign ? locale : undefined}>
                  {t(`docs.sections.${section.textKey}.title`)}
                </span>
                <span className="meta" lang={foreign ? locale : undefined}>
                  {t("docs.live")}
                </span>
              </div>
              <div className="panel-body docs-body">
                {foreign ? (
                  <p className="docs-missing" lang={locale}>
                    {t("docs.frenchOnly")}
                  </p>
                ) : null}
                {doc.html ? (
                  <div className="docs-content" dangerouslySetInnerHTML={{ __html: doc.html }} />
                ) : (
                  <p className="docs-missing" lang={foreign ? locale : undefined}>
                    {richNodes(
                      text.rich("docs.missing", { file }, { code: (chunks) => <span className="code">{chunks}</span> }),
                    )}
                  </p>
                )}

                <div className="docs-foot" lang={foreign ? locale : undefined}>
                  <span>{t("docs.synced")}</span>
                  {doc.updatedAt ? (
                    <span>
                      {t("docs.updated", {
                        date: new Date(doc.updatedAt).toLocaleDateString(INTL_LOCALE[locale], {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        }),
                      })}
                    </span>
                  ) : null}
                </div>
              </div>
            </article>
          </div>
        </div>
      </main>

      <PublicFooter />
    </>
  );
}
