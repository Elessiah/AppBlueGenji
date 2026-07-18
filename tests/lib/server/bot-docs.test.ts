import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  BOT_DOC_SECTIONS,
  findBotDocSection,
  renderInline,
  renderMarkdown,
} from "@/lib/server/bot-docs";

describe("findBotDocSection", () => {
  it("retourne la première section quand aucun slug n'est fourni", () => {
    expect(findBotDocSection(undefined)).toBe(BOT_DOC_SECTIONS[0]);
  });

  it("résout un slug connu", () => {
    expect(findBotDocSection("api-interne")?.file).toBe("doc/internal-api.md");
  });

  it("refuse un slug inconnu ou une tentative de traversée de chemin", () => {
    expect(findBotDocSection("inconnu")).toBeNull();
    expect(findBotDocSection("../../.env")).toBeNull();
  });

  it("n'expose que des slugs uniques", () => {
    const slugs = BOT_DOC_SECTIONS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
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
    expect(renderMarkdown("﻿# Titre")).toBe("<h2>Titre</h2>");
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
});
