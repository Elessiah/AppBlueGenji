import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { BotActivityChart, loadActivityRange } from "@/components/bot/BotActivityChart";
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
    expect(html).toContain("0 scrims");
    expect(html).not.toContain("NaN");
  });

  it("ne divise pas par zéro sur une série plate", () => {
    const html = render(activity({ relays: [0, 0], scrims: [0, 0] }));
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("plafonne le nombre de colonnes, et gradue l'axe sur ce qu'il dessine", () => {
    // C'est la seule série de la page que le client **redemande**
    // (`/api/bot/activity` laisse passer le corps du bot tel quel) : cinquante
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

/**
 * Le changement de plage, sans DOM : `loadActivityRange` est la seule partie du
 * composant qui dépende de l'ordre d'arrivée des réponses. Chaque requête reçoit
 * une promesse tenue à la main, pour faire arriver la plus ancienne en dernier.
 */
describe("loadActivityRange — une plage abandonnée n'écrit plus rien", () => {
  type Pending = { url: string; signal: AbortSignal | undefined; settle: (res: Response | Error) => void };

  function deferredFetcher() {
    const pending: Pending[] = [];
    const fetcher = ((url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        pending.push({
          url,
          signal: init?.signal ?? undefined,
          settle: (res) => (res instanceof Error ? reject(res) : resolve(res)),
        });
      })) as unknown as typeof fetch;
    return { pending, fetcher };
  }

  const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("ne laisse pas la réponse lente de « 90j » écraser « 7j »", async () => {
    const { pending, fetcher } = deferredFetcher();
    const applied: unknown[] = [];
    const apply = (data: unknown) => applied.push(data);

    // « 90j » puis « 7j » : React nettoie l'effet de la première plage avant
    // de lancer la seconde.
    const cancel90 = loadActivityRange("90j", apply, fetcher);
    cancel90();
    loadActivityRange("7j", apply, fetcher);

    // La plus récente arrive d'abord, la plus ancienne ensuite.
    pending[1].settle(ok({ range: "7j" }));
    await flush();
    pending[0].settle(ok({ range: "90j" }));
    await flush();

    expect(applied).toEqual([{ range: "7j" }]);
  });

  it("annule la requête elle-même, pas seulement son effet", () => {
    const { pending, fetcher } = deferredFetcher();
    const cancel = loadActivityRange("90j", () => {}, fetcher);
    expect(pending[0].url).toBe("/api/bot/activity?range=90j");
    expect(pending[0].signal?.aborted).toBe(false);
    cancel();
    expect(pending[0].signal?.aborted).toBe(true);
  });

  it("n'efface pas le graphe sur l'échec d'une plage abandonnée", async () => {
    // Une requête interrompue rejette (`AbortError`) : son `catch` rend
    // `null`, qui aurait remplacé le graphe de la plage suivante par
    // « Données indisponibles ».
    const { pending, fetcher } = deferredFetcher();
    const applied: unknown[] = [];
    const cancel = loadActivityRange("90j", (d) => applied.push(d), fetcher);
    cancel();
    pending[0].settle(new Error("AbortError"));
    await flush();
    expect(applied).toEqual([]);
  });

  it("remet la réponse de la plage courante, et `null` sur son échec", async () => {
    const { pending, fetcher } = deferredFetcher();
    const applied: unknown[] = [];
    loadActivityRange("7j", (d) => applied.push(d), fetcher);
    pending[0].settle(ok({ range: "7j" }));
    await flush();

    loadActivityRange("90j", (d) => applied.push(d), fetcher);
    pending[1].settle({ ok: false, json: async () => ({}) } as unknown as Response);
    await flush();

    loadActivityRange("90j", (d) => applied.push(d), fetcher);
    pending[2].settle(new Error("réseau"));
    await flush();

    expect(applied).toEqual([{ range: "7j" }, null, null]);
  });
});
