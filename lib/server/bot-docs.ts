import fs from "node:fs/promises";
import path from "node:path";

/**
 * Documentation du bot Discord (projet `blueGenjiBot`).
 *
 * Les fichiers Markdown ne sont PAS copiés dans ce dépôt : ils sont lus à chaud
 * depuis le dossier du bot, qui vit à côté de celui de l'app (`~/apps/`). Toute
 * mise à jour de la doc du bot est donc visible sur `/bot/docs` sans rebuild —
 * la page est simplement revalidée (voir `revalidate` dans la page).
 *
 * Le chemin est surchargeable via `BOT_DOCS_PATH` si les projets déménagent.
 */
export const BOT_PROJECT_DIR =
  process.env.BOT_DOCS_PATH?.trim() || path.resolve(process.cwd(), "..", "blueGenjiBot");

export interface BotDocSection {
  /** Segment d'URL sous `/bot/docs`. */
  slug: string;
  /** Titre affiché dans la nav et en tête de page. */
  title: string;
  /** Sur-titre mono affiché au-dessus du titre. */
  eyebrow: string;
  /** Résumé court affiché dans la nav. */
  summary: string;
  /** Chemin du fichier, relatif à la racine du projet du bot. */
  file: string;
}

/**
 * Registre des documents exposés publiquement. C'est aussi le garde-fou contre
 * la traversée de chemin : seuls ces fichiers peuvent être lus, un slug inconnu
 * ne résout rien.
 */
export const BOT_DOC_SECTIONS: BotDocSection[] = [
  {
    slug: "guide",
    title: "Guide utilisateur",
    eyebrow: "PRISE EN MAIN · FR",
    summary: "Services, format des messages et commandes slash.",
    file: "helpfr.md",
  },
  {
    slug: "adhesions",
    title: "Commandes d'adhésion",
    eyebrow: "SERVEURS BLUEGENJI",
    summary: "Envoi des documents d'adhésion, rappels et validations.",
    file: "doc/adhesions-commands-user.md",
  },
  {
    slug: "api-interne",
    title: "API interne",
    eyebrow: "INTÉGRATION · EXPRESS",
    summary: "Endpoints HTTP consommés par la plateforme.",
    file: "doc/internal-api.md",
  },
  {
    slug: "architecture",
    title: "Architecture",
    eyebrow: "TECHNIQUE · MAIN",
    summary: "Client Discord, intents et listeners du bot.",
    file: "doc/main.md",
  },
  {
    slug: "base-de-donnees",
    title: "Base de données",
    eyebrow: "TECHNIQUE · SQLITE",
    summary: "Tables, messages dupliqués et salons partenaires.",
    file: "doc/src/Bdd.md",
  },
  {
    slug: "user-guide-en",
    title: "User guide (EN)",
    eyebrow: "GETTING STARTED · EN",
    summary: "English version of the user guide.",
    file: "help.md",
  },
];

export function findBotDocSection(slug: string | undefined): BotDocSection | null {
  const wanted = slug ?? BOT_DOC_SECTIONS[0].slug;
  return BOT_DOC_SECTIONS.find((s) => s.slug === wanted) ?? null;
}

export interface LoadedBotDoc {
  section: BotDocSection;
  /** HTML rendu, ou `null` si le fichier est introuvable. */
  html: string | null;
  /** Dernière modification du fichier source, ISO, ou `null`. */
  updatedAt: string | null;
}

/** Lit et rend un document du bot depuis le disque, à chaque requête. */
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
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) =>
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
 * Rend le sous-ensemble Markdown utilisé par la doc du bot : titres, listes,
 * blocs de code, paragraphes. Volontairement minimal — pas de dépendance
 * externe, et la source est un contenu de confiance du dépôt voisin.
 */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listOpen = false;
  let paragraph: string[] = [];
  let fence: string[] | null = null;

  const closeList = () => {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
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

  for (const line of lines) {
    if (fence !== null) {
      if (line.trim().startsWith("```")) {
        out.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }

    if (line.trim().startsWith("```")) {
      flush();
      fence = [];
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      // Le `#` du fichier devient un h2 : le h1 de la page reste le titre de la doc.
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      closeParagraph();
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${renderInline(bullet[1].trim())}</li>`);
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  if (fence !== null) out.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
  flush();

  return out.join("\n");
}
