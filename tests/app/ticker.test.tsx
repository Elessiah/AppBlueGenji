import { describe, expect, it } from "@jest/globals";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Ticker } from "@/components/cyber/Ticker";
import { contrastRatio } from "@/lib/shared/color-contrast";
import type { TickerChampionItem, TickerOutcome, TickerResultItem } from "@/lib/shared/ticker-items";
import { globals, ROOT, stripComments } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

describe("Ticker — bandeau défilant", () => {
  const html = renderToStaticMarkup(<Ticker items={["Alpha", "Bravo"]} />);

  it("est un défilant nommé", () => {
    expect(html).toMatch(/role="marquee" aria-label="Fil d&#x27;actualité"/);
  });

  it("double sa piste pour boucler, mais ne fait lire chaque élément qu'une fois", () => {
    expect(html.match(/Alpha/g)).toHaveLength(2);
    const copies = html.match(/<div class="copy"[^>]*>/g) ?? [];
    expect(copies).toHaveLength(2);
    expect(copies[0]).not.toContain("aria-hidden");
    expect(copies[1]).toContain('aria-hidden="true"');
  });

  it("masque les séparateurs décoratifs", () => {
    expect(html).toMatch(/<i class="sep" aria-hidden="true">◆<\/i>/);
  });

  it("porte un bouton pause nommé, et démarre en défilement", () => {
    expect(html).toMatch(/<button type="button" class="pause" aria-label="Mettre en pause le défilement du bandeau"/);
    expect(html).not.toContain("data-paused");
  });

  it("rend un bandeau vide sans planter", () => {
    expect(renderToStaticMarkup(<Ticker items={[]} />)).toContain('role="marquee"');
  });
});

describe("Ticker — résultats habillés par camp (TICKER_RESULTS.md)", () => {
  type SrWords = Readonly<Record<TickerOutcome, string | null>>;
  const FR: SrWords = { win: "vainqueur", loss: "perdant", forfeit: "forfait", none: null };
  const EN: SrWords = { win: "winner", loss: "loser", forfeit: "forfeit", none: null };

  function result(left: TickerOutcome, right: TickerOutcome, sr: SrWords = FR, note: string | null = null): TickerResultItem {
    return {
      kind: "result",
      lead: "RÉSULTAT · Alpha Cup ·",
      sides: [
        { name: "Alpha", score: "2", outcome: left, sr: sr[left] },
        { name: "Beta", score: "1", outcome: right, sr: sr[right] },
      ],
      sr: note,
    };
  }

  /** Première copie de la piste : la seule lue par les technologies d'assistance. */
  const firstCopy = (html: string) => html.split('<div class="copy" aria-hidden="true">')[0];
  /** Ce qui se voit : sans les textes masqués ni les balises. */
  const visible = (html: string) => html.replaceAll(/<span class="sr-only">[^<]*<\/span>/g, "").replaceAll(/<[^>]+>/g, "");

  it("vainqueur et perdant : chacun sa classe, son repère de forme et son issue en texte masqué", () => {
    const html = firstCopy(renderToStaticMarkup(<Ticker items={[result("win", "loss")]} />));
    expect(html).toContain(
      '<span class="side winner" data-outcome="win"><i class="mark" aria-hidden="true">▲</i><span>Alpha</span><span class="sr-only"> (vainqueur)</span> <b class="score">2</b></span>',
    );
    expect(html).toContain(
      '<span class="side loser" data-outcome="loss"><i class="mark" aria-hidden="true">▼</i><span>Beta</span><span class="sr-only"> (perdant)</span> <b class="score">1</b></span>',
    );
  });

  it("garde la phrase visible et l'ordre du match", () => {
    const html = firstCopy(renderToStaticMarkup(<Ticker items={[result("loss", "win")]} />));
    expect(visible(html)).toContain("RÉSULTAT · Alpha Cup · ▼Alpha 2 — ▲Beta 1");
  });

  it("anglais : l'issue masquée suit la langue reçue", () => {
    const html = renderToStaticMarkup(<Ticker items={[result("win", "loss", EN)]} />);
    expect(html).toContain('<span class="sr-only"> (winner)</span>');
    expect(html).toContain('<span class="sr-only"> (loser)</span>');
  });

  it("forfait : camp neutre, sans repère de défaite, dit « forfait »", () => {
    const html = renderToStaticMarkup(<Ticker items={[result("forfeit", "win")]} />);
    expect(html).toContain('<span class="side" data-outcome="forfeit"><span>Alpha</span><span class="sr-only"> (forfait)</span>');
    expect(html).not.toContain("loser");
    expect(html).not.toContain("▼");
  });

  it("nul : deux camps neutres, score en avant, note « sans vainqueur »", () => {
    const html = firstCopy(renderToStaticMarkup(<Ticker items={[result("none", "none", FR, "sans vainqueur")]} />));
    expect(html.match(/<span class="side" data-outcome="none">/g)).toHaveLength(2);
    expect(html.match(/<b class="score">/g)).toHaveLength(2);
    expect(html).not.toMatch(/winner|loser|▲|▼/);
    expect(html).toContain('<span class="sr-only"> (sans vainqueur)</span>');
  });

  it("champion : connu mis en valeur, inconnu en texte simple", () => {
    const known: TickerChampionItem = { kind: "champion", lead: "VAINQUEUR · Cup ·", name: "Alpha", known: true };
    const unknown: TickerChampionItem = { kind: "champion", lead: "VAINQUEUR · Cup ·", name: "Champion inconnu", known: false };
    const html = firstCopy(renderToStaticMarkup(<Ticker items={[known, unknown]} />));
    expect(html).toContain(
      'VAINQUEUR · Cup · <span class="side winner" data-outcome="win"><i class="mark" aria-hidden="true">▲</i><span>Alpha</span></span>',
    );
    expect(html).toContain('<span class="item">VAINQUEUR · Cup · Champion inconnu<i class="sep"');
  });

  it("une phrase brute reste rendue telle quelle à côté d'un résultat", () => {
    const html = firstCopy(renderToStaticMarkup(<Ticker items={["NEWS · Saison", result("win", "loss")]} />));
    expect(html).toContain('<span class="item">NEWS · Saison<i class="sep"');
  });
});

describe("Ticker — feuille de style des résultats", () => {
  const css = stripComments(readSource(join(ROOT, "components", "cyber", "Ticker.module.css")));
  const sheet = stripComments(globals);
  const root = sheet.match(/(?:^|\})\s*:root\s*\{([^}]*)\}/)![1];
  const contrastBlock = sheet.match(/:root\[data-a11y~="contrast"\],\s*\.a11y-always-contrast\s*\{([^}]*)\}/)![1];
  const hex = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))![1];
  const rule = (selector: string) => {
    const name = selector.replace(".", String.raw`\.`);
    return css.match(new RegExp(String.raw`(?:^|\})\s*${name}\s*\{([^}]*)\}`))![1];
  };
  /**
   * Le bandeau pose un noir à 50 % sur la page : la surface la plus claire du
   * site, prise seule, est le cas le plus défavorable.
   */
  const SURFACE = hex(root, "--cyber-bg-3");

  it("n'emploie jamais l'ambre (avertissement seulement)", () => {
    expect(css).not.toMatch(/--amber|245,\s*165,\s*36/);
  });

  it("vainqueur en néon de réussite, perdant en encre de défaite, par jetons", () => {
    expect(rule(".winner")).toMatch(/color: var\(--teal-400\)/);
    expect(rule(".winner")).toMatch(/font-weight: 700/);
    expect(rule(".loser")).toMatch(/color: var\(--result-loss-ink\)/);
    for (const selector of [".side", ".winner", ".loser", ".score", ".mark"]) {
      expect(rule(selector)).not.toMatch(/color:\s*(?:#|rgb)/);
    }
  });

  it("texte lisible (≥ 4,5:1) sur la surface la plus claire, contraste renforcé compris", () => {
    const colours = [hex(root, "--teal-400"), hex(root, "--result-loss-ink"), hex(contrastBlock, "--result-loss-ink"), hex(root, "--ink")];
    for (const colour of colours) {
      expect(contrastRatio(colour, SURFACE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("score plus grand et plus gras que le texte du bandeau, au-dessus du plancher de 11 px", () => {
    const item = Number(rule(".item").match(/font-size: (\d+)px/)![1]);
    const score = Number(rule(".score").match(/font-size: (\d+)px/)![1]);
    expect(item).toBeGreaterThanOrEqual(11);
    expect(score).toBeGreaterThan(item);
    expect(rule(".score")).toMatch(/font-weight: 800/);
  });

  it("l'animation lit toujours le régime de charge", () => {
    expect(rule(".track")).toMatch(/animation-play-state: var\(--deco-anim-state\)/);
  });
});
