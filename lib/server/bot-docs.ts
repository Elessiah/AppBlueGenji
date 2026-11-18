import fs from "node:fs/promises";
import path from "node:path";
import { botDocFile, type BotDocSection } from "@/lib/shared/bot-doc-sections";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
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
  /** Fichier réellement lu (`botDocFile` : `help.md` pour le guide sous `/en`). */
  file: string;
  /** HTML rendu, ou `null` si le fichier est introuvable. */
  html: string | null;
  /** Dernière modification du fichier source, ISO, ou `null`. */
  updatedAt: string | null;
}

/**
 * Lit et rend un document du bot depuis le disque, à chaque appel — la page
 * passe par {@link loadBotDocCached}.
 */
export async function loadBotDoc(section: BotDocSection, locale: Locale = DEFAULT_LOCALE): Promise<LoadedBotDoc> {
  const file = botDocFile(section, locale);
  const filePath = path.join(BOT_PROJECT_DIR, file);
  try {
    const [raw, stat] = await Promise.all([
      fs.readFile(filePath, "utf8"),
      fs.stat(filePath),
    ]);
    return {
      section,
      file,
      html: renderMarkdown(raw),
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return { section, file, html: null, updatedAt: null };
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
export function loadBotDocCached(section: BotDocSection, locale: Locale = DEFAULT_LOCALE): Promise<LoadedBotDoc> {
  // Clé : le fichier lu, pas la section — le guide a deux fichiers, un par langue.
  return cached(`bot-doc:${botDocFile(section, locale)}`, BOT_DOC_TTL_MS, () => loadBotDoc(section, locale));
}

/* ------------------------------------------------------------------ */
/* Rendu Markdown                                                      */
/* ------------------------------------------------------------------ */

/**
 * Réglages du rendu, tous facultatifs : sans eux, le rendu est celui de
 * `/bot/docs`. `/devdoc` (`lib/server/dev-docs.ts`) s'en sert pour réécrire les
 * liens entre documents et poser des ancres sur les titres.
 */
export interface MarkdownRenderOptions {
  /**
   * Adresse d'un lien `[texte](cible)` (cible brute, telle qu'écrite dans le
   * fichier). `null` : le texte seul, sans lien. Absent : seules les cibles
   * sûres (`https://`, `/`, `#`, `mailto:`) restent des liens.
   */
  resolveLink?: (href: string) => string | null;
  /**
   * Adresse d'un code inline (`` `X.md` ``) qui nomme un document : le code
   * devient un lien. `null` : code seul.
   */
  linkCode?: (code: string) => string | null;
  /** Pose un `id` sur chaque titre (ancre d'un lien `#…`). */
  headingIds?: boolean;
  /**
   * Nom accessible de la zone qui fait défiler un tableau large (région
   * focalisable au clavier). Absent : l'enveloppe défile sans être nommée.
   */
  tableLabel?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** L'inverse d'{@link escapeHtml} : la cible d'un lien est lue sur le texte échappé. */
function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|\/|#|mailto:)/i.test(href);
}

/** Adresse finale d'un lien : celle du résolveur, toujours repassée au filtre des schémas sûrs. */
function linkTarget(href: string, options: MarkdownRenderOptions): string | null {
  const target = options.resolveLink ? options.resolveLink(href) : href;
  return target !== null && isSafeHref(target) ? target : null;
}

/** Repère d'un code inline mis de côté pendant le formatage (`\uE000<n>\uE000`). */
const CODE_SLOT = /\uE000(\d+)\uE000/g;

/** Repère d'un lien déjà construit (`\uE001<n>\uE001`) : gras et italique n'entrent jamais dans sa balise. */
const LINK_SLOT = /\uE001(\d+)\uE001/g;

function renderStrongEm(html: string): string {
  return html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

/*
 * Bornes des motifs de lien : sans elles, une ligne de milliers de `[` sans
 * `](` se parcourait en entier à chaque `[` (temps quadratique, ~20 s pour
 * 200 000 crochets) : un rendu qui bloque le processus.
 */
function renderEmphasis(text: string, options: MarkdownRenderOptions, codes: string[]): string {
  // Dans le libellé d'un lien, un code reste du code seul : jamais un lien dans un lien.
  const plainCodes = (label: string) => label.replace(CODE_SLOT, (_m, n: string) => `<code>${escapeHtml(codes[Number(n)])}</code>`);
  const links: string[] = [];
  // Une cible qui contient un code inline n'est pas un lien (le code prime, comme
  // en CommonMark) : sinon le code rendu atterrirait dans l'attribut `href`.
  const withLinks = escapeHtml(text).replace(/\[([^\]]{1,500})\]\(([^)\s\uE000]{1,2000})\)/g, (_m, label: string, href: string) => { // NOSONAR typescript:S8786 — Markdown des dépôts du site et du bot, source de confiance
    const target = linkTarget(unescapeHtml(href), options);
    const inner = plainCodes(renderStrongEm(label));
    if (target === null) return inner;
    // Le lien construit est mis de côté : l'emphase du texte autour ne touche pas son `href`.
    const anchor = `<a href="${escapeHtml(target)}" rel="noreferrer">${inner}</a>`;
    return `\uE001${links.push(anchor) - 1}\uE001`;
  });
  return renderStrongEm(withLinks).replace(LINK_SLOT, (_m, n: string) => links[Number(n)]);
}

function renderCode(code: string, options: MarkdownRenderOptions): string {
  const html = `<code>${escapeHtml(code)}</code>`;
  const target = options.linkCode?.(code) ?? null;
  return target !== null && isSafeHref(target) ? `<a href="${escapeHtml(target)}">${html}</a>` : html;
}

/**
 * Formatage inline : code, gras, italique, liens.
 *
 * Les codes inline sont d'abord mis de côté (un repère à leur place) pour que
 * leur contenu échappe au reste du formatage — sans ça un `*` dans un exemple
 * de commande serait interprété comme de l'italique —, puis remis : un gras
 * peut ainsi contenir du code (`**ne pas `x`**`).
 */
export function renderInline(text: string, options: MarkdownRenderOptions = {}): string {
  const codes: string[] = [];
  const parts = text.replace(/[\uE000\uE001]/g, "").split(/`([^`]+)`/);
  const withSlots = parts.map((part, i) => (i % 2 === 1 ? `\uE000${codes.push(part) - 1}\uE000` : part)).join("");
  return renderEmphasis(withSlots, options, codes).replace(CODE_SLOT, (_m, n: string) => renderCode(codes[Number(n)], options));
}

/**
 * Ancre d'un titre, à la manière de GitHub (minuscules, ponctuation retirée,
 * espaces en tirets) : un lien `#section` écrit pour GitHub mène au même titre.
 */
export function headingAnchor(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Texte brut d'un titre (sans balisage Markdown), pour son ancre. */
function plainHeadingText(text: string): string {
  return text.replace(/\[([^\]]{1,500})\]\([^)]{0,2000}\)/g, "$1").replace(/[`*]/g, ""); // NOSONAR typescript:S8786 — Markdown des dépôts, source de confiance
}

type ListTag = "ul" | "ol";
interface ListLevel {
  indent: number;
  tag: ListTag;
}

/**
 * Une puce indentée de `indent` colonnes ouvre-t-elle un niveau de liste, le
 * niveau ouvert le plus profond étant à `current` colonnes (`undefined` hors
 * liste) ?
 */
function opensListLevel(indent: number, current: number | undefined): boolean {
  return current === undefined || indent > current;
}

/** Cellules d'une ligne de tableau `| a | b |` (une barre échappée `\|` reste du texte). */
export function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
}

/** Langue d'une barrière de code (` ```ts `), réduite à un identifiant sûr. */
function fenceLanguage(line: string): string | null {
  const lang = line.trim().slice(3).trim().split(/\s/)[0] ?? "";
  return /^[\w+#-]{1,20}$/.test(lang) ? lang.toLowerCase() : null;
}

/** Un bloc de code en cours : sa langue et ses lignes. */
interface OpenFence {
  lang: string | null;
  code: string[];
}

const HEADING_LINE = /^(#{1,6})\s+(.*)$/; // NOSONAR typescript:S8786 — Markdown des dépôts, source de confiance
const RULE_LINE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const BULLET_LINE = /^([ \t]*)[-*]\s+(.*)$/; // NOSONAR typescript:S8786 — Markdown des dépôts, source de confiance
const NUMBERED_LINE = /^([ \t]*)(\d{1,9})[.)]\s+(.*)$/; // NOSONAR typescript:S8786 — Markdown des dépôts, source de confiance
const QUOTE_LINE = /^\s{0,3}>\s?(.*)$/; // NOSONAR typescript:S8786 — Markdown des dépôts, source de confiance

const isFence = (line: string) => line.trim().startsWith("```");

/**
 * État du rendu d'un document : chaque sorte de bloc a sa méthode, et
 * {@link renderMarkdown} ne fait que distribuer les lignes.
 */
class MarkdownWriter {
  private readonly out: string[] = [];
  private paragraph: string[] = [];
  private quote: string[] = [];
  // Niveaux de liste ouverts (indentation en colonnes et balise). `liOpen` suit
  // le `<li>` du niveau courant : une sous-liste s'ouvre *à l'intérieur* de ce
  // `<li>`, sinon le HTML produit serait invalide (`<ul>` enfant de `<ul>`).
  private readonly listStack: ListLevel[] = [];
  private liOpen = false;
  private readonly usedAnchors = new Map<string, number>();

  constructor(private readonly options: MarkdownRenderOptions) {}

  private inline(text: string): string {
    return renderInline(text, this.options);
  }

  private closeLi(): void {
    if (this.liOpen) {
      this.out[this.out.length - 1] += "</li>";
      this.liOpen = false;
    }
  }

  private openLevel(indent: number, tag: ListTag, start = 1): void {
    // Une liste numérotée coupée (ligne vide, bloc de code) reprend à son numéro.
    this.out.push(tag === "ol" && start !== 1 ? `<ol start="${start}">` : `<${tag}>`);
    this.listStack.push({ indent, tag });
    this.liOpen = false;
  }

  private closeLevel(): void {
    this.closeLi();
    this.out.push(`</${this.listStack.at(-1)!.tag}>`);
    this.listStack.pop();
    // En remontant d'un cran, le `<li>` parent est toujours ouvert.
    this.liOpen = this.listStack.length > 0;
  }

  private closeList(): void {
    while (this.listStack.length) this.closeLevel();
    this.liOpen = false;
  }

  private closeParagraph(): void {
    if (this.paragraph.length) {
      this.out.push(`<p>${this.inline(this.paragraph.join(" "))}</p>`);
      this.paragraph = [];
    }
  }

  private closeQuote(): void {
    if (this.quote.length) {
      this.out.push(`<blockquote><p>${this.inline(this.quote.join(" "))}</p></blockquote>`);
      this.quote = [];
    }
  }

  flush(): void {
    this.closeParagraph();
    this.closeQuote();
    this.closeList();
  }

  fence({ lang, code }: OpenFence): void {
    const body = escapeHtml(code.join("\n"));
    this.out.push(
      lang ? `<pre data-lang="${lang}"><code class="language-${lang}">${body}</code></pre>` : `<pre><code>${body}</code></pre>`,
    );
  }

  private anchorFor(text: string): string {
    const base = headingAnchor(plainHeadingText(text)) || "section";
    const seen = this.usedAnchors.get(base) ?? 0;
    this.usedAnchors.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen}`;
  }

  heading(marks: string, text: string): void {
    this.flush();
    // Le `#` du fichier devient un h2 : le h1 de la page reste le titre de la doc.
    const level = Math.min(marks.length + 1, 6);
    const id = this.options.headingIds ? ` id="${escapeHtml(this.anchorFor(text.trim()))}"` : "";
    this.out.push(`<h${level}${id}>${this.inline(text.trim())}</h${level}>`);
  }

  rule(): void {
    this.flush();
    this.out.push("<hr>");
  }

  listItem(rawIndent: string, text: string, tag: ListTag, start = 1): void {
    this.closeParagraph();
    this.closeQuote();
    const indent = rawIndent.replace(/\t/g, "  ").length;
    if (opensListLevel(indent, this.listStack.at(-1)?.indent)) {
      this.openLevel(indent, tag, start);
    } else {
      while (this.listStack.length > 1 && indent < this.listStack.at(-1)!.indent) this.closeLevel();
      if (this.listStack.at(-1)!.tag === tag) {
        this.closeLi();
      } else {
        // Même niveau, autre sorte de liste : la liste courante se ferme.
        this.closeLevel();
        this.openLevel(indent, tag, start);
      }
    }
    this.out.push(`<li>${this.inline(text.trim())}`);
    this.liOpen = true;
  }

  quoteLine(text: string): void {
    this.closeParagraph();
    this.closeList();
    if (text.trim()) this.quote.push(text.trim());
  }

  table(rows: string[]): void {
    this.flush();
    const [head, , ...body] = rows.map(tableCells);
    const cells = (row: string[], tag: "th" | "td") => row.map((cell) => `<${tag}>${this.inline(cell)}</${tag}>`).join("");
    const region = this.options.tableLabel
      ? ` role="region" tabindex="0" aria-label="${escapeHtml(this.options.tableLabel)}"`
      : "";
    this.out.push(
      `<div class="docs-table"${region}>\n<table>\n<thead><tr>${cells(head, "th")}</tr></thead>\n<tbody>\n${body
        .map((row) => `<tr>${cells(row, "td")}</tr>`)
        .join("\n")}\n</tbody>\n</table>\n</div>`,
    );
  }

  text(line: string): void {
    // Ligne de suite d'une puce (texte replié sous la puce) : elle prolonge son `<li>`.
    if (this.liOpen) {
      this.out[this.out.length - 1] += ` ${this.inline(line.trim())}`;
      return;
    }
    this.closeList();
    this.closeQuote();
    this.paragraph.push(line.trim());
  }

  /** Une ligne hors bloc de code et hors tableau : titre, filet, liste, citation ou texte. */
  line(line: string): void {
    const heading = HEADING_LINE.exec(line);
    if (heading) return this.heading(heading[1], heading[2]);
    if (RULE_LINE.test(line)) return this.rule();
    const bullet = BULLET_LINE.exec(line);
    if (bullet) return this.listItem(bullet[1], bullet[2], "ul");
    const numbered = NUMBERED_LINE.exec(line);
    if (numbered) return this.listItem(numbered[1], numbered[3], "ol", Number(numbered[2]));
    const quoted = QUOTE_LINE.exec(line);
    if (quoted) return this.quoteLine(quoted[1]);
    this.text(line);
  }

  html(): string {
    return this.out.join("\n");
  }
}

/** Lignes d'un tableau commençant à `start` (en-tête et séparateur compris), ou `null`. */
function tableRowsAt(lines: string[], start: number): string[] | null {
  if (!lines[start].trim().startsWith("|") || start + 1 >= lines.length || !isTableSeparator(lines[start + 1])) return null;
  let end = start + 2;
  while (end < lines.length && lines[end].trim().startsWith("|")) end++;
  return lines.slice(start, end);
}

/**
 * Rend le sous-ensemble Markdown des dépôts : titres, listes (à puces et
 * numérotées), tableaux, citations, filets, blocs de code, paragraphes.
 * Volontairement minimal — pas de dépendance externe, et la source est un
 * contenu de confiance des dépôts du site et du bot.
 */
export function renderMarkdown(markdown: string, options: MarkdownRenderOptions = {}): string {
  const lines = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const writer = new MarkdownWriter(options);
  let fence: OpenFence | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence !== null) {
      if (isFence(line)) {
        writer.fence(fence);
        fence = null;
      } else {
        fence.code.push(line);
      }
      continue;
    }
    if (isFence(line)) {
      writer.flush();
      fence = { lang: fenceLanguage(line), code: [] };
      continue;
    }
    if (!line.trim()) {
      writer.flush();
      continue;
    }
    // Tableau : une ligne à barres suivie de sa ligne de séparation.
    const rows = tableRowsAt(lines, index);
    if (rows) {
      writer.table(rows);
      index += rows.length - 1;
      continue;
    }
    writer.line(line);
  }

  if (fence !== null) writer.fence(fence);
  writer.flush();
  return writer.html();
}
