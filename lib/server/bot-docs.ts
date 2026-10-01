import fs from "node:fs/promises";
import path from "node:path";
import type { BotDocSection } from "@/lib/shared/bot-doc-sections";
import { cached } from "@/lib/server/cache";

/**
 * Documentation du bot Discord (projet `blueGenjiBot`).
 *
 * Les fichiers Markdown ne sont PAS copiés dans ce dépôt : ils sont lus à chaud
 * depuis le dossier du bot, qui vit à côté de celui de l'app (`~/apps/`). Toute
 * mise à jour de la doc du bot est donc visible sur `/bot/docs` sans rebuild,
 * dans la minute (`loadBotDocCached`).
 *
 * Le chemin est surchargeable via `BOT_DOCS_PATH` si les projets déménagent.
 */
export const BOT_PROJECT_DIR =
  process.env.BOT_DOCS_PATH?.trim() || path.resolve(process.cwd(), "..", "blueGenjiBot");

export type { BotDocSection } from "@/lib/shared/bot-doc-sections";
// Réexportés — le registre lui-même vit dans `lib/shared/bot-doc-sections.ts`,
// hors d'atteinte de `node:fs`, parce qu'un composant l'affiche. Voir l'en-tête
// de ce module-là.
export { BOT_DOC_SECTIONS, findBotDocSection } from "@/lib/shared/bot-doc-sections";

export interface LoadedBotDoc {
  section: BotDocSection;
  /** HTML rendu, ou `null` si le fichier est introuvable. */
  html: string | null;
  /** Dernière modification du fichier source, ISO, ou `null`. */
  updatedAt: string | null;
}

/**
 * Lit et rend un document du bot depuis le disque, à chaque appel — la page
 * passe par {@link loadBotDocCached}.
 */
export async function loadBotDoc(section: BotDocSection): Promise<LoadedBotDoc> {
  const filePath = path.join(BOT_PROJECT_DIR, section.file);
  try {
    const [raw, stat] = await Promise.all([
      fs.readFile(filePath, "utf8"),
      fs.stat(filePath),
    ]);
    return {
      section,
      html: renderMarkdown(raw),
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return { section, html: null, updatedAt: null };
  }
}

/** Durée pendant laquelle un document lu et rendu est resservi tel quel. */
export const BOT_DOC_TTL_MS = 60_000;

/**
 * {@link loadBotDoc}, relu et reparsé au plus une fois par minute et par
 * document.
 *
 * La page promettait ce délai par un `export const revalidate = 60` qui ne met
 * plus rien en cache — tout le site est rendu à la demande depuis que la mise en
 * page racine lit le nonce de la CSP —, si bien que chaque vue relisait le
 * fichier sur disque et refaisait le rendu Markdown. La clé est le fichier du
 * registre (`BOT_DOC_SECTIONS`), jamais une saisie : l'espace des clés est
 * borné par construction.
 */
export function loadBotDocCached(section: BotDocSection): Promise<LoadedBotDoc> {
  return cached(`bot-doc:${section.file}`, BOT_DOC_TTL_MS, () => loadBotDoc(section));
}

/* ------------------------------------------------------------------ */
/* Rendu Markdown                                                      */
/* ------------------------------------------------------------------ */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|\/|#|mailto:)/i.test(href);
}

function renderEmphasis(text: string): string {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => // NOSONAR typescript:S8786 — Markdown du dépôt du bot, source de confiance
      isSafeHref(href) ? `<a href="${href}" rel="noreferrer">${label}</a>` : label,
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

/**
 * Formatage inline : code, gras, italique, liens.
 *
 * On découpe d'abord sur les backticks pour que le contenu du code inline
 * échappe au reste du formatage — sans ça un `*` dans un exemple de commande
 * serait interprété comme de l'italique.
 */
export function renderInline(text: string): string {
  return text
    .split(/`([^`]+)`/)
    .map((part, i) => (i % 2 === 1 ? `<code>${escapeHtml(part)}</code>` : renderEmphasis(part)))
    .join("");
}

/**
 * Une puce indentée de `indent` colonnes ouvre-t-elle un niveau de liste, le
 * niveau ouvert le plus profond étant à `current` colonnes (`undefined` hors
 * liste) ?
 */
function opensListLevel(indent: number, current: number | undefined): boolean {
  return current === undefined || indent > current;
}

/**
 * Rend le sous-ensemble Markdown utilisé par la doc du bot : titres, listes,
 * blocs de code, paragraphes. Volontairement minimal — pas de dépendance
 * externe, et la source est un contenu de confiance du dépôt voisin.
 */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let fence: string[] | null = null;
  // Indentation (en colonnes) de chaque niveau de liste ouvert. `liOpen` suit le
  // `<li>` du niveau courant : une sous-liste s'ouvre *à l'intérieur* de ce `<li>`,
  // sinon le HTML produit serait invalide (`<ul>` enfant direct de `<ul>`).
  const listStack: number[] = [];
  let liOpen = false;

  const closeLi = () => {
    if (liOpen) {
      out[out.length - 1] += "</li>";
      liOpen = false;
    }
  };
  const openLevel = (indent: number) => {
    out.push("<ul>");
    listStack.push(indent);
    liOpen = false;
  };
  const closeLevel = () => {
    closeLi();
    out.push("</ul>");
    listStack.pop();
    // En remontant d'un cran, le `<li>` parent est toujours ouvert.
    liOpen = listStack.length > 0;
  };
  const closeList = () => {
    while (listStack.length) closeLevel();
    liOpen = false;
  };
  const closeParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flush = () => {
    closeParagraph();
    closeList();
  };

  const isFence = (line: string) => line.trim().startsWith("```");
  const closeFence = (code: string[]) => {
    out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  };
  const addHeading = (marks: string, text: string) => {
    flush();
    // Le `#` du fichier devient un h2 : le h1 de la page reste le titre de la doc.
    const level = Math.min(marks.length + 1, 6);
    out.push(`<h${level}>${renderInline(text.trim())}</h${level}>`);
  };
  const addBullet = (rawIndent: string, text: string) => {
    closeParagraph();
    const indent = rawIndent.replace(/\t/g, "  ").length;
    if (opensListLevel(indent, listStack.at(-1))) {
      openLevel(indent);
    } else {
      while (listStack.length > 1 && indent < listStack.at(-1)!) closeLevel();
      closeLi();
    }
    out.push(`<li>${renderInline(text.trim())}`);
    liOpen = true;
  };

  for (const line of lines) {
    if (fence !== null && !isFence(line)) {
      fence.push(line);
      continue;
    }
    if (fence !== null) {
      closeFence(fence);
      fence = null;
      continue;
    }

    if (isFence(line)) {
      flush();
      fence = [];
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line); // NOSONAR typescript:S8786 — Markdown du dépôt du bot, source de confiance
    if (heading) {
      addHeading(heading[1], heading[2]);
      continue;
    }

    const bullet = /^([ \t]*)[-*]\s+(.*)$/.exec(line); // NOSONAR typescript:S8786 — Markdown du dépôt du bot, source de confiance
    if (bullet) {
      addBullet(bullet[1], bullet[2]);
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  if (fence !== null) closeFence(fence);
  flush();

  return out.join("\n");
}
