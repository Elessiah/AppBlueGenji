import { describe, expect, it } from "@jest/globals";
import { join, relative } from "node:path";
import { ROOT, stripComments, walk } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/**
 * Régime de charge (`lib/shared/client-power.ts`) : une animation **infinie**
 * est une animation décorative — rien d'utile ne tourne en boucle —, et elle
 * doit se figer quand la page n'est pas regardée, que la machine est à la peine
 * ou que le lecteur est en match. Le mécanisme tient en une ligne par animation,
 * `animation-play-state: var(--deco-anim-state)`, que `ClientPowerRoot` bascule
 * d'un coup sur tout le site.
 *
 * Une ligne qu'il faut penser à écrire est une ligne qu'on oublie : ce balayage
 * couvre **toutes** les feuilles de `app/` et `components/`, et les styles en
 * ligne des composants, pour que la prochaine animation infinie n'échappe pas
 * au régime sans que personne s'en aperçoive — elle tournerait sous le jeu du
 * joueur, et rien ne le montrerait.
 */

const PLAY_STATE = /animation-play-state:\s*var\(--deco-anim-state\)/;

function cssFiles(): string[] {
  return [...walk(join(ROOT, "app"), ".css"), ...walk(join(ROOT, "components"), ".css")];
}

/** Corps de règles (texte entre accolades, sans imbrication) portant une animation infinie. */
function infiniteBlocks(css: string): string[] {
  const blocks: string[] = [];
  const pattern = /\{([^{}]*)\}/g;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(css)) !== null) {
    const body = found[1];
    if (/(^|[;\s])animation(-iteration-count)?\s*:[^;]*\binfinite\b/.test(body)) blocks.push(body);
  }
  return blocks;
}

describe("animations décoratives — soumises au régime de charge", () => {
  it("toute animation infinie d'une feuille lit le jeton de pause", () => {
    const offenders: string[] = [];
    let count = 0;
    for (const file of cssFiles()) {
      const css = stripComments(readSource(file));
      for (const body of infiniteBlocks(css)) {
        count += 1;
        // Le longhand après le raccourci : `animation` le remet à `running`.
        const shorthand = body.search(/(^|[;\s])animation\s*:/);
        const playState = body.search(PLAY_STATE);
        if (playState < 0 || (shorthand >= 0 && playState < shorthand)) {
          offenders.push(`${relative(ROOT, file)} — ${body.trim().split("\n")[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // Le balayage voit bien quelque chose : sans cela, un motif cassé passerait.
    expect(count).toBeGreaterThanOrEqual(10);
  });

  it("toute animation infinie en ligne lit aussi le jeton", () => {
    const offenders: string[] = [];
    const files = [...walk(join(ROOT, "app"), ".tsx"), ...walk(join(ROOT, "components"), ".tsx")];
    for (const file of files) {
      const source = readSource(file);
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        if (!/animation:\s*[^,]*infinite/.test(line)) return;
        const window = lines.slice(index, index + 3).join("\n");
        if (!/animationPlayState:\s*(DECO_ANIM_STATE|"var\(--deco-anim-state\)")/.test(window)) {
          offenders.push(`${relative(ROOT, file)}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("déclare le jeton, le fige sous `data-motion=off` et sous le mouvement réduit", () => {
    const globals = stripComments(readSource("app/globals.css"));
    const firstRoot = globals.slice(globals.indexOf(":root"), globals.indexOf("}"));
    expect(firstRoot).toMatch(/--deco-anim-state:\s*running/);
    expect(globals).toMatch(/html\[data-motion="off"\]\s*\{\s*--deco-anim-state:\s*paused;/);
    expect(globals).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{\s*--deco-anim-state:\s*paused;/,
    );
  });

  it("monte le régime de charge dans la mise en page racine", () => {
    const layout = readSource("app/layout.tsx");
    expect(layout).toContain('import { ClientPowerRoot } from "@/components/client-power-root";');
    expect(layout).toContain("<ClientPowerRoot />");
  });
});
