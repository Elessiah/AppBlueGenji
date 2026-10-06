import { Fragment, type ReactNode } from "react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { crossesLocale } from "@/lib/shared/locales";
import {
  HEBERGEUR_HREF,
  type Lang,
  type LegalBlock,
  type LegalDoc,
} from "@/lib/shared/bot-legal-types";
import styles from "./BotLegalDoc.module.css";

/**
 * Corps d'un document légal du bot, **dans une seule langue** : celle de
 * l'adresse (`/privacy-policy-bot` en français, `/en/privacy-policy-bot` en
 * anglais — lot 7a, `docs/features/I18N.md`). La bascule FR/EN qu'il portait
 * dans la page a cédé la place au sélecteur de langue du site. La partie
 * « hébergeur » renvoie vers la section Hébergement des mentions légales.
 *
 * Composant serveur : le texte arrive déjà choisi par la page (`doc[locale]`),
 * aucun code n'en part au navigateur. Il ne rend pas `PublicHeader` /
 * `PublicFooter` : la page qui l'enveloppe les pose (`PublicPageShell`).
 *
 * Chaque section déclare la langue de son texte (WCAG 3.1.2) — celle de la
 * page désormais, gardée pour que le texte n'en dépende pas. Les liens
 * internes passent par `LocaleLink` : sous `/en`, le renvoi d'un document du
 * bot à l'autre reste en anglais, et un lien vers une page encore française
 * (`/rgpd`, `/mentions-legales`) y mène sans préfixe.
 */
export function BotLegalDoc({
  doc: content,
  lang,
  sectionLabel,
  inFrenchLabel,
}: Readonly<{ doc: LegalDoc; lang: Lang; sectionLabel: string; inFrenchLabel: string }>) {
  const hostingInFrench = crossesLocale(HEBERGEUR_HREF, lang);
  const [titleLine1, titleLine2] = content.title.split("\n");

  return (
    <>
      {/* HERO */}
      <section lang={lang} className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <div className={styles.heroTop}>
          <span className="eyebrow">{content.eyebrow}</span>
        </div>
        <h1 className={`display ${styles.heroTitle}`}>
          {titleLine1}
          {titleLine2 ? (
            <>
              <br />
              <span className="text-gradient">{titleLine2}</span>
            </>
          ) : null}
        </h1>
        <p className={styles.intro}>{renderInline(content.intro, lang)}</p>
        <div className={styles.updated}>
          <span className={styles.updatedLabel}>{content.lastUpdatedLabel}</span>
          <span className={styles.updatedValue}>{content.lastUpdated}</span>
        </div>
      </section>

      {content.sections.map((section) => (
        <section key={section.num} lang={lang} className={styles.section}>
          <header className={styles.head}>
            <div>
              <span className="eyebrow">{`${sectionLabel} ${section.num}`}</span>
              <h2 className={styles.sectionTitle}>{section.title}</h2>
            </div>
            <span className={styles.meta}>{section.meta}</span>
          </header>
          <div className={styles.prose}>
            {section.blocks.map((block, i) => (
              <Block key={i} /* NOSONAR S6479 — fragments d'un document constant, jamais réordonnés */ block={block} lang={lang} />
            ))}
          </div>
        </section>
      ))}

      {/* HÉBERGEUR — renvoi vers les mentions légales */}
      <section lang={lang} className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">
              {`${sectionLabel} ${String(content.sections.length + 1).padStart(2, "0")}`}
            </span>
            <h2 className={styles.sectionTitle}>{content.hosting.title}</h2>
          </div>
          <span className={styles.meta}>{content.hosting.meta}</span>
        </header>
        <div className={styles.prose}>
          <p>{content.hosting.text}</p>
        </div>
        <LocaleLink
          href={HEBERGEUR_HREF}
          hrefLang={hostingInFrench ? "fr" : undefined}
          className={styles.hostingLink}
        >
          {content.hosting.linkLabel}
          {hostingInFrench ? ` ${inFrenchLabel}` : null}
        </LocaleLink>
      </section>
    </>
  );
}

function Block({ block, lang }: Readonly<{ block: LegalBlock; lang: Lang }>) {
  if (block.kind === "subhead") {
    return <h3 className={styles.subhead}>{block.text}</h3>;
  }
  if (block.kind === "bullets") {
    return (
      <ul className={styles.bullets}>
        {block.items?.map((item, i) => (
          <li key={i} /* NOSONAR S6479 — fragments d'un document constant, jamais réordonnés */>{renderInline(item, lang)}</li>
        ))}
      </ul>
    );
  }
  return <p>{renderInline(block.text ?? "", lang)}</p>;
}

/**
 * Rendu inline minimal : `**gras**` → <strong>, `[texte](url)` → <a>.
 * Les liens internes (`/…`) passent par `LocaleLink` — `hrefLang="fr"` quand
 * ils mènent d'une page anglaise à une page encore française ; les liens
 * externes ouvrent un nouvel onglet de façon sûre.
 */
function renderInline(text: string, lang: Lang): ReactNode {
  // Découpe sur les liens markdown, puis traite le gras dans chaque segment.
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g; // NOSONAR typescript:S8786 — Markdown du dépôt du bot, source de confiance
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = linkRe.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(<Fragment key={key++}>{renderBold(text.slice(last, match.index))}</Fragment>);
    }
    const [, label, href] = match;
    const isInternal = href.startsWith("/") || href.startsWith("#");
    if (isInternal) {
      nodes.push(
        <LocaleLink
          key={key++}
          href={href}
          hrefLang={crossesLocale(href, lang) ? "fr" : undefined}
          className={styles.link}
        >
          {label}
        </LocaleLink>,
      );
    } else {
      nodes.push(
        <a key={key++} href={href} target="_blank" rel="noreferrer" className={styles.link}>
          {label}
        </a>,
      );
    }
    last = linkRe.lastIndex;
  }
  if (last < text.length) {
    nodes.push(<Fragment key={key++}>{renderBold(text.slice(last))}</Fragment>);
  }
  return nodes;
}

function renderBold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} /* NOSONAR S6479 — fragments d'un document constant, jamais réordonnés */>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i} /* NOSONAR S6479 — fragments d'un document constant, jamais réordonnés */>{part}</Fragment>
    ),
  );
}
