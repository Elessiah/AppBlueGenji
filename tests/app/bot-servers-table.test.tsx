import { describe, expect, it } from "@jest/globals";
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
    expect(html).toContain("0");
  });

  it("met les nombres au format français des deux côtés", () => {
    const html = render([server({ memberCount: 12345, relays30j: 54321 })]);
    // Un compte groupé à côté d'un compte brut se lisait comme deux échelles.
    expect(html).toContain((12345).toLocaleString("fr-FR"));
    expect(html).toContain((54321).toLocaleString("fr-FR"));
  });

  it("ne passe jamais la série en arguments d'appel", () => {
    // `Math.max(...arr)` est un `RangeError` au-delà de ~100 000 points.
    const huge = Array.from({ length: 200_000 }, (_, i) => i % 7);
    expect(() => render([server({ sparkline: huge })])).not.toThrow();
  });

  it("ne divise pas par zéro sur une série plate", () => {
    const html = render([server({ sparkline: [0, 0, 0] })]);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
});
