import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { BotCrumb } from "@/components/bot/BotCrumb";
import { BotHero } from "@/components/bot/BotHero";
import { BotKpis } from "@/components/bot/BotKpis";
import { BotStatusStrip } from "@/components/bot/BotStatusStrip";
import { botStatusDisplay, isBotOnline } from "@/lib/shared/bot-status-summary";
import type { BotStatus } from "@/lib/shared/types";
import { readSource } from "../helpers/read-source";

/**
 * Audit UI de `/bot` : pastilles « en ligne » vertes en dur, libellés en
 * anglais, et carte d'invitation qui débordait à 320 px.
 */
const css = readSource("app/bot/bot.css");

function payload(status: string): BotStatus {
  return { status } as unknown as BotStatus;
}

describe("isBotOnline", () => {
  it("n'allume la pastille que sur un bot opérationnel", () => {
    expect(isBotOnline("OPERATIONAL")).toBe(true);
    for (const value of ["DEGRADED", "DOWN", "MAINTENANCE", "", null, undefined]) {
      expect(isBotOnline(value)).toBe(false);
    }
  });
});

describe("botStatusDisplay — états connus en français", () => {
  it.each<[string, string]>([
    ["OPERATIONAL", "Opérationnel"],
    ["DEGRADED", "Dégradé"],
    ["DOWN", "Hors service"],
  ])("%s → %s", (raw, label) => {
    expect(botStatusDisplay(raw)).toBe(label);
  });

  it("ne traduit pas une clé héritée d'Object.prototype", () => {
    expect(botStatusDisplay("toString")).toBe("toString");
  });
});

describe("BotHero — pastille « en ligne » branchée sur l'état", () => {
  it("allumée sur un bot opérationnel", () => {
    expect(renderToStaticMarkup(<BotHero status={payload("OPERATIONAL")} />)).toContain(
      'class="bot-avatar online"',
    );
  });

  it.each<[string, BotStatus | null]>([
    ["injoignable", null],
    ["dégradé", payload("DEGRADED")],
    ["hors service", payload("DOWN")],
    ["état illisible", payload("MAINTENANCE")],
  ])("éteinte quand le bot est %s", (_name, status) => {
    const html = renderToStaticMarkup(<BotHero status={status} />);
    expect(html).toContain('class="bot-avatar"');
    expect(html).not.toContain("bot-avatar online");
  });

  it("la pastille n'est dessinée que sous `.online`", () => {
    expect(css).toMatch(/\.bot-avatar\.online::after\s*\{/);
    expect(css).not.toMatch(/\.bot-avatar::after/);
  });
});

describe("BotCrumb — plus de pastille verte en dur", () => {
  it("ne rend plus de point d'état", () => {
    expect(renderToStaticMarkup(<BotCrumb />)).not.toContain('class="dot"');
    expect(css).not.toContain(".endpoint .dot");
  });
});

describe("/bot — libellés en français", () => {
  it("bande d'état", () => {
    const html = renderToStaticMarkup(<BotStatusStrip status={payload("OPERATIONAL")} />);
    for (const label of ["État", "En service", "Latence passerelle", "Fragments (shards)", "Opérationnel"]) {
      expect(html).toContain(label);
    }
    for (const english of [">Status<", ">Uptime<", "Gateway latency", ">Shards<", ">OPERATIONAL<"]) {
      expect(html).not.toContain(english);
    }
  });

  it("indicateurs", () => {
    const html = renderToStaticMarkup(<BotKpis kpis={null} />);
    expect(html).toContain("Salons relayés");
    expect(html).not.toContain("Channels");
  });
});

describe("carte d'invitation — tient à 320 px", () => {
  it("pistes de grille à minimum nul", () => {
    expect(css).toMatch(/\.invite-inner \{[^}]*grid-template-columns: minmax\(0, 1\.2fr\) minmax\(0, 1fr\)/);
    expect(css).toContain(".invite-inner { grid-template-columns: minmax(0, 1fr); gap: 32px; }");
    expect(css).toMatch(/\.perm \{[^}]*grid-template-columns: 18px minmax\(0, 1fr\) minmax\(0, auto\)/);
  });

  it("les mots longs se coupent", () => {
    expect(css).toContain(".invite-copy h3, .invite-copy p { overflow-wrap: anywhere; }");
    expect(css).toContain(".perm .lbl, .perm .scope { overflow-wrap: anywhere; }");
  });
});
