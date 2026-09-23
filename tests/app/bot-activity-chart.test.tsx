import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { BotActivityChart } from "@/components/bot/BotActivityChart";
import type { BotActivity } from "@/lib/shared/types";

/**
 * Le graphe « Activité · relais & scrims » de `/bot`, **rendu** plutôt que relu.
 *
 * `fetchBotActivity` rend sa charge par un simple `as BotActivity` sur du JSON
 * reçu par le réseau, et `/api/bot/activity` ne valide pas davantage ce que le
 * client remet ensuite dans l'état. Les cas ci-dessous sont donc exactement ce
 * que ce `as` laisse passer — et comme le composant est rendu côté serveur dans
 * `app/bot/page.tsx`, une exception pendant le rendu ne fait pas une case vide :
 * elle sert **toute** la page en 500.
 */
const activity = (overrides: Partial<BotActivity> = {}): BotActivity =>
  ({
    range: "30j",
    labels: ["01/09", "02/09", "03/09"],
    relays: [3, 5, 2],
    scrims: [1, 2, 1],
    avgPerDay: 4,
    ...overrides,
  }) as BotActivity;

const render = (initial: BotActivity | null) =>
  renderToStaticMarkup(<BotActivityChart initial={initial} />);

describe("BotActivityChart — une charge saine", () => {
  it("trace les deux séries et la moyenne", () => {
    const html = render(activity());
    expect(html).toContain("3 relais");
    expect(html).toContain("1 scrims");
    expect(html).toContain("MOY. 4 / JOUR");
    expect(html).toContain("01/09");
  });

  it("dit « Données indisponibles » plutôt que d'inventer un graphe vide", () => {
    expect(render(null)).toContain("Données indisponibles");
  });
});

describe("BotActivityChart — une charge abîmée ne fait pas tomber la page", () => {
  it("ne rend pas de hauteur NaN quand les scrims manquent", () => {
    // `max` avait été durci, pas les hauteurs : `scrims[i]` valait
    // `undefined` à chaque barre, donc `height: NaN%` — déclaration invalide
    // que le navigateur laisse tomber, les barres ambre disparaissaient sans
    // une erreur — et un `title="undefined scrims"`.
    const html = render(activity({ scrims: undefined as unknown as number[] }));
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
    expect(html).toContain("0 scrims");
  });

  it("comble une série de scrims plus courte que celle des relais", () => {
    const html = render(activity({ relays: [3, 5, 2], scrims: [1] }));
    expect(html).not.toContain("NaN");
    expect(html).toContain("0 scrims");
  });

  it("écarte les points qui ne sont pas des nombres", () => {
    const html = render(
      activity({ relays: [3, "n/a", null] as unknown as number[] }),
    );
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("ne laisse pas un point négatif produire une hauteur négative", () => {
    // `height: -400%` est refusée par le navigateur : la barre disparaît sans
    // rien dire. Même borne que la colonne « tendance » du tableau.
    const html = render(activity({ relays: [-4, 2], scrims: [1, 1] }));
    expect(html).not.toMatch(/height:\s*-/);
  });

  it("survit à des libellés qui ne sont pas une liste", () => {
    // `data.labels ?? []` ne rattrape que `null` : des libellés rangés par
    // index passaient tout droit et `labels.map` levait « is not a function »
    // — toute la page `/bot` en 500.
    const keyed = { "0": "01/09" } as unknown as string[];
    expect(() => render(activity({ labels: keyed }))).not.toThrow();
  });

  it("ne pose pas un libellé objet en enfant de React", () => {
    // « Objects are not valid as a React child » lève pendant le rendu.
    const html = render(
      activity({ labels: [{ fr: "01/09" }, "02/09"] as unknown as string[] }),
    );
    expect(html).not.toContain("[object Object]");
    expect(html).toContain("02/09");
  });

  it("survit à des séries qui ne sont pas des listes", () => {
    const html = render(
      activity({
        relays: "nope" as unknown as number[],
        scrims: {} as unknown as number[],
      }),
    );
    expect(html).not.toContain("NaN");
  });

  it("ne rend pas « MOY. NaN / JOUR » sur une moyenne mal typée", () => {
    for (const avgPerDay of [{}, "beaucoup", null, Number.NaN]) {
      const html = render(activity({ avgPerDay: avgPerDay as unknown as number }));
      expect(html).not.toContain("NaN");
      expect(html).toContain("MOY. 0 / JOUR");
    }
  });

  it("dessine autant de colonnes que la plus longue des deux séries", () => {
    // Les barres se tiraient de `relays.map` seul, quand `max`, la légende et
    // l'axe parlent des deux : une charge sans relais rendait un graphe vide
    // sous un axe gradué sur des scrims jamais dessinés.
    const html = render(
      activity({ relays: [], scrims: [3, 5], labels: ["01/09", "02/09"] }),
    );
    expect(html).toContain("3 scrims");
    expect(html).toContain("5 scrims");
    expect(html).toContain("0 relais");
    expect(html).not.toContain("NaN");
  });

  it("comble l'autre sens aussi, sans jamais inventer de point", () => {
    const html = render(activity({ relays: [3, 5, 2], scrims: [] }));
    expect(html).toContain("3 relais");
    expect(html).toContain("0 scrims");
    expect(html).not.toContain("NaN");
  });

  it("ne divise pas par zéro sur une série plate", () => {
    const html = render(activity({ relays: [0, 0], scrims: [0, 0] }));
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("ne passe jamais les séries en arguments d'appel", () => {
    // `Math.max(...relays, ...scrims, 1)` est un `RangeError` au-delà de
    // ~100 000 points — une charge du bot suffirait à rendre la page en 500.
    const huge = Array.from({ length: 200_000 }, (_, i) => i % 9);
    expect(() =>
      render(activity({ relays: huge, scrims: huge, labels: [] })),
    ).not.toThrow();
  });
});
