import fs from "node:fs/promises";
import path from "node:path";
import { BOT_PROJECT_DIR, renderMarkdown } from "@/lib/server/bot-docs";
import { cached } from "@/lib/server/cache";
import {
  DEV_DOC_REPOS,
  devDocSlug,
  guessDocLanguage,
  resolveDevDocCodeRef,
  resolveDevDocLink,
  type DevDocLookup,
  type DevDocRepo,
  type DevDocSummary,
} from "@/lib/shared/dev-docs";

/**
 * Documentation développeur `/devdoc` (`docs/features/DEVDOC.md`) : lecture
 * des Markdown des deux dépôts, relus à chaud comme ceux de `/bot/docs`.
 *
 * **Liste blanche.** Une adresse ne touche jamais le disque : elle est cherchée
 * dans l'index des fichiers listés au préalable (`buildDevDocIndex`), qui ne
 * retient que des fichiers `.md` ordinaires — ni lien symbolique, ni dossier
 * caché — dont le chemin réel reste sous les dossiers autorisés de chaque
 * dépôt. Le fichier lu est celui de l'index, jamais un chemin bâti depuis
 * l'adresse.
 */

/** Racine du dépôt du site : le dossier d'où tourne l'application (`~/apps/AppBlueGenji` en production). */
export const SITE_PROJECT_DIR = process.cwd();

interface DevDocSource {
  /** Racine du dépôt. */
  root: string;
  /** Dossiers parcourus récursivement, relatifs à la racine. */
  dirs: readonly string[];
  /** Fichiers isolés de la racine. */
  files: readonly string[];
}

/**
 * Ce qui est lisible, par dépôt. Le site : tout `docs/` et les fichiers de
 * travail de la racine. Le bot : sa doc (`doc/`, servie aussi sur `/bot/docs`),
 * ses notes de développement (`dev-notes/`) et les fichiers de sa racine — pas
 * ses conditions (`LegalTerms/`, servies sur leurs propres pages).
 */
export function devDocSources(): Record<DevDocRepo, DevDocSource> {
  return {
    site: { root: SITE_PROJECT_DIR, dirs: ["docs"], files: ["CLAUDE.md", "README.md", "ACCESSIBILITE.md"] },
    bot: { root: BOT_PROJECT_DIR, dirs: ["doc", "dev-notes"], files: ["helpfr.md", "help.md", "README.md", "CLAUDE.md"] },
  };
}

/** Profondeur maximale de dossiers parcourue sous un dossier autorisé. */
const MAX_DEPTH = 6;
/** Plafond de documents par dépôt : un dossier imprévu ne fait pas exploser l'index. */
export const MAX_DOCS_PER_REPO = 1000;
/** Taille maximale d'un document lu (1 Mo) : au-delà, il est ignoré. */
export const MAX_DOC_BYTES = 1024 * 1024;
/**
 * Durée pendant laquelle l'index est resservi tel quel. Un document, lui, est
 * relu et rendu à chaque vue : la page n'a qu'une poignée de lecteurs, et
 * garder ~200 rendus par langue dans le cache commun en chasserait des
 * entrées plus utiles.
 */
export const DEV_DOC_TTL_MS = 60_000;

interface IndexedDoc {
  summary: DevDocSummary;
  /** Chemin absolu réel du fichier. */
  file: string;
}

export interface DevDocIndex {
  docs: DevDocSummary[];
  /** `<dépôt>:<chemin relatif>` → document. */
  byPath: Map<string, IndexedDoc>;
  /** `<dépôt>:<slug>` → document. */
  bySlug: Map<string, IndexedDoc>;
}

const key = (repo: DevDocRepo, value: string) => `${repo}:${value}`;

/** `child` est-il `parent` lui-même ou sous lui ? */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Titre d'un document : son premier titre `#`, à défaut le nom du fichier. */
export function devDocTitle(markdown: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown.replace(/^﻿/, ""));
  const title = heading?.[1].replace(/[`*]/g, "").replace(/\s+#*\s*$/, "").trim();
  return title || fallback;
}

/**
 * Fichier candidat : un `.md` ordinaire (jamais un lien symbolique), dont le
 * chemin réel reste sous `allowedReal`, de taille raisonnable. Rend son titre,
 * ou `null`.
 */
async function readCandidate(file: string, allowedReal: string): Promise<{ real: string; title: string } | null> {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DOC_BYTES) return null;
  const real = await fs.realpath(file).catch(() => null);
  if (!real || !isInside(allowedReal, real)) return null;
  const raw = await fs.readFile(real, "utf8").catch(() => null);
  if (raw === null) return null;
  return { real, title: devDocTitle(raw, path.basename(file, ".md")) };
}

async function walk(dir: string, depth: number, found: string[]): Promise<void> {
  if (depth > MAX_DEPTH || found.length >= MAX_DOCS_PER_REPO) return;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (found.length >= MAX_DOCS_PER_REPO) return;
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, depth + 1, found);
    else if (entry.isFile() && entry.name.endsWith(".md")) found.push(full);
  }
}

async function indexRepo(repo: DevDocRepo, source: DevDocSource): Promise<IndexedDoc[]> {
  const rootReal = await fs.realpath(source.root).catch(() => null);
  if (!rootReal) return [];
  const docs: IndexedDoc[] = [];
  const seenSlugs = new Set<string>();
  const add = async (file: string, allowedReal: string) => {
    const candidate = await readCandidate(file, allowedReal);
    if (!candidate) return;
    const relative = path.relative(rootReal, candidate.real).split(path.sep).join("/");
    const slug = devDocSlug(repo, relative);
    if (!slug || seenSlugs.has(slug) || docs.length >= MAX_DOCS_PER_REPO) return;
    seenSlugs.add(slug);
    docs.push({ summary: { repo, slug, path: relative, title: candidate.title }, file: candidate.real });
  };

  for (const dir of source.dirs) {
    const dirReal = await fs.realpath(path.join(rootReal, dir)).catch(() => null);
    // Un dossier autorisé qui serait lui-même un lien hors du dépôt : ignoré.
    if (!dirReal || !isInside(rootReal, dirReal)) continue;
    const files: string[] = [];
    await walk(dirReal, 0, files);
    for (const file of files) await add(file, dirReal);
  }
  for (const name of source.files) await add(path.join(rootReal, name), rootReal);
  return docs;
}

/** Liste les documents des deux dépôts (sans cache — la page passe par {@link loadDevDocIndex}). */
export async function buildDevDocIndex(sources: Record<DevDocRepo, DevDocSource> = devDocSources()): Promise<DevDocIndex> {
  const perRepo = await Promise.all(DEV_DOC_REPOS.map((repo) => indexRepo(repo, sources[repo])));
  const all = perRepo.flat();
  return {
    docs: all.map((doc) => doc.summary),
    byPath: new Map(all.map((doc) => [key(doc.summary.repo, doc.summary.path), doc])),
    bySlug: new Map(all.map((doc) => [key(doc.summary.repo, doc.summary.slug), doc])),
  };
}

/** {@link buildDevDocIndex}, refait au plus une fois par minute. */
export function loadDevDocIndex(): Promise<DevDocIndex> {
  return cached("devdoc:index", DEV_DOC_TTL_MS, () => buildDevDocIndex());
}

/** Le document d'une adresse, cherché dans l'index seulement. */
export function findDevDoc(index: DevDocIndex, repo: DevDocRepo, slug: string): DevDocSummary | null {
  return index.bySlug.get(key(repo, slug))?.summary ?? null;
}

export interface LoadedDevDoc {
  summary: DevDocSummary;
  /** HTML rendu (liens réécrits), ou `null` si le fichier n'a pas pu être relu. */
  html: string | null;
  /** Dernière modification du fichier, ISO, ou `null`. */
  updatedAt: string | null;
  /** Langue du document (`guessDocLanguage`), pour son attribut `lang`. */
  language: "fr" | "en";
}

/**
 * Lit et rend un document de l'index. Les liens entre documents mènent à leur
 * page `/devdoc` (passée par `localize`, qui pose le préfixe de langue), les
 * autres fichiers des dépôts à GitHub ; un code inline qui nomme un document
 * devient un lien.
 */
export async function renderDevDoc(
  index: DevDocIndex,
  summary: DevDocSummary,
  localize: (href: string) => string = (href) => href,
): Promise<LoadedDevDoc> {
  const entry = index.bySlug.get(key(summary.repo, summary.slug));
  if (!entry) return { summary, html: null, updatedAt: null, language: "fr" };
  const lookup: DevDocLookup = (repo, relative) => index.byPath.get(key(repo, relative))?.summary ?? null;
  const origin = { repo: summary.repo, path: summary.path };
  const internal = (href: string | null) => (href?.startsWith("/devdoc/") ? localize(href) : href);
  try {
    const [raw, stat] = await Promise.all([fs.readFile(entry.file, "utf8"), fs.stat(entry.file)]);
    const html = renderMarkdown(raw, {
      headingIds: true,
      resolveLink: (href) => internal(resolveDevDocLink(href, origin, lookup)),
      linkCode: (code) => internal(resolveDevDocCodeRef(code, origin, lookup)),
    });
    return { summary, html, updatedAt: stat.mtime.toISOString(), language: guessDocLanguage(raw) };
  } catch {
    return { summary, html: null, updatedAt: null, language: "fr" };
  }
}
