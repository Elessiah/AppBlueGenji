/**
 * Documentation développeur `/devdoc` (`docs/features/DEVDOC.md`) : logique
 * pure — adresses, regroupement, recherche, réécriture des liens entre
 * documents. La lecture du disque vit dans `lib/server/dev-docs.ts`.
 */
import { BOT_SOURCE_URL, SOURCE_CODE_URL } from "@/lib/shared/source-code";

/** Les deux dépôts documentés, dans l'ordre de la navigation. */
export const DEV_DOC_REPOS = ["site", "bot"] as const;
export type DevDocRepo = (typeof DEV_DOC_REPOS)[number];

/** Racine de la page. */
export const DEVDOC_PATH = "/devdoc";

/** Document ouvert par `/devdoc` seul : l'index des fonctionnalités du site. */
export const DEFAULT_DEV_DOC: { repo: DevDocRepo; slug: string } = { repo: "site", slug: "features/INDEX" };

/** Dépôt public de chaque projet : cible des liens vers un fichier qui n'est pas un document. */
export const DEV_DOC_SOURCE_URLS: Record<DevDocRepo, string> = {
  site: SOURCE_CODE_URL,
  bot: BOT_SOURCE_URL,
};

/** Un document listé : ce que la navigation et la recherche en savent. */
export interface DevDocSummary {
  repo: DevDocRepo;
  /** Segment d'adresse sous `/devdoc/<repo>/`, sans `.md` (`features/BUSY_BUTTONS`). */
  slug: string;
  /** Chemin du fichier relatif à la racine du dépôt, séparateurs `/` (`docs/features/BUSY_BUTTONS.md`). */
  path: string;
  /** Premier titre `#` du fichier, à défaut son nom. */
  title: string;
}

export function isDevDocRepo(value: unknown): value is DevDocRepo {
  return typeof value === "string" && (DEV_DOC_REPOS as readonly string[]).includes(value);
}

/**
 * Segment d'adresse d'un fichier de dépôt : pour le site, le chemin sous
 * `docs/` (un fichier de la racine du dépôt garde son seul nom) ; pour le bot,
 * le chemin depuis la racine du dépôt. Toujours sans `.md`. `null` : pas un
 * document Markdown.
 */
export function devDocSlug(repo: DevDocRepo, path: string): string | null {
  if (!path.endsWith(".md") || path === ".md") return null;
  const bare = path.slice(0, -".md".length);
  if (repo === "site" && bare.startsWith("docs/")) return bare.slice("docs/".length);
  return bare;
}

/** Adresse (sans préfixe de langue) d'un document, ancre comprise. */
export function devDocHref(repo: DevDocRepo, slug: string, hash = ""): string {
  const encoded = slug.split("/").map(encodeURIComponent).join("/");
  return `${DEVDOC_PATH}/${repo}/${encoded}${hash}`;
}

/**
 * Lit les segments reçus de l'adresse (`[[...path]]`). `null` : adresse qui
 * ne peut désigner aucun document — dépôt inconnu, segment vide, `.` ou `..`,
 * barre oblique ou inverse, caractère nul, encodage invalide. Aucun segment :
 * le document par défaut.
 *
 * Ce filtre n'est qu'une première porte : le document n'est ensuite cherché
 * **que** dans l'index des fichiers listés (`lib/server/dev-docs.ts`), jamais
 * par un chemin construit depuis l'adresse.
 */
export function parseDevDocParams(segments: readonly string[] | undefined): { repo: DevDocRepo; slug: string } | null {
  if (!segments || segments.length === 0) return DEFAULT_DEV_DOC;
  const decoded: string[] = [];
  for (const segment of segments) {
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (value === "" || value === "." || value === ".." || /[/\\\0]/.test(value)) return null;
    decoded.push(value);
  }
  const [repo, ...rest] = decoded;
  if (!isDevDocRepo(repo) || rest.length === 0) return null;
  return { repo, slug: rest.join("/") };
}

/** Dossier d'un fichier (`docs/features`), `""` à la racine du dépôt. */
export function devDocFolder(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

export interface DevDocFolderGroup {
  /** Dossier relatif à la racine du dépôt, `""` pour la racine. */
  folder: string;
  docs: DevDocSummary[];
}

export interface DevDocRepoGroup {
  repo: DevDocRepo;
  folders: DevDocFolderGroup[];
}

function isIndexDoc(doc: DevDocSummary): boolean {
  return doc.path === "INDEX.md" || doc.path.endsWith("/INDEX.md");
}

/** Ordre des documents d'un dossier : `INDEX` d'abord, puis le nom de fichier. */
function compareDocs(a: DevDocSummary, b: DevDocSummary): number {
  const aIndex = isIndexDoc(a);
  if (aIndex !== isIndexDoc(b)) return aIndex ? -1 : 1;
  return a.path.localeCompare(b.path, "fr", { sensitivity: "base" });
}

/** Ordre des dossiers : la racine d'abord, puis l'ordre alphabétique. */
function compareFolders(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return -1;
  if (b === "") return 1;
  return a.localeCompare(b, "fr", { sensitivity: "base" });
}

/**
 * Arborescence de la navigation : par dépôt (site puis bot), puis par dossier
 * (la racine d'abord, puis l'ordre alphabétique), `INDEX` en tête de son
 * dossier. Un dépôt sans document reste listé, vide.
 */
export function groupDevDocs(docs: readonly DevDocSummary[]): DevDocRepoGroup[] {
  return DEV_DOC_REPOS.map((repo) => {
    const byFolder = new Map<string, DevDocSummary[]>();
    for (const doc of docs) {
      if (doc.repo !== repo) continue;
      const folder = devDocFolder(doc.path);
      const list = byFolder.get(folder) ?? [];
      list.push(doc);
      byFolder.set(folder, list);
    }
    const folders = [...byFolder.entries()]
      .sort(([a], [b]) => compareFolders(a, b))
      .map(([folder, list]) => ({ folder, docs: [...list].sort(compareDocs) }));
    return { repo, folders };
  });
}

/** Texte de recherche : minuscules, sans accents, `_` et espaces réduits à une espace. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .trim();
}

/**
 * Documents dont le titre ou le chemin contient **chaque** mot de la
 * recherche (insensible à la casse, aux accents et aux `_`). Recherche vide :
 * tous les documents.
 */
export function filterDevDocs(docs: readonly DevDocSummary[], query: string): DevDocSummary[] {
  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  if (terms.length === 0) return [...docs];
  return docs.filter((doc) => {
    const haystack = normalizeSearch(`${doc.title} ${doc.path}`);
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * Chemin `a/b/../c` ramené à sa forme simple. `null` : il sort du dépôt (`..`
 * au-delà de la racine).
 */
export function normalizeRepoPath(path: string): string | null {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

/** Cherche un document par son chemin dans un dépôt (`docs/features/X.md`). */
export type DevDocLookup = (repo: DevDocRepo, path: string) => DevDocSummary | null;

/** Le document ouvert : point de départ des liens relatifs. */
export interface DevDocOrigin {
  repo: DevDocRepo;
  path: string;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * Adresse d'un lien `[texte](cible)` d'un document :
 *
 * - ancre, `https://`, `http://`, `mailto:` et chemin du site (`/…`) : tels quels ;
 * - chemin relatif vers un document listé : sa page `/devdoc/…`, ancre gardée ;
 * - chemin relatif vers un autre fichier du dépôt (code, image, dossier) : ce
 *   fichier sur GitHub (dépôts publics) ;
 * - chemin qui sort du dépôt, autre schéma (`javascript:`…), `//hôte` : `null`
 *   (texte seul).
 */
export function resolveDevDocLink(href: string, origin: DevDocOrigin, lookup: DevDocLookup): string | null {
  const target = href.trim();
  if (target === "") return null;
  if (target.startsWith("#")) return target;
  if (/^(https?:\/\/|mailto:)/i.test(target)) return target;
  if (target.startsWith("//") || target.startsWith("/\\")) return null;
  if (target.startsWith("/")) return target;
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return null;

  const hashAt = target.indexOf("#");
  const beforeHash = hashAt === -1 ? target : target.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : target.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  const rawPath = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const decoded = safeDecode(rawPath);
  if (decoded === null || decoded.includes("\\")) return null;
  const base = devDocFolder(origin.path);
  const resolved = normalizeRepoPath(base ? `${base}/${decoded}` : decoded);
  if (resolved === null) return null;
  if (resolved === "") return DEV_DOC_SOURCE_URLS[origin.repo];

  const doc = lookup(origin.repo, resolved);
  if (doc) return devDocHref(doc.repo, doc.slug, hash);
  return `${DEV_DOC_SOURCE_URLS[origin.repo]}/blob/main/${encodePath(resolved)}${hash}`;
}

/** Dossiers où un nom de document cité seul (`` `AUTH_SYSTEM.md` ``) est cherché, par dépôt. */
const CODE_REFERENCE_FOLDERS: Record<DevDocRepo, readonly string[]> = {
  site: ["docs/features", "docs"],
  bot: ["doc", "dev-notes"],
};

/**
 * Adresse d'un code inline qui nomme un document (`` `BUSY_BUTTONS.md` ``,
 * `` `docs/DATABASE_SCHEMA.md` ``) : relatif au document ouvert, puis depuis la
 * racine du dépôt, puis dans les dossiers de documentation du dépôt. `null` :
 * le code ne nomme aucun document listé — il reste du code.
 */
export function resolveDevDocCodeRef(code: string, origin: DevDocOrigin, lookup: DevDocLookup): string | null {
  const match = /^([\w.\-/]+\.md)(#[\w-]+)?$/.exec(code.trim());
  if (!match) return null;
  const [, file, hash = ""] = match;
  const base = devDocFolder(origin.path);
  const candidates = [
    base ? `${base}/${file}` : file,
    file,
    ...CODE_REFERENCE_FOLDERS[origin.repo].map((folder) => `${folder}/${file}`),
  ];
  for (const candidate of candidates) {
    const resolved = normalizeRepoPath(candidate);
    if (resolved === null) continue;
    const doc = lookup(origin.repo, resolved);
    if (doc) return devDocHref(doc.repo, doc.slug, hash);
  }
  return null;
}

const FRENCH_WORDS = new Set(["le", "la", "les", "des", "est", "une", "du", "et", "pour", "dans", "qui", "sur", "pas", "au"]);
const ENGLISH_WORDS = new Set(["the", "and", "is", "of", "to", "for", "in", "that", "with", "it", "are", "this", "be"]);

/**
 * Langue d'un document, devinée sur ses mots les plus courants (les dépôts
 * mêlent français et anglais) : sert à son attribut `lang`. Égalité ou texte
 * sans mot reconnu : français, la langue de travail des dépôts.
 */
export function guessDocLanguage(markdown: string): "fr" | "en" {
  let french = 0;
  let english = 0;
  const prose = markdown.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
  for (const word of prose.toLowerCase().match(/[a-zà-ÿ]+/g) ?? []) {
    if (FRENCH_WORDS.has(word)) french++;
    else if (ENGLISH_WORDS.has(word)) english++;
  }
  return english > french ? "en" : "fr";
}

/** Une entrée du sommaire d'un document : titre `##` (niveau 2) ou `###` (niveau 3) du fichier et son ancre. */
export interface DevDocOutlineItem {
  id: string;
  text: string;
  level: 2 | 3;
}

/** Au moins ce nombre de titres pour qu'un sommaire serve (en dessous, le document tient d'un coup d'œil). */
export const DEV_DOC_OUTLINE_MIN = 4;

function plainHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/**
 * Sommaire d'un document rendu avec ses ancres (`headingIds`) : ses titres de
 * `##` et `###` du fichier (le `#` est le titre de la page), dans l'ordre. Vide sous {@link DEV_DOC_OUTLINE_MIN} titres.
 * Lit le HTML produit par `renderMarkdown` (source de confiance), jamais une
 * entrée utilisateur.
 */
export function docOutline(html: string): DevDocOutlineItem[] {
  const items: DevDocOutlineItem[] = [];
  for (const match of html.matchAll(/<h([34]) id="([^"]+)">(.*?)<\/h\1>/g)) { // NOSONAR typescript:S8786 — HTML rendu par nous
    const text = plainHtml(match[3]).trim();
    if (text) items.push({ id: plainHtml(match[2]), text, level: match[1] === "3" ? 2 : 3 });
  }
  return items.length >= DEV_DOC_OUTLINE_MIN ? items : [];
}
