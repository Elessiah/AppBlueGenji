import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { BotKpis } from "@/components/bot/BotKpis";
import { Sparkline } from "@/components/bot/Sparkline";
import type { BotKpis as BotKpisType } from "@/lib/shared/types";

/**
 * Les tuiles de chiffres de `/bot` et leur courbe.
 *
 * `fetchBotKpis` rend sa charge par un simple `as BotKpis` sur du JSON reçu,
 * comme ses voisines. La garde portait sur l'**objet** (`entry.data ? …`) et
 * jamais sur le champ : une charge `{"servers": {}}` la passait, puis
 * `.toLocaleString()` levait sur `undefined` — et la page `/bot` étant rendue
 * par des composants serveur, c'est toute la page en 500.
 */
const entry = (overrides: Partial<BotKpisType["servers"]> = {}) => ({
  value: 128,
  delta: "+4",
  series: [1, 4, 2, 8, 5],
  ...overrides,
});

const kpis = (overrides: Partial<BotKpisType> = {}): BotKpisType =>
  ({
    servers: entry(),
    channels: entry(),
    messages: entry(),
    relays: entry(),
    ...overrides,
  }) as BotKpisType;

describe("BotKpis — une charge amputée ne fait pas tomber la page", () => {
  it("rend les quatre tuiles sur une charge saine", () => {
    const html = renderToStaticMarkup(<BotKpis kpis={kpis()} />);
    expect(html).toContain("Serveurs");
    expect(html).toContain((128).toLocaleString("fr-FR"));
  });

  it("met un tiret plutôt que de lever sur une tuile vide", () => {
    const html = renderToStaticMarkup(
      <BotKpis kpis={{ ...kpis(), servers: {} } as unknown as BotKpisType} />,
    );
    expect(html).toContain("—");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("ne pose pas un objet en enfant de React", () => {
    // « Objects are not valid as a React child » lève pendant le rendu.
    const broken = {
      ...kpis(),
      channels: { value: {}, delta: { fr: "+4" }, series: "nope" },
    } as unknown as BotKpisType;
    const html = renderToStaticMarkup(<BotKpis kpis={broken} />);
    expect(html).not.toContain("[object Object]");
    expect(html).toContain("Channels relayés");
  });

  it("survit à une charge absente", () => {
    const html = renderToStaticMarkup(<BotKpis kpis={null} />);
    expect(html).toContain("—");
  });
});

describe("BotKpis — la pastille de variation dit ce qu'elle colore", () => {
  it("ne fait pas passer une baisse pour une hausse", () => {
    // La pastille était écrite en dur : `className="kpi-delta up"` et un `▲`
    // littéral, quelle que soit la valeur reçue. Une baisse annoncée `-8 %`
    // sortait donc en vert, flèche vers le haut — et c'est la couleur qu'on
    // lit en premier, pas le signe.
    const html = renderToStaticMarkup(
      <BotKpis kpis={kpis({ servers: entry({ delta: "-8 %" }) } as Partial<BotKpisType>)} />,
    );
    expect(html).toContain('class="kpi-delta down"');
    expect(html).toContain("▼");
  });

  it("garde le vert pour une hausse signée", () => {
    const html = renderToStaticMarkup(
      <BotKpis kpis={kpis({ servers: entry({ delta: "+4" }) } as Partial<BotKpisType>)} />,
    );
    expect(html).toContain('class="kpi-delta up"');
    expect(html).toContain("▲");
  });

  it("n'affirme aucun sens sur une variation sans signe", () => {
    const html = renderToStaticMarkup(
      <BotKpis
        kpis={
          {
            servers: entry({ delta: "12 %" }),
            channels: entry({ delta: "12 %" }),
            messages: entry({ delta: "12 %" }),
            relays: entry({ delta: "12 %" }),
          } as unknown as BotKpisType
        }
      />,
    );
    expect(html).toContain('class="kpi-delta flat"');
    expect(html).not.toContain("▲");
    expect(html).not.toContain("▼");
  });

  it("ne met pas de flèche devant le tiret d'une tuile vide", () => {
    const html = renderToStaticMarkup(<BotKpis kpis={null} />);
    expect(html).not.toContain("▲");
    expect(html).not.toContain("▼");
    expect(html).toContain("—");
  });

  it("écrit le sens à côté du texte, jamais en aria-label", () => {
    // `aria-label` posé sur un `<span>` sans rôle (`generic`) n'accepte pas de
    // nom d'auteur : il est ignoré, et la pastille n'annonce que « -8 % » —
    // sans le sens, c'est-à-dire sans ce qu'elle a justement à dire. Même
    // piège, et même remède, que `TeamCard`.
    const html = renderToStaticMarkup(
      <BotKpis kpis={kpis({ servers: entry({ delta: "-8 %" }) } as Partial<BotKpisType>)} />,
    );
    expect(html).not.toContain("aria-label");
    expect(html).toContain('class="sr-only"');
    expect(html).toContain("en baisse");
    // Le texte visible reste devant (WCAG 2.5.3).
    expect(html.indexOf("-8 %")).toBeLessThan(html.indexOf("en baisse"));
  });

  it("n'ajoute pas de mot en trop sur une pastille neutre", () => {
    const html = renderToStaticMarkup(
      <BotKpis
        kpis={
          {
            servers: entry({ delta: "12 %" }),
            channels: entry({ delta: "12 %" }),
            messages: entry({ delta: "12 %" }),
            relays: entry({ delta: "12 %" }),
          } as unknown as BotKpisType
        }
      />,
    );
    expect(html).not.toContain("sr-only");
    expect(html).not.toContain("hausse");
    expect(html).not.toContain("baisse");
  });
});

describe("Sparkline — pas de courbe plutôt qu'une courbe fausse", () => {
  it("trace une courbe à partir de deux points", () => {
    const html = renderToStaticMarkup(<Sparkline data={[1, 4, 2]} />);
    expect(html).toContain("<svg");
    expect(html).not.toContain("NaN");
  });

  it("ne rend rien sur zéro ou un point", () => {
    // Avec un seul point, `i / (n - 1)` vaut `0 / 0` : tout le chemin sortait
    // en « MNaN,NaN ». Avec zéro, `Math.max` rend `-Infinity` et l'aire
    // commence par un `L`, un `d` que le navigateur refuse.
    expect(renderToStaticMarkup(<Sparkline data={[]} />)).toBe("");
    expect(renderToStaticMarkup(<Sparkline data={[5]} />)).toBe("");
  });

  it("ne trace rien plutôt qu'une courbe dont l'abscisse s'est redistribuée", () => {
    // Écarter les points illisibles un à un laissait tracer les survivants, et
    // l'abscisse se resserrait sur eux : la tendance se lisait plus dense et
    // plus raide que la donnée, sans rien qui signale les trous. Une courbe
    // est une forme, pas une liste — et combler par un zéro affirmerait une
    // valeur que le bot n'a pas donnée.
    for (const serie of [
      [1, "n/a", null, 4, Number.NaN, 2],
      [1, 2, 3, "n/a"],
      ["n/a", 1, 2, 3],
    ]) {
      expect(renderToStaticMarkup(<Sparkline data={serie as unknown as number[]} />)).toBe("");
    }
  });

  it("trace une série entièrement lisible, sans NaN", () => {
    const html = renderToStaticMarkup(<Sparkline data={[1, 4, 2, 8, 5]} />);
    expect(html).toContain("<svg");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("ne passe jamais la série en arguments d'appel", () => {
    // `Math.max(...arr)` est un `RangeError` au-delà de ~100 000 points.
    const huge = Array.from({ length: 200_000 }, (_, i) => i % 9);
    expect(() => renderToStaticMarkup(<Sparkline data={huge} />)).not.toThrow();
  });

  it("survit à une série qui n'est pas une liste", () => {
    expect(renderToStaticMarkup(<Sparkline data={"nope" as unknown as number[]} />)).toBe("");
  });
});
