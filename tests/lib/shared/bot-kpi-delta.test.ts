import { describe, expect, it } from "@jest/globals";
import {
  botKpiDeltaAccessibleLabel,
  resolveBotKpiDelta,
} from "@/lib/shared/bot-kpi-delta";

/**
 * La pastille de variation d'une tuile de `/bot`.
 *
 * Elle était écrite en dur (`kpi-delta up`, `▲`) : une baisse annoncée `-8 %`
 * sortait en vert, flèche vers le haut. Ce que ces cas gardent, c'est que le
 * ton ne s'invente jamais — il se lit sur un signe, ou il n'y en a pas.
 */
describe("resolveBotKpiDelta — le ton se lit sur le signe", () => {
  it("colore une hausse signée", () => {
    expect(resolveBotKpiDelta("+12 %")).toEqual({
      label: "+12 %",
      tone: "up",
      glyph: "▲",
    });
  });

  it("colore une baisse, et ne la fait pas passer pour une hausse", () => {
    const delta = resolveBotKpiDelta("-8 %");
    expect(delta.tone).toBe("down");
    expect(delta.glyph).toBe("▼");
    expect(delta.label).toBe("-8 %");
  });

  it("reconnaît le signe moins Unicode des formateurs de nombres", () => {
    // `Intl.NumberFormat("fr-FR").format(-8)` rend « −8 » (U+2212) et non
    // « -8 » : confondre les deux ferait passer la moitié des baisses pour
    // des hausses, selon la façon dont le bot a formaté sa chaîne.
    expect(resolveBotKpiDelta("−8 %").tone).toBe("down");
    expect(resolveBotKpiDelta("−8 %").glyph).toBe("▼");
  });

  it("n'affirme rien d'une variation sans signe", () => {
    // C'est la supposition qui fabriquait le défaut : un « 12 % » rendu
    // « ▲ 12 % » en vert alors que le bot n'a pas dit dans quel sens.
    const delta = resolveBotKpiDelta("12 %");
    expect(delta.tone).toBe("flat");
    expect(delta.glyph).toBe("");
    expect(delta.label).toBe("12 %");
  });

  it("lit un nombre négatif comme une baisse", () => {
    // `BotKpiEntry.delta` est typé `string`, mais la charge n'est pas validée
    // à l'exécution (`as BotKpis` sur du JSON reçu).
    expect(resolveBotKpiDelta(-8).tone).toBe("down");
    expect(resolveBotKpiDelta(4).tone).toBe("flat");
  });

  it("met un tiret neutre sur tout ce qui n'est pas lisible", () => {
    for (const value of [null, undefined, "", "   ", {}, [], Number.NaN]) {
      const delta = resolveBotKpiDelta(value);
      expect(delta).toEqual({ label: "—", tone: "flat", glyph: "" });
    }
  });

  it("ne rend jamais autre chose qu'un des trois tons", () => {
    for (const value of ["+1", "-1", "0", "stable", 7, null]) {
      expect(["up", "down", "flat"]).toContain(resolveBotKpiDelta(value).tone);
    }
  });

  it("taille les espaces avant de lire le signe", () => {
    expect(resolveBotKpiDelta("  -3 ").tone).toBe("down");
    expect(resolveBotKpiDelta("  -3 ").label).toBe("-3");
  });
});

describe("botKpiDeltaAccessibleLabel — la flèche est un dessin", () => {
  it("dit le texte visible d'abord, puis le sens (WCAG 2.5.3)", () => {
    const up = botKpiDeltaAccessibleLabel(resolveBotKpiDelta("+12 %"), "Serveurs");
    expect(up).toContain("+12 %");
    expect(up).toContain("en hausse");

    const down = botKpiDeltaAccessibleLabel(resolveBotKpiDelta("-8 %"), "Serveurs");
    expect(down).toContain("en baisse");
    expect(down).not.toContain("en hausse");
  });

  it("n'ajoute aucun sens à une pastille neutre", () => {
    const flat = botKpiDeltaAccessibleLabel(resolveBotKpiDelta("12 %"), "Serveurs");
    expect(flat).toContain("12 %");
    expect(flat).not.toContain("hausse");
    expect(flat).not.toContain("baisse");
  });
});
