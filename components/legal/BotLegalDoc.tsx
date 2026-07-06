"use client";

import { Fragment, type ReactNode, useState } from "react";
import Link from "next/link";
import {
  HEBERGEUR_HREF,
  type BilingualDoc,
  type Lang,
  type LegalBlock,
} from "@/lib/shared/bot-legal-content";
import styles from "./BotLegalDoc.module.css";

/**
 * Corps interactif d'un document légal bilingue (FR / EN) du bot, avec un
 * sélecteur de langue rapide (segmented control). La partie « hébergeur »
 * renvoie vers la section Hébergement des mentions légales du site.
 *
 * Composant client : il ne rend PAS `PublicHeader`/`PublicFooter` (qui tirent du
 * code serveur) — ceux-ci restent dans la page serveur qui l'enveloppe.
 */
export function BotLegalDoc({ doc }: { doc: BilingualDoc }) {
  const [lang, setLang] = useState<Lang>("fr");
  const content = doc[lang];
  const [titleLine1, titleLine2] = content.title.split("\n");

  return (
    <>
      {/* HERO */}
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <div className={styles.heroTop}>
          <span className="eyebrow">{content.eyebrow}</span>
          <LangSwitch lang={lang} onChange={setLang} />
        </div>
        <h1 className={`display ${styles.heroTitle}`}>
          {titleLine1}
          {titleLine2 ? (
            <>
              <br />
              {titleLine2}
            </>
          ) : null}
        </h1>
        <p className={styles.intro}>{renderInline(content.intro)}</p>
        <div className={styles.updated}>
          <span className={styles.updatedLabel}>{content.lastUpdatedLabel}</span>
          <span className={styles.updatedValue}>{content.lastUpdated}</span>
        </div>
      </section>

      {content.sections.map((section) => (
        <section key={section.num} className={styles.section}>
          <header className={styles.head}>
            <div>
              <span className="eyebrow">SECTION {section.num}</span>
              <h2 className={styles.sectionTitle}>{section.title}</h2>
            </div>
            <span className={styles.meta}>{section.meta}</span>
          </header>
          <div className={styles.prose}>
            {section.blocks.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </div>
        </section>
      ))}

      {/* HÉBERGEUR — renvoi vers les mentions légales */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">
              SECTION {String(content.sections.length + 1).padStart(2, "0")}
            </span>
            <h2 className={styles.sectionTitle}>{content.hosting.title}</h2>
          </div>
          <span className={styles.meta}>{content.hosting.meta}</span>
        </header>
        <div className={styles.prose}>
          <p>{content.hosting.text}</p>
        </div>
        <Link href={HEBERGEUR_HREF} className={styles.hostingLink}>
          {content.hosting.linkLabel}
        </Link>
      </section>
    </>
  );
}

function LangSwitch({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className={styles.langSwitch} role="group" aria-label="Language / Langue">
      {(["fr", "en"] as const).map((code) => {
        const active = lang === code;
        return (
          <button
            key={code}
            type="button"
            className={`${styles.langBtn} ${active ? styles.langBtnActive : ""}`}
            aria-pressed={active}
            onClick={() => onChange(code)}
          >
            {code === "fr" ? "Français" : "English"}
          </button>
        );
      })}
    </div>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === "subhead") {
    return <h3 className={styles.subhead}>{block.text}</h3>;
  }
  if (block.kind === "bullets") {
    return (
      <ul className={styles.bullets}>
        {block.items?.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }
  return <p>{renderInline(block.text ?? "")}</p>;
}

/**
 * Rendu inline minimal : `**gras**` → <strong>, `[texte](url)` → <a>.
 * Les liens internes (`/…`) utilisent next/link ; les liens externes ouvrent
 * un nouvel onglet de façon sûre.
 */
function renderInline(text: string): ReactNode {
  // Découpe sur les liens markdown, puis traite le gras dans chaque segment.
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
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
        <Link key={key++} href={href} className={styles.link}>
          {label}
        </Link>,
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
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
