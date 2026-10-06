import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { BotActivityChart } from "@/components/bot/BotActivityChart";
import type { BotActivity } from "@/lib/shared/types";

/**
 * Le graphe « Activité · relais & scrims » de `/bot`, **rendu** plutôt que relu.
 *
 * `fetchBotActivity` rend sa charge par un simple `as BotActivity` sur du JSON
 * reçu par le réseau, et rien ne la valide avant le rendu. Les cas ci-dessous
 * sont donc exactement ce que ce `as` laisse passer — et comme le composant est rendu côté serveur dans
 * `app/bot/page.tsx`, une exception pendant le rendu ne fait pas une case vide :
 * elle sert **toute** la page en 500.
 */
const activity = (overrides: Partial<BotActivity> = {}): BotActivity =>
  ({
    range: "7j",
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
    expect(html).toContain('title="1 scrim"');
    expect(html).toContain("MOY. 4 / JOUR");
    expect(html).toContain("01/09");
  });

  it("ne montre que les 7 jours que le bot garde, sans sélecteur de plage", () => {
    // Les relais sont purgés à 7 jours chez le bot : une plage de 30 ou 90 jours
    // affichait des zéros au-delà de la première semaine.
    for (const html of [render(activity()), render(null)]) {
      expect(html).toContain("7 DERNIERS JOURS");
      expect(html).not.toMatch(/30j|90j/);
      expect(html).not.toContain("aria-pressed");
      expect(html).not.toContain("chart-tools");
      expect(html).not.toContain("CHARGEMENT");
    }
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
    expect(html).toContain('title="0 scrim"');
  });

  it("comble une série de scrims plus courte que celle des relais", () => {
    const html = render(activity({ relays: [3, 5, 2], scrims: [1] }));
    expect(html).not.toContain("NaN");
    expect(html).toContain('title="0 scrim"');
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
      // Ni zéro : « MOY. 0 / JOUR » annonçait une moyenne mesurée sur une
      // charge que la page venait de juger illisible.
      expect(html).not.toContain("MOY. 0 / JOUR");
      expect(html).toContain("MOY. — / JOUR");
    }
  });

  it("garde le zéro pour un zéro reçu", () => {
    expect(render(activity({ avgPerDay: 0 }))).toContain("MOY. 0 / JOUR");
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
    expect(html).toContain('title="0 scrim"');
    expect(html).not.toContain("NaN");
  });

  it("ne divise pas par zéro sur une série plate", () => {
    const html = render(activity({ relays: [0, 0], scrims: [0, 0] }));
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("plafonne le nombre de colonnes, et gradue l'axe sur ce qu'il dessine", () => {
    // Le corps du bot arrive tel quel : cinquante
    // (rien ne le borne avant le rendu) —
    // mille points y écrivaient trois nœuds DOM chacun, et l'onglet se fige.
    // Ne pas lever n'est pas la même chose que rester utilisable.
    const huge = Array.from({ length: 5_000 }, () => 1);
    // La dernière valeur est la plus grande : si les colonnes gardées sont
    // bien les plus récentes, elle est dessinée — et l'axe la porte.
    huge[huge.length - 1] = 42;
    const html = render(activity({ relays: huge, scrims: [], labels: [] }));
    const bars = [...html.matchAll(/title="\d+ relais"/g)];
    expect(bars.length).toBeLessThanOrEqual(120);
    expect(html).toContain('title="42 relais"');
    // L'axe des ordonnées est gradué sur la fenêtre affichée.
    expect(html).toContain(">42<");
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
