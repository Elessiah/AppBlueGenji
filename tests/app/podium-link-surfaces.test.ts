import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Un lien d'entité peut porter une marche du podium : son nom est alors peint
 * par `background-clip: text` dans un texte transparent (`PODIUM_TIERS.md`).
 * Une classe qui pose un `background` sur le **même** élément (une pastille
 * `.badge`, par exemple) efface ce dégradé : le nom disparaît, et ne revient
 * qu'au survol, où la marche repasse en couleur pleine. La pastille habille donc
 * un conteneur, jamais le lien lui-même.
 */

const ROOT = join(__dirname, "..", "..");
const SURFACE_CLASSES = ["badge", "pill"];
const LINK_TAG = /<(TeamLink|PlayerLink|EntrantLink)\b([^>]*)>/g;

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Liens d'entité dont la classe littérale porte une surface peinte. */
function paintedLinks(code: string): string[] {
  return [...code.matchAll(LINK_TAG)]
    .filter(([, , attributes]) => {
      const className = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(attributes);
      const classes = (className?.[1] ?? className?.[2] ?? "").split(/\s+/);
      return classes.some((name) => SURFACE_CLASSES.includes(name));
    })
    .map(([tag]) => tag);
}

describe("lien d'entité et marche du podium", () => {
  it("repère un lien habillé en pastille", () => {
    expect(paintedLinks(`<TeamLink teamId={1} className="badge">X</TeamLink>`)).toHaveLength(1);
    expect(paintedLinks("<PlayerLink userId={1} className={`pill pill-accent`}>X</PlayerLink>")).toHaveLength(1);
  });

  it("laisse passer une pastille posée sur un conteneur", () => {
    expect(paintedLinks(`<span className="badge"><TeamLink teamId={1}>X</TeamLink></span>`)).toEqual([]);
    expect(paintedLinks(`<TeamLink teamId={1} className="badge-like">X</TeamLink>`)).toEqual([]);
  });

  it("aucun écran ne pose une pastille sur le lien lui-même", () => {
    const offenders = [...sources("app"), ...sources("components")].flatMap((file) =>
      paintedLinks(readFileSync(file, "utf8")).map((tag) => `${relative(ROOT, file)}: ${tag}`),
    );
    expect(offenders).toEqual([]);
  });
});
