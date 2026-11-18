import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearCache } from "@/lib/server/cache";
import {
  DEV_DOC_TTL_MS,
  MAX_DOC_BYTES,
  RENDERED_DOCS_PER_INDEX,
  buildDevDocIndex,
  findDevDoc,
  loadDevDocIndex,
  renderDevDoc,
  type DevDocIndex,
} from "@/lib/server/dev-docs";
import { renderMarkdown } from "@/lib/server/bot-docs";

/**
 * Coût de `/devdoc` (`docs/features/DEVDOC.md`, « Coûts mesurés ») : rendu
 * resservi tant que le fichier ne change pas, plafond de taille revérifié à la
 * lecture, index échu resservi pendant qu'il se refait, motifs de lien bornés.
 */
let base: string;
let site: string;
let index: DevDocIndex;

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

const summaryOf = (slug: string, source: DevDocIndex = index) => {
  const found = findDevDoc(source, "site", slug);
  if (!found) throw new Error(`document absent : ${slug}`);
  return found;
};

const sourcesFor = (root: string) => ({
  site: { root, dirs: ["docs"], files: [] },
  bot: { root: path.join(base, "absent"), dirs: ["doc"], files: [] },
});

const same = (href: string) => href;

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "devdoc-perf-"));
  site = path.join(base, "site");
  await write(path.join(site, "docs/A.md"), "# A\n\n## Un\n\n## Deux\n\n## Trois\n\n## Quatre\n\nVoir [B](B.md).\n");
  await write(path.join(site, "docs/B.md"), "# B\n\nTexte.\n");
  await write(path.join(site, "docs/GROWS.md"), "# Grandit\n");
  for (let i = 0; i < RENDERED_DOCS_PER_INDEX + 1; i++) await write(path.join(site, `docs/many/D${i}.md`), `# D${i}\n`);
  index = await buildDevDocIndex(sourcesFor(site));
});

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
  clearCache();
});

describe("renderDevDoc — rendus gardés", () => {
  it("renderDevDoc_sameFileSameIndex_returnsRememberedRender", async () => {
    const first = await renderDevDoc(index, summaryOf("A"), same, "t");
    expect(await renderDevDoc(index, summaryOf("A"), same, "t")).toBe(first);
  });

  it("renderDevDoc_includesOutlineOfLongDoc", async () => {
    const doc = await renderDevDoc(index, summaryOf("A"), same, "t");
    expect(doc.outline.map((item) => item.text)).toEqual(["Un", "Deux", "Trois", "Quatre"]);
    expect((await renderDevDoc(index, summaryOf("B"), same, "t")).outline).toEqual([]);
  });

  it("renderDevDoc_otherLocale_rendersAgain", async () => {
    const fr = await renderDevDoc(index, summaryOf("A"), same, "t");
    const en = await renderDevDoc(index, summaryOf("A"), (href) => `/en${href}`, "t");
    expect(en).not.toBe(fr);
    expect(en.html).toContain('href="/en/devdoc/site/B"');
    expect(fr.html).toContain('href="/devdoc/site/B"');
  });

  it("renderDevDoc_fileChanged_rendersAgain", async () => {
    const before = await renderDevDoc(index, summaryOf("B"), same, "t");
    await write(path.join(site, "docs/B.md"), "# B\n\nTexte modifié et plus long.\n");
    const after = await renderDevDoc(index, summaryOf("B"), same, "t");
    expect(after).not.toBe(before);
    expect(after.html).toContain("Texte modifié");
  });

  it("renderDevDoc_newIndex_startsFromEmptyMemory", async () => {
    const first = await renderDevDoc(index, summaryOf("A"), same, "t");
    const fresh = await buildDevDocIndex(sourcesFor(site));
    expect(await renderDevDoc(fresh, summaryOf("A", fresh), same, "t")).not.toBe(first);
  });

  it("renderDevDoc_moreThanLimit_forgetsOldestRender", async () => {
    const local = await buildDevDocIndex(sourcesFor(site));
    const slugs = Array.from({ length: RENDERED_DOCS_PER_INDEX + 1 }, (_, i) => `many/D${i}`);
    const first = await renderDevDoc(local, summaryOf(slugs[0], local), same, "t");
    for (const slug of slugs.slice(1)) await renderDevDoc(local, summaryOf(slug, local), same, "t");
    expect(await renderDevDoc(local, summaryOf(slugs[0], local), same, "t")).not.toBe(first);
    const last = summaryOf(slugs[slugs.length - 1], local);
    const lastAgain = await renderDevDoc(local, last, same, "t");
    expect(await renderDevDoc(local, last, same, "t")).toBe(lastAgain);
  });

  it("renderDevDoc_fileGrownPastLimitSinceIndexing_notRead", async () => {
    await write(path.join(site, "docs/GROWS.md"), `# Grandit\n${"x".repeat(MAX_DOC_BYTES)}`);
    const doc = await renderDevDoc(index, summaryOf("GROWS"), same, "t");
    expect(doc.html).toBeNull();
    expect(doc.outline).toEqual([]);
  });
});

describe("loadDevDocIndex — index échu", () => {
  it("loadDevDocIndex_afterExpiry_servesStaleThenSwapsInFreshIndex", async () => {
    clearCache();
    const first = await loadDevDocIndex();
    expect(await loadDevDocIndex()).toBe(first);

    const realNow = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(realNow + DEV_DOC_TTL_MS + 1000);
    try {
      // L'index échu est rendu tout de suite : personne n'attend la réindexation.
      expect(await loadDevDocIndex()).toBe(first);
      let next = first;
      for (let attempt = 0; attempt < 100 && next === first; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        next = await loadDevDocIndex();
      }
      expect(next).not.toBe(first);
      expect(next.docs.length).toBeGreaterThan(0);
    } finally {
      clock.mockRestore();
      clearCache();
    }
  });
});

describe("renderMarkdown — motifs de lien bornés", () => {
  it("renderMarkdown_manyUnclosedBrackets_staysFast", () => {
    const started = performance.now();
    const html = renderMarkdown(`${"[".repeat(100_000)}x`);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(html).toContain("<p>");
  });

  it("renderMarkdown_manyOpenedLinkTargets_headingStaysFast", () => {
    const started = performance.now();
    renderMarkdown(`## ${"[a](".repeat(50_000)}`);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("renderMarkdown_ordinaryLink_stillALink", () => {
    expect(renderMarkdown("[doc](https://example.com/a)")).toContain('<a href="https://example.com/a" rel="noreferrer">doc</a>');
  });

  it("renderMarkdown_labelPastLimit_isPlainText", () => {
    expect(renderMarkdown(`[${"a".repeat(501)}](https://example.com)`)).not.toContain("<a ");
  });
});
