import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MAX_DOC_BYTES,
  buildDevDocIndex,
  devDocTitle,
  findDevDoc,
  renderDevDoc,
  type DevDocIndex,
} from "@/lib/server/dev-docs";
import { SOURCE_CODE_URL } from "@/lib/shared/source-code";

/**
 * Index de `/devdoc` sur deux faux dépôts : seuls les `.md` ordinaires des
 * dossiers autorisés entrent, et un document rendu mène aux autres par
 * `/devdoc` (`docs/features/DEVDOC.md`).
 */
let base: string;
let site: string;
let bot: string;
let index: DevDocIndex;
let symlinkCreated = false;

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "devdoc-"));
  site = path.join(base, "site");
  bot = path.join(base, "bot");
  await write(path.join(site, "docs/features/INDEX.md"), "# Index\n\n- `BUSY_BUTTONS.md` — boutons\n");
  await write(
    path.join(site, "docs/features/BUSY_BUTTONS.md"),
    "# Boutons occupés\n\nVoir [le schéma](../DATABASE_SCHEMA.md#tables) et [le code](../../lib/x.ts).\n",
  );
  await write(path.join(site, "docs/DATABASE_SCHEMA.md"), "Pas de titre ici.\n");
  await write(path.join(site, "docs/notes.txt"), "pas du Markdown");
  await write(path.join(site, "docs/.hidden/SECRET.md"), "# Caché");
  await write(path.join(site, "docs/big/HUGE.md"), `# Énorme\n${"x".repeat(MAX_DOC_BYTES)}`);
  await write(path.join(site, "CLAUDE.md"), "# CLAUDE.md\n");
  await write(path.join(site, "OTHER.md"), "# Hors liste\n");
  await write(path.join(site, ".env"), "SECRET=1");
  await write(path.join(base, "outside/LEAK.md"), "# Fuite\n");
  await write(path.join(bot, "doc/main.md"), "# Main.js\n");
  await write(path.join(bot, "helpfr.md"), "# Aide\n");
  await write(path.join(bot, "LegalTerms/CGU.md"), "# CGU\n");
  try {
    await fs.symlink(path.join(base, "outside/LEAK.md"), path.join(site, "docs/LINK.md"), "file");
    symlinkCreated = true;
  } catch {
    // Windows sans droit de créer un lien : le cas est alors couvert par l'absence du fichier.
  }
  index = await buildDevDocIndex({
    site: { root: site, dirs: ["docs"], files: ["CLAUDE.md", "README.md"] },
    bot: { root: bot, dirs: ["doc"], files: ["helpfr.md"] },
  });
});

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

const paths = () => index.docs.map((doc) => `${doc.repo}:${doc.path}`).sort((a, b) => a.localeCompare(b));

describe("buildDevDocIndex", () => {
  it("buildDevDocIndex_fakeRepos_listsOnlyWhitelistedMarkdown", () => {
    expect(paths()).toEqual([
      "bot:doc/main.md",
      "bot:helpfr.md",
      "site:CLAUDE.md",
      "site:docs/DATABASE_SCHEMA.md",
      "site:docs/features/BUSY_BUTTONS.md",
      "site:docs/features/INDEX.md",
    ]);
  });

  it("buildDevDocIndex_symlinkToOutside_isSkipped", () => {
    expect(symlinkCreated ? findDevDoc(index, "site", "LINK") : null).toBeNull();
  });

  it("buildDevDocIndex_missingRoot_listsNothingForThatRepo", async () => {
    const partial = await buildDevDocIndex({
      site: { root: path.join(base, "absent"), dirs: ["docs"], files: ["CLAUDE.md"] },
      bot: { root: bot, dirs: ["doc"], files: [] },
    });
    expect(partial.docs.map((doc) => doc.path)).toEqual(["doc/main.md"]);
  });

  it("buildDevDocIndex_docWithoutHeading_usesFileName", () => {
    expect(findDevDoc(index, "site", "DATABASE_SCHEMA")?.title).toBe("DATABASE_SCHEMA");
  });
});

describe("devDocTitle", () => {
  it("devDocTitle_firstHeading_stripsMarkup", () => {
    expect(devDocTitle("intro\n# `Titre` **gras**\n# Second", "f")).toBe("Titre gras");
  });
});

describe("findDevDoc", () => {
  it("findDevDoc_knownSlug_returnsSummary", () => {
    expect(findDevDoc(index, "site", "features/BUSY_BUTTONS")?.path).toBe("docs/features/BUSY_BUTTONS.md");
  });

  it("findDevDoc_traversalSlug_returnsNull", () => {
    expect(findDevDoc(index, "site", "../.env")).toBeNull();
  });

  it("findDevDoc_unlistedRootFile_returnsNull", () => {
    expect(findDevDoc(index, "site", "OTHER")).toBeNull();
  });
});

describe("renderDevDoc", () => {
  it("renderDevDoc_relativeLinks_rewrittenToDevdocAndGithub", async () => {
    const summary = findDevDoc(index, "site", "features/BUSY_BUTTONS")!;
    const doc = await renderDevDoc(index, summary, (href) => `/en${href}`);
    expect(doc.html).toContain('<a href="/en/devdoc/site/DATABASE_SCHEMA#tables" rel="noreferrer">le schéma</a>');
    expect(doc.html).toContain(`<a href="${SOURCE_CODE_URL}/blob/main/lib/x.ts" rel="noreferrer">le code</a>`);
  });

  it("renderDevDoc_codeNamingDoc_becomesLink", async () => {
    const summary = findDevDoc(index, "site", "features/INDEX")!;
    const doc = await renderDevDoc(index, summary);
    expect(doc.html).toContain('<a href="/devdoc/site/features/BUSY_BUTTONS"><code>BUSY_BUTTONS.md</code></a>');
  });

  it("renderDevDoc_headings_getAnchors", async () => {
    const summary = findDevDoc(index, "bot", "doc/main")!;
    const doc = await renderDevDoc(index, summary);
    expect(doc.html).toBe('<h2 id="mainjs">Main.js</h2>');
    expect(doc.updatedAt).not.toBeNull();
  });

  it("renderDevDoc_fileGoneSinceIndex_returnsNullHtml", async () => {
    const summary = findDevDoc(index, "bot", "helpfr")!;
    await fs.rm(path.join(bot, "helpfr.md"));
    const doc = await renderDevDoc(index, summary);
    expect(doc.html).toBeNull();
  });

  it("renderDevDoc_summaryNotInIndex_returnsNullHtml", async () => {
    const doc = await renderDevDoc(index, { repo: "site", slug: "OTHER", path: "OTHER.md", title: "x" });
    expect(doc.html).toBeNull();
  });
});
