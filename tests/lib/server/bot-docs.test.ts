import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  BOT_DOC_SECTIONS,
  findBotDocSection,
  headingAnchor,
  isSafeHref,
  isTableSeparator,
  renderInline,
  renderMarkdown,
} from "@/lib/server/bot-docs";
import { visibleBotDocSections, BOT_LEGAL_LINKS } from "@/lib/shared/bot-doc-sections";

describe("findBotDocSection", () => {
  it("retourne la première section quand aucun slug n'est fourni", () => {
    expect(findBotDocSection(undefined, true)).toBe(BOT_DOC_SECTIONS[0]);
  });

  it("résout un slug connu pour le staff", () => {
    expect(findBotDocSection("api-interne", true)?.file).toBe("doc/internal-api.md");
  });

  it("refuse un slug inconnu ou une tentative de traversée de chemin", () => {
    expect(findBotDocSection("inconnu", true)).toBeNull();
    expect(findBotDocSection("../../.env", true)).toBeNull();
  });

  it("n'expose que des slugs uniques", () => {
    const slugs = BOT_DOC_SECTIONS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("cache une page réservée au staff à un visiteur sans rôle", () => {
    expect(findBotDocSection("api-interne", false)).toBeNull();
    expect(findBotDocSection("architecture", false)).toBeNull();
    expect(findBotDocSection("base-de-donnees", false)).toBeNull();
    expect(findBotDocSection("adhesions", false)).toBeNull();
    expect(findBotDocSection("reprise-apres-sinistre", false)).toBeNull();
  });

  it("publie le guide de reprise après sinistre au staff", () => {
    expect(findBotDocSection("reprise-apres-sinistre", true)?.file).toBe("doc/disaster-recovery.md");
  });

  it("garde les pages publiques accessibles sans rôle", () => {
    expect(findBotDocSection("guide", false)?.file).toBe("helpfr.md");
    // Le guide anglais n'a plus d'entrée à lui : c'est le guide sous `/en`.
    expect(findBotDocSection("guide", false)?.fileEn).toBe("help.md");
    expect(findBotDocSection("user-guide-en", false)).toBeNull();
  });
});

describe("visibleBotDocSections", () => {
  it("filtre les sections réservées au staff pour un visiteur sans rôle", () => {
    const sections = visibleBotDocSections(false);
    expect(sections.every((s) => !s.staffOnly)).toBe(true);
    expect(sections.map((s) => s.slug)).toEqual(["guide"]);
  });

  it("rend toutes les sections au staff", () => {
    expect(visibleBotDocSections(true)).toEqual(BOT_DOC_SECTIONS);
  });
});

describe("BOT_LEGAL_LINKS", () => {
  it("pointe vers les pages légales du bot, hors du registre `/bot/docs`", () => {
    expect(BOT_LEGAL_LINKS.map((l) => l.href)).toEqual([
      "/privacy-policy-bot",
      "/terms-of-service-bot",
    ]);
  });

  it("n'expose que des slugs uniques et distincts de `BOT_DOC_SECTIONS`", () => {
    const legalSlugs = BOT_LEGAL_LINKS.map((l) => l.slug);
    expect(new Set(legalSlugs).size).toBe(legalSlugs.length);
    const docSlugs = new Set(BOT_DOC_SECTIONS.map((s) => s.slug));
    for (const slug of legalSlugs) {
      expect(docSlugs.has(slug)).toBe(false);
    }
  });
});

describe("renderInline", () => {
  it("rend le code inline sans lui appliquer gras/italique", () => {
    expect(renderInline("Utilise `/scrim *` maintenant")).toBe(
      "Utilise <code>/scrim *</code> maintenant",
    );
  });

  it("rend gras et italique", () => {
    expect(renderInline("**OGMsg** et *DPMsg*")).toBe(
      "<strong>OGMsg</strong> et <em>DPMsg</em>",
    );
  });

  it("échappe le HTML du contenu source", () => {
    expect(renderInline('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("échappe aussi le HTML à l'intérieur du code inline", () => {
    expect(renderInline("`<script>`")).toBe("<code>&lt;script&gt;</code>");
  });

  it("rend les liens sûrs et neutralise les schémas dangereux", () => {
    expect(renderInline("[site](https://bluegenji.fr)")).toBe(
      '<a href="https://bluegenji.fr" rel="noreferrer">site</a>',
    );
    expect(renderInline("[x](javascript:alert)")).toBe("x");
  });
});

describe("renderMarkdown", () => {
  it("décale les titres d'un niveau (h1 source -> h2 page)", () => {
    expect(renderMarkdown("# Titre\n## Sous-titre")).toBe(
      "<h2>Titre</h2>\n<h3>Sous-titre</h3>",
    );
  });

  it("regroupe les puces consécutives dans une seule liste", () => {
    expect(renderMarkdown("- un\n- deux")).toBe("<ul>\n<li>un</li>\n<li>deux</li>\n</ul>");
  });

  it("ferme la liste avant un paragraphe", () => {
    expect(renderMarkdown("- un\n\nSuite")).toBe("<ul>\n<li>un</li>\n</ul>\n<p>Suite</p>");
  });

  it("imbrique les puces indentées dans le <li> parent", () => {
    // `doc/internal-api.md` documente ses endpoints avec des sous-puces : sans
    // imbrication, le détail d'un endpoint devient son frère dans la liste.
    expect(renderMarkdown("- endpoint\n  - body\n- autre")).toBe(
      "<ul>\n<li>endpoint\n<ul>\n<li>body</li>\n</ul></li>\n<li>autre</li>\n</ul>",
    );
  });

  it("remonte de plusieurs niveaux d'un coup", () => {
    expect(renderMarkdown("- a\n  - b\n    - c\n- d")).toBe(
      "<ul>\n<li>a\n<ul>\n<li>b\n<ul>\n<li>c</li>\n</ul></li>\n</ul></li>\n<li>d</li>\n</ul>",
    );
  });

  it("ferme tous les niveaux imbriqués en fin de document", () => {
    expect(renderMarkdown("- a\n  - b")).toBe("<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n</ul>");
  });

  it("traite une tabulation comme une indentation", () => {
    expect(renderMarkdown("- a\n\t- b")).toBe("<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n</ul>");
  });

  it("fusionne les lignes d'un même paragraphe", () => {
    expect(renderMarkdown("une phrase\ncoupée")).toBe("<p>une phrase coupée</p>");
  });

  it("rend les blocs de code sans interpréter leur contenu", () => {
    expect(renderMarkdown("```\n- pas une puce\n```")).toBe(
      "<pre><code>- pas une puce</code></pre>",
    );
  });

  it("ferme un bloc de code non terminé", () => {
    expect(renderMarkdown("```\nligne")).toBe("<pre><code>ligne</code></pre>");
  });

  it("ignore le BOM en tête de fichier", () => {
    expect(renderMarkdown("\uFEFF# Titre")).toBe("<h2>Titre</h2>");
  });

  it("gère les fins de ligne Windows", () => {
    expect(renderMarkdown("# Titre\r\n\r\n- un")).toBe("<h2>Titre</h2>\n<ul>\n<li>un</li>\n</ul>");
  });

  it("renvoie une chaîne vide pour un document vide", () => {
    expect(renderMarkdown("")).toBe("");
  });
});

describe("loadBotDoc", () => {
  let dir: string;
  // Le dossier du bot est résolu à l'import du module : on recharge une
  // instance dédiée pointant sur un faux projet bot.
  let mod: typeof import("@/lib/server/bot-docs");

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "bot-docs-"));
    await fs.writeFile(path.join(dir, "helpfr.md"), "# Aide\n\n- `LFS`\n", "utf8");

    process.env.BOT_DOCS_PATH = dir;
    jest.resetModules();
    mod = await import("@/lib/server/bot-docs");
  });

  afterAll(async () => {
    delete process.env.BOT_DOCS_PATH;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("pointe sur le dossier du bot fourni par BOT_DOCS_PATH", () => {
    expect(mod.BOT_PROJECT_DIR).toBe(dir);
  });

  it("lit et rend un document présent sur le disque", async () => {
    const doc = await mod.loadBotDoc({ ...BOT_DOC_SECTIONS[0], file: "helpfr.md" });
    expect(doc.html).toContain("<h2>Aide</h2>");
    expect(doc.html).toContain("<code>LFS</code>");
    expect(doc.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("dégrade proprement quand le fichier est absent", async () => {
    const doc = await mod.loadBotDoc({ ...BOT_DOC_SECTIONS[0], file: "nope.md" });
    expect(doc.html).toBeNull();
    expect(doc.updatedAt).toBeNull();
  });

  // La page promettait ce délai par un `revalidate` qui ne met plus rien en
  // cache (tout le site est rendu à la demande) : chaque vue relisait le disque.
  it("resert un document déjà rendu au lieu de relire le disque", async () => {
    const { clearCache } = await import("@/lib/server/cache");
    clearCache();
    const section = { ...BOT_DOC_SECTIONS[0], file: "cache.md" };
    await fs.writeFile(path.join(dir, "cache.md"), "# Avant\n", "utf8");

    const first = await mod.loadBotDocCached(section);
    await fs.writeFile(path.join(dir, "cache.md"), "# Après\n", "utf8");
    const second = await mod.loadBotDocCached(section);

    expect(first.html).toContain("Avant");
    expect(second).toBe(first);
    // La lecture brute, elle, voit la nouvelle version : seul le cache retient.
    expect((await mod.loadBotDoc(section)).html).toContain("Après");
    expect(mod.BOT_DOC_TTL_MS).toBe(60_000);
    clearCache();
  });

  it("ne mélange pas deux documents du registre", async () => {
    const { clearCache } = await import("@/lib/server/cache");
    clearCache();
    await fs.writeFile(path.join(dir, "other.md"), "# Autre\n", "utf8");

    const help = await mod.loadBotDocCached({ ...BOT_DOC_SECTIONS[0], file: "helpfr.md" });
    const other = await mod.loadBotDocCached({ ...BOT_DOC_SECTIONS[0], file: "other.md" });

    expect(help.html).toContain("Aide");
    expect(other.html).toContain("Autre");
    clearCache();
  });
});

describe("renderMarkdown — blocs de /devdoc", () => {
  it("renderMarkdown_tableWithSeparator_rendersHeadAndBody", () => {
    expect(renderMarkdown("| a | b |\n|---|:-:|\n| 1 | `x` |")).toBe(
      '<div class="docs-table">\n<table>\n<thead><tr><th>a</th><th>b</th></tr></thead>\n<tbody>\n<tr><td>1</td><td><code>x</code></td></tr>\n</tbody>\n</table>\n</div>',
    );
  });

  it("renderMarkdown_tableWithLabel_wrapsInFocusableRegion", () => {
    expect(renderMarkdown("| a |\n|---|\n| 1 |", { tableLabel: 'Table "x"' })).toContain(
      '<div class="docs-table" role="region" tabindex="0" aria-label="Table &quot;x&quot;">',
    );
  });

  it("renderMarkdown_tableWithoutLabel_wrapsWithoutRegionRole", () => {
    expect(renderMarkdown("| a |\n|---|\n| 1 |")).not.toContain("role=");
  });


  it("renderMarkdown_barsWithoutSeparator_staysParagraph", () => {
    expect(renderMarkdown("| a |\nsuite")).toBe("<p>| a | suite</p>");
  });

  it("renderMarkdown_orderedList_rendersOl", () => {
    expect(renderMarkdown("1. un\n2. deux")).toBe("<ol>\n<li>un</li>\n<li>deux</li>\n</ol>");
  });

  it("renderMarkdown_orderedThenBullet_switchesList", () => {
    expect(renderMarkdown("1. un\n- deux")).toBe("<ol>\n<li>un</li>\n</ol>\n<ul>\n<li>deux</li>\n</ul>");
  });

  it("renderMarkdown_wrappedBulletLine_continuesItem", () => {
    expect(renderMarkdown("- un\n  suite\n- deux")).toBe("<ul>\n<li>un suite</li>\n<li>deux</li>\n</ul>");
  });

  it("renderMarkdown_textAfterBlankLine_closesList", () => {
    expect(renderMarkdown("- un\n\nsuite")).toBe("<ul>\n<li>un</li>\n</ul>\n<p>suite</p>");
  });

  it("renderMarkdown_blockquote_joinsLines", () => {
    expect(renderMarkdown("> cité\n> suite")).toBe("<blockquote><p>cité suite</p></blockquote>");
  });

  it("renderMarkdown_rule_rendersHr", () => {
    expect(renderMarkdown("---")).toBe("<hr>");
  });

  it("renderMarkdown_fenceWithLanguage_tagsBlock", () => {
    expect(renderMarkdown("```ts\nconst a = 1;\n```")).toBe(
      '<pre data-lang="ts"><code class="language-ts">const a = 1;</code></pre>',
    );
  });

  it("renderMarkdown_headingIds_dedupesAnchors", () => {
    expect(renderMarkdown("# Titre\n## Titre", { headingIds: true })).toBe(
      '<h2 id="titre">Titre</h2>\n<h3 id="titre-1">Titre</h3>',
    );
  });

  it("renderMarkdown_noOptions_noHeadingIds", () => {
    expect(renderMarkdown("## Titre")).toBe("<h3>Titre</h3>");
  });
});

describe("renderInline — options de liens", () => {
  it("renderInline_resolverRefuses_keepsLabelOnly", () => {
    expect(renderInline("[x](a.md)", { resolveLink: () => null })).toBe("x");
  });

  it("renderInline_resolverReturnsUnsafeScheme_dropsLink", () => {
    expect(renderInline("[x](a.md)", { resolveLink: () => "javascript:alert(1)" })).toBe("x");
  });

  it("renderInline_linkCodeResolves_wrapsCodeInLink", () => {
    expect(renderInline("`A.md`", { linkCode: () => "/devdoc/site/A" })).toBe(
      '<a href="/devdoc/site/A"><code>A.md</code></a>',
    );
  });

  it("renderInline_linkCodeRefuses_keepsPlainCode", () => {
    expect(renderInline("`A.md`", { linkCode: () => null })).toBe("<code>A.md</code>");
  });
});

describe("renderInline — code dans le formatage", () => {
  it("renderInline_boldAroundCode_keepsBoldAndCode", () => {
    expect(renderInline("**ne pas `disabled` natif**")).toBe("<strong>ne pas <code>disabled</code> natif</strong>");
  });

  it("renderInline_codeLabelInLink_neverNestsLinks", () => {
    expect(renderInline("[`X.md`](https://example.org)", { linkCode: () => "/devdoc/x" })).toBe(
      '<a href="https://example.org" rel="noreferrer"><code>X.md</code></a>',
    );
  });

  it("renderInline_slotMarkerInSource_isDropped", () => {
    expect(renderInline("a\uE0000\uE000 b")).toBe("a0 b");
  });
});

describe("headingAnchor", () => {
  it("headingAnchor_punctuationAndAccents_githubLikeSlug", () => {
    expect(headingAnchor("Été & co — `x`")).toBe("été--co--x");
  });
});

describe("renderInline — cible de lien et emphase (revue cycle 1)", () => {
  it("renderInline_linkTargetContainsInlineCode_isNotALink", () => {
    const html = renderInline("[x](https://a/`B.md`)", { linkCode: () => "/devdoc/site/B" });
    expect(html).not.toContain('href="https://a/');
    expect(html).toBe('[x](https://a/<a href="/devdoc/site/B"><code>B.md</code></a>)');
  });

  it("renderInline_asteriskInLinkTarget_emphasisNeverEntersHref", () => {
    expect(renderInline("[a](https://x/*) and *b*")).toBe('<a href="https://x/*" rel="noreferrer">a</a> and <em>b</em>');
  });

  it("renderInline_boldAroundLink_wrapsAnchor", () => {
    expect(renderInline("**[a](https://x)**")).toBe('<strong><a href="https://x" rel="noreferrer">a</a></strong>');
  });

  it("renderInline_emphasisInLinkLabel_rendered", () => {
    expect(renderInline("[**a**](https://x)")).toBe('<a href="https://x" rel="noreferrer"><strong>a</strong></a>');
  });

  it("renderInline_linkSlotMarkerInSource_isDropped", () => {
    expect(renderInline("a\uE0010\uE001 b")).toBe("a0 b");
  });
});

describe("renderMarkdown — numérotation des listes coupées (revue cycle 1)", () => {
  it("renderMarkdown_numberedListSplitByBlankLine_continuesNumbering", () => {
    expect(renderMarkdown("1. un\n\n2. deux")).toBe("<ol>\n<li>un</li>\n</ol>\n<ol start=\"2\">\n<li>deux</li>\n</ol>");
  });

  it("renderMarkdown_numberedListAfterCodeBlock_keepsNumber", () => {
    expect(renderMarkdown("```sh\nx\n```\n3. trois")).toContain('<ol start="3">\n<li>trois</li>');
  });

  it("renderMarkdown_numberedListStartingAtOne_noStartAttribute", () => {
    expect(renderMarkdown("1. a\n2. b")).toBe("<ol>\n<li>a</li>\n<li>b</li>\n</ol>");
  });
});

/** Revue de sécurité, cycle 1 : cibles hors site, motifs en temps linéaire, tableaux nommés. */
describe("revue sécurité cycle 1 — rendu Markdown", () => {
  it("isSafeHref_protocolRelative_rejected", () => {
    expect(isSafeHref("//evil.example/phish")).toBe(false);
    expect(renderInline("[Guide](//evil.example/phish)")).toBe("Guide");
  });

  it("isSafeHref_backslashHost_rejected", () => {
    expect(isSafeHref("/\\evil.example")).toBe(false);
  });

  it("isSafeHref_singleSlashPath_accepted", () => {
    expect(isSafeHref("/regles")).toBe(true);
    expect(renderInline("[r](/regles)")).toBe('<a href="/regles" rel="noreferrer">r</a>');
  });

  it("renderInline_manyOpenBrackets_rendersInLinearTime", () => {
    const line = "[".repeat(200_000);
    const start = performance.now();
    renderInline(line);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("renderInline_repeatedUnclosedLinkTargets_rendersInLinearTime", () => {
    const line = "[a](".repeat(100_000);
    const start = performance.now();
    renderInline(line);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("renderInline_nestedBracketLabel_onlyInnerLinkRendered", () => {
    expect(renderInline("[a [b](/x)")).toBe('[a <a href="/x" rel="noreferrer">b</a>');
  });

  it("isTableSeparator_alignedCells_true", () => {
    expect(isTableSeparator("| :-- | :-: | --: |")).toBe(true);
    expect(isTableSeparator("---|---")).toBe(true);
  });

  it("isTableSeparator_emptyOrTextCell_false", () => {
    expect(isTableSeparator("| --- |  |")).toBe(false);
    expect(isTableSeparator("| --- | a |")).toBe(false);
    expect(isTableSeparator("|")).toBe(false);
  });

  it("isTableSeparator_longSpaceLine_answersInLinearTime", () => {
    const line = `|${" ".repeat(200_000)}x`;
    const start = performance.now();
    expect(isTableSeparator(line)).toBe(false);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("renderMarkdown_tableAfterLongSpaceLine_rendersQuickly", () => {
    const start = performance.now();
    renderMarkdown(`| a |\n${" ".repeat(100_000)}x`);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("renderMarkdown_tableLabel_namesScrollRegion", () => {
    const table = "| a | b |\n|---|---|\n| 1 | 2 |";
    expect(renderMarkdown(table, { tableLabel: "Table, scrollable" })).toContain(
      '<div class="docs-table" role="region" tabindex="0" aria-label="Table, scrollable">',
    );
    expect(renderMarkdown(table)).toContain('<div class="docs-table">');
  });
});
