import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import "../../bot.css";
import "../docs.css";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { BOT_DOC_SECTIONS, findBotDocSection, loadBotDoc } from "@/lib/server/bot-docs";

/**
 * Les fichiers sources vivent dans le projet du bot (dossier voisin) et sont
 * relus à chaque revalidation : une mise à jour de la doc du bot se propage
 * ici toute seule, sans rebuild de l'app.
 */
export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const section = findBotDocSection(slug?.[0]);
  if (!section) return { title: "Documentation — BlueGenji Bot" };
  return {
    title: `${section.title} — Documentation BlueGenji Bot`,
    description: section.summary,
  };
}

export default async function BotDocsPage({ params }: PageProps) {
  const { slug } = await params;
  if (slug && slug.length > 1) notFound();

  const section = findBotDocSection(slug?.[0]);
  if (!section) notFound();

  const doc = await loadBotDoc(section);

  return (
    <>
      <PublicHeader />

      <main className="bot-main">
        <div className="container">
          <div className="bot-crumb">
            <span>BLUEGENJI</span>
            <span className="sep">/</span>
            <Link href="/bot" style={{ color: "inherit", textDecoration: "none" }}>
              BOT DISCORD
            </Link>
            <span className="sep">/</span>
            <span className="here">DOCUMENTATION</span>
          </div>

          <div className="bot-hero">
            <div className="bot-name">
              <span className="bot-tag">
                <span className="sq" />
                {section.eyebrow}
              </span>
              <h1 className="bot-title">
                Docu<span className="accent">mentation</span>
              </h1>
              <div className="bot-handle">
                <span className="h">{section.summary}</span>
              </div>
            </div>

            <div className="bot-cta">
              <div className="row-actions">
                <Link className="btn btn-ghost" href="/bot">
                  Retour au dashboard
                </Link>
              </div>
              <span
                className="mono"
                style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--fg-dim)" }}
              >
                SOURCE · BLUEGENJIBOT/{section.file.toUpperCase()}
              </span>
            </div>
          </div>

          <div className="docs-layout">
            <nav className="panel docs-nav">
              <div className="panel-head">
                <span className="title">Sommaire</span>
                <span className="meta">{BOT_DOC_SECTIONS.length} PAGES</span>
              </div>
              <div className="panel-body">
                {BOT_DOC_SECTIONS.map((s) => (
                  <Link
                    key={s.slug}
                    href={`/bot/docs/${s.slug}`}
                    className={`docs-link${s.slug === section.slug ? " active" : ""}`}
                    aria-current={s.slug === section.slug ? "page" : undefined}
                  >
                    <span className="t">{s.title}</span>
                    <span className="s">{s.summary}</span>
                  </Link>
                ))}
              </div>
            </nav>

            <article className="panel">
              <div className="panel-head">
                <span className="title">{section.title}</span>
                <span className="meta">MARKDOWN · LIVE</span>
              </div>
              <div className="panel-body docs-body">
                {doc.html ? (
                  <div className="docs-content" dangerouslySetInnerHTML={{ __html: doc.html }} />
                ) : (
                  <p className="docs-missing">
                    Cette page de documentation est momentanément indisponible : le fichier{" "}
                    <span className="code">{section.file}</span> n&apos;a pas pu être lu depuis le
                    projet du bot.
                  </p>
                )}

                <div className="docs-foot">
                  <span>DOC SYNCHRONISÉE DEPUIS LE DÉPÔT DU BOT</span>
                  {doc.updatedAt ? (
                    <span>
                      MAJ ·{" "}
                      {new Date(doc.updatedAt).toLocaleDateString("fr-FR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
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
