import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { BotServersTable } from "@/components/bot/BotServersTable";
import type { BotServerEntry } from "@/lib/shared/types";

/**
 * Le tableau « Serveurs connectés » de `/bot`, **rendu** plutôt que relu.
 *
 * Ce qu'on vérifie ici ne se lit pas dans le source : qu'un état inconnu
 * produise une cellule pleine, qu'une charge amputée ne fasse pas tomber la
 * page, et que la grille de `div` reste un tableau pour qui la parcourt au
 * lecteur d'écran (autant de cellules que de colonnes — un `aria-hidden` posé
 * sur l'une d'elles décalerait tout).
 *
 * `fetchBotServers` fait un simple `as BotServersPayload` sur du JSON reçu par
 * le réseau : les cas « le bot a répondu autre chose » ne sont donc pas
 * théoriques, d'où les `as unknown as` ci-dessous, qui reproduisent exactement
 * ce que ce `as` laisse passer.
 */
function server(overrides: Partial<BotServerEntry> = {}): BotServerEntry {
  return {
    id: "1",
    name: "Nova Esports",
    sigil: "NV",
    accentColor: "#5ac8ff",
    memberCount: 12345,
    relays30j: 4210,
    status: "ok",
    sparkline: [1, 4, 2, 8],
    ...overrides,
  } as BotServerEntry;
}

const render = (servers: BotServerEntry[] | null) =>
  renderToStaticMarkup(<BotServersTable servers={servers} />);

describe("BotServersTable — l'état du relais", () => {
  it("dit les trois états connus en français", () => {
    const html = render([
      server({ id: "1", status: "ok" }),
      server({ id: "2", status: "lag" }),
      server({ id: "3", status: "off" }),
    ]);
    expect(html).toContain("À jour");
    expect(html).toContain("Retard");
    expect(html).toContain("Hors ligne");
    expect(html).not.toContain(">● OK<");
    expect(html).not.toContain("LAG");
  });

  it("colore d'après le registre, et jamais d'après la chaîne reçue", () => {
    const html = render([
      server({ status: "lag" }),
      server({ id: "2", status: "rm -rf" as BotServerEntry["status"] }),
    ]);
    expect(html).toContain('class="srv-status lag"');
    expect(html).toContain('class="srv-status unknown"');
    expect(html).not.toContain("rm -rf");
  });

  it("nomme un état inconnu plutôt que de laisser la cellule vide", () => {
    const html = render([server({ status: "MAINTENANCE" as BotServerEntry["status"] })]);
    expect(html).toContain("Inconnu");
    // Et ne ment pas en « Hors ligne » : le bot a répondu, c'est la page qui
    // ne sait pas lire.
    expect(html).not.toContain("Hors ligne");
  });

  it("donne la définition au pointeur et aux technologies d'assistance", () => {
    const html = render([server({ status: "lag" })]);
    expect(html).toMatch(/title="Le relais fonctionne mais accuse du retard[^"]*"/);
    // WCAG 2.5.3 : le nom accessible commence par le texte visible.
    expect(html).toMatch(/aria-label="Retard — Le relais fonctionne/);
  });
});

describe("BotServersTable — la grille reste un tableau", () => {
  it("expose autant de cellules par rangée que l'en-tête a de colonnes", () => {
    const html = render([server(), server({ id: "2" })]);
    const headers = html.match(/role="columnheader"/g) ?? [];
    const cells = html.match(/role="cell"/g) ?? [];
    expect(headers).toHaveLength(6);
    expect(cells).toHaveLength(12);
  });

  it("n'annonce pas les initiales décoratives avant le nom du serveur", () => {
    const html = render([server({ sigil: "NV", name: "Nova Esports" })]);
    // Sans cela, la cellule se lit « NV Nova Esports ».
    expect(html).toMatch(/class="srv-sigil" aria-hidden="true"|aria-hidden="true" class="srv-sigil"/);
  });

  it("intitule la colonne d'état sans homonyme de la colonne voisine", () => {
    const html = render([server()]);
    expect(html).toContain("ÉTAT DU ");
    expect(html).toContain("RELAIS 30J");
    // Le qualificatif est un élément à part : c'est lui que le CSS retire sous
    // 640 px, où la colonne « RELAIS 30J » est masquée et l'homonymie tombe.
    expect(html).toContain('class="srv-col-qualifier"');
  });
});

describe("BotServersTable — une charge abîmée ne fait pas tomber la page", () => {
  it("survit à une absence de serveurs", () => {
    expect(() => render(null)).not.toThrow();
    expect(render([])).toContain("0 ACTIFS");
  });

  it("survit à une charge qui n'est pas une liste", () => {
    // `?? []` ne rattrape que `null` : une charge rangée par identifiant de
    // serveur passerait tout droit et `list.map` rendrait la page en 500.
    const keyed = { "123": { id: "123" } } as unknown as BotServerEntry[];
    expect(() => render(keyed)).not.toThrow();
    expect(render(keyed)).toContain("0 ACTIFS");
  });

  it("survit aux champs manquants plutôt que de rendre la page en 500", () => {
    const broken = { id: "9", name: "Sans rien" } as unknown as BotServerEntry;
    const html = render([broken]);
    expect(html).toContain("Sans rien");
    expect(html).toContain("Inconnu");
    // `memberCount` et `relays30j` absents : zéro affiché, aucune exception.
    // On compte les **cellules** chiffrées : un `toContain("0")` passait sur le
    // « 01 » du rang, donc quoi que ces deux cases contiennent.
    expect([...html.matchAll(/class="srv-num"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual([
      "0",
      "0",
    ]);
  });

  it("ne laisse pas un compte de mauvais type défaire le format français", () => {
    // `?? 0` ne rattrape que `null` : une chaîne tombe sur
    // `String.prototype.toLocaleString`, qui ne groupe rien, et un objet rend
    // « [object Object] » — dans une colonne de nombres, sans une erreur.
    const html = render([
      server({
        memberCount: "12345" as unknown as number,
        relays30j: {} as unknown as number,
      }),
    ]);
    expect(html).not.toContain("[object Object]");
    expect(html).not.toContain(">12345<");
    expect([...html.matchAll(/class="srv-num"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual([
      "0",
      "0",
    ]);
  });

  it("donne une clé à chaque rangée, même sans identifiant", () => {
    // Deux `key={undefined}` : React avertit et la réconciliation des rangées
    // ne tient plus au retour sur la page.
    const anonymous = [{ name: "A" }, { name: "B" }] as unknown as BotServerEntry[];
    const warn = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = render(anonymous);
      expect(html).toContain("A");
      expect(html).toContain("B");
      expect(warn.mock.calls.map((c) => String(c[0])).join(" ")).not.toMatch(/same key/i);
    } finally {
      warn.mockRestore();
    }
  });

  it("ne donne pas la même clé à deux rangées dont l'identifiant est un objet", () => {
    // `?? ` ne rattrape que `null` : deux `id` objets donnaient deux
    // `key="[object Object]"`, le doublon que le repli devait écarter.
    const objectIds = [
      { ...server({ name: "A" }), id: {} },
      { ...server({ name: "B" }), id: {} },
    ] as unknown as BotServerEntry[];
    const warn = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = render(objectIds);
      expect(html).toContain("A");
      expect(html).toContain("B");
      expect(warn.mock.calls.map((c) => String(c[0])).join(" ")).not.toMatch(/same key/i);
    } finally {
      warn.mockRestore();
    }
  });

  it("ne laisse pas un point négatif effacer une barre", () => {
    // `height: -400%` est une déclaration invalide : le navigateur la laisse
    // tomber, la barre disparaît sans rien dire.
    const html = render([server({ sparkline: [-4, 2, 8] })]);
    const heights = [...html.matchAll(/height:(-?[\d.]+)%/g)].map((m) => Number(m[1]));
    expect(heights).toHaveLength(3);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(0);
      expect(height).toBeLessThanOrEqual(100);
    }
  });

  it("met les nombres au format français des deux côtés", () => {
    const html = render([server({ memberCount: 12345, relays30j: 54321 })]);
    // Un compte groupé à côté d'un compte brut se lisait comme deux échelles.
    expect(html).toContain((12345).toLocaleString("fr-FR"));
    expect(html).toContain((54321).toLocaleString("fr-FR"));
  });

  it("ne passe jamais la série en arguments d'appel, et n'en rend pas cinquante mille", () => {
    // `Math.max(...arr)` est un `RangeError` au-delà de ~100 000 points — mais
    // ne pas lever ne suffit pas : une barre par point, c'était ~3 Mo d'HTML
    // pour une seule rangée. La cellule fait quelques dizaines de pixels.
    const huge = Array.from({ length: 200_000 }, (_, i) => i % 7);
    let html = "";
    expect(() => {
      html = render([server({ sparkline: huge })]);
    }).not.toThrow();
    const bars = [...html.matchAll(/height:/g)].length;
    expect(bars).toBeGreaterThan(0);
    expect(bars).toBeLessThanOrEqual(60);
    expect(html.length).toBeLessThan(20_000);
  });

  it("ne divise pas par zéro sur une série plate", () => {
    const html = render([server({ sparkline: [0, 0, 0] })]);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
});

describe("BotServersTable — la charge n'est pas validée, une case fade vaut mieux qu'un 500", () => {
  it("écarte une entrée nulle plutôt que de lever au premier tour de boucle", () => {
    // `{"servers": [null]}` est un tableau : il passe l'`Array.isArray`, et
    // `s.status` lève juste après — le 500 que la garde était censée écarter.
    const html = renderToStaticMarkup(
      <BotServersTable
        servers={[null, server({ id: "9", name: "Vertex" }), undefined] as unknown as BotServerEntry[]}
      />,
    );
    expect(html).toContain("Vertex");
    expect(html).toContain("1 ACTIFS");
  });

  it("ne laisse pas un point non numérique éteindre toute la colonne tendance", () => {
    // `Math.max(1, "n/a")` rend `NaN`, qui empoisonne chaque tour suivant :
    // toutes les barres sortaient en `height: NaN%`, sans une erreur.
    const html = renderToStaticMarkup(
      <BotServersTable
        servers={[server({ sparkline: [4, "n/a", 8, null] as unknown as number[] })]}
      />,
    );
    expect(html).not.toContain("NaN");
    expect(html).toContain("height:100%");
  });
});

describe("BotServersTable — un champ posé en enfant de React", () => {
  it("ne lève pas sur un nom ou un sigil qui n'est pas du texte", () => {
    // Les deux derniers champs non gardés, et les seuls qui tombent
    // directement en enfants de React : « Objects are not valid as a React
    // child » lève pendant le rendu, donc toute la page `/bot` en 500.
    const html = render([
      server({
        name: { fr: "Nova" } as unknown as string,
        sigil: ["N", "V"] as unknown as string,
      }),
    ]);
    expect(html).not.toContain("[object Object]");
    expect(html).toContain("srv-name");
    // La rangée reste une rangée : six cellules, comme l'en-tête a six colonnes.
    expect([...html.matchAll(/role="cell"/g)]).toHaveLength(6);
  });
});
