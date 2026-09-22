import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { BotStatusStrip } from "@/components/bot/BotStatusStrip";
import { BotLatencyCard } from "@/components/bot/BotLatencyCard";
import type { BotStatus } from "@/lib/shared/types";

/**
 * La bande d'état de `/bot`, **rendue** plutôt que relue.
 *
 * `fetchBotStatus` rend la charge du bot par un simple `as BotStatus` sur du
 * JSON reçu par le réseau : les cas « le bot a répondu autre chose » ne sont
 * donc pas théoriques, d'où les `as unknown as` ci-dessous, qui reproduisent
 * exactement ce que ce `as` laisse passer. Et comme la bande est rendue depuis
 * un composant serveur, un champ manquant n'y fait pas une case vide : il lève
 * pendant le rendu et sert **toute la page** en 500.
 */
function status(overrides: Partial<BotStatus> = {}): BotStatus {
  return {
    startupTs: 1_700_000_000_000,
    uptimeMs: 86_400_000,
    version: "2.4.1",
    buildHash: "4f8a9c21",
    buildDate: "2026-09-20",
    gatewayLatency: 42,
    shardCount: { active: 2, total: 2 },
    cpuUsage: 12,
    ramUsage: 340,
    status: "OPERATIONAL",
    ...overrides,
  };
}

describe("BotStatusStrip — les deux silences", () => {
  it("dit « n'a pas répondu » quand il n'y a pas eu de réponse", () => {
    const html = renderToStaticMarkup(<BotStatusStrip status={null} />);
    expect(html).toContain("n&#x27;a pas répondu");
    expect(html).not.toContain("ne sait pas lire");
  });

  it("dit « illisible », jamais « n'a pas répondu », sur une réponse sans état", () => {
    // Le cas qui motive la distinction : les quatre cases voisines affichent
    // des valeurs tirées de cette réponse, « le bot n'a pas répondu » les
    // contredirait — la phrase fixe que cette page vient justement de chasser.
    const { status: _dropped, ...withoutStatus } = status();
    const html = renderToStaticMarkup(
      <BotStatusStrip status={withoutStatus as unknown as BotStatus} />,
    );
    expect(html).toContain("ne sait pas lire");
    expect(html).not.toContain("n&#x27;a pas répondu");
    // …et les valeurs voisines sont bien là, c'est tout l'argument.
    expect(html).toContain("2.4.1");
    expect(html).toContain("42 ms");
  });

  it("montre l'état inconnu tel quel, sous la phrase qui le dit illisible", () => {
    const html = renderToStaticMarkup(
      <BotStatusStrip status={status({ status: "MAINTENANCE" as BotStatus["status"] })} />,
    );
    expect(html).toContain("MAINTENANCE");
    expect(html).toContain("ne sait pas lire");
  });

  it("n'accorde la classe « online » qu'à l'état opérationnel", () => {
    expect(renderToStaticMarkup(<BotStatusStrip status={status()} />)).toContain(
      "status-cell online",
    );
    for (const value of ["DEGRADED", "DOWN", "MAINTENANCE"]) {
      const html = renderToStaticMarkup(
        <BotStatusStrip status={status({ status: value as BotStatus["status"] })} />,
      );
      expect(html).not.toContain("status-cell online");
    }
  });
});

describe("BotStatusStrip — une charge amputée ne fait pas tomber la page", () => {
  // Chacun de ces champs était déréférencé sans contrôle : `.slice(0, 4)` sur
  // `buildHash`, `.active` sur `shardCount`. Un seul absent rendait `/bot` en
  // 500 — bien pire que la case fade qu'on met à la place.
  const truncated: Array<[string, unknown]> = [
    ["charge vide", {}],
    ["sans buildHash", { ...status(), buildHash: undefined }],
    ["sans shardCount", { ...status(), shardCount: undefined }],
    ["shardCount amputé", { ...status(), shardCount: { active: 1 } }],
    ["champs de mauvais type", { ...status(), version: 7, gatewayLatency: "vite" }],
    ["horodatages absents", { ...status(), startupTs: undefined, uptimeMs: undefined }],
  ];

  for (const [name, payload] of truncated) {
    it(`rend sans lever — ${name}`, () => {
      const html = renderToStaticMarkup(
        <BotStatusStrip status={payload as unknown as BotStatus} />,
      );
      expect(html).toContain("Gateway latency");
      // Une case sans valeur porte un tiret, jamais « NaN » ni « undefined ».
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("undefined");
    });
  }

  it("écarte une mesure chiffrée arrivée en texte, comme la carte d'à côté", () => {
    // `botPayloadText` laissait filer n'importe quelle chaîne : la bande
    // affichait « vite ms » pendant que `BotLatencyCard`, sur la même charge
    // et le même champ, tirait un tiret. Deux gardes pour une donnée.
    const html = renderToStaticMarkup(
      <BotStatusStrip
        status={
          {
            ...status(),
            gatewayLatency: "vite",
            shardCount: { active: "abc", total: "xyz" },
          } as unknown as BotStatus
        }
      />,
    );
    expect(html).not.toContain("vite");
    expect(html).not.toContain("abc");
    expect(html).not.toContain("xyz");
  });

  it("garde la version quand seule l'empreinte de build manque", () => {
    const html = renderToStaticMarkup(
      <BotStatusStrip status={{ ...status(), buildHash: undefined } as unknown as BotStatus} />,
    );
    expect(html).toContain("2.4.1");
  });
});

describe("BotLatencyCard — la même charge, la même garde", () => {
  it("rend sans lever sur des mesures de mauvais type", () => {
    // La carte reçoit le **même** objet que la bande : le durcir d'un côté
    // seulement laisserait la page tomber en 500 par l'autre, et l'invariant
    // annoncé plus haut serait faux.
    const broken = {
      ...status(),
      cpuUsage: "12%",
      ramUsage: null,
      gatewayLatency: Number.NaN,
    } as unknown as BotStatus;
    const html = renderToStaticMarkup(<BotLatencyCard status={broken} />);
    expect(html).toContain("CPU");
    expect(html).not.toContain("NaN");
  });

  it("borne les barres des deux côtés", () => {
    // Une largeur négative est une déclaration invalide : le navigateur la
    // laisse tomber, et la barre garde celle du rendu précédent.
    const html = renderToStaticMarkup(
      <BotLatencyCard
        status={{ ...status(), cpuUsage: -40, ramUsage: 999_999 } as unknown as BotStatus}
      />,
    );
    const widths = [...html.matchAll(/width:(-?[\d.]+)%/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(3);
    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(0);
      expect(width).toBeLessThanOrEqual(100);
    }
  });
});
