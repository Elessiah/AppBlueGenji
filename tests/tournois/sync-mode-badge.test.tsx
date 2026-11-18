import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientPowerMode } from "@/lib/shared/client-power";
import { SYNC_MODES } from "@/lib/shared/sync-mode";
import frTournament from "@/messages/fr/tournament.json";
import enTournament from "@/messages/en/tournament.json";
import { SyncModeBadge, SyncModeExplanation } from "@/app/(secured)/tournois/[id]/_components/SyncModeBadge";

let mockMode: ClientPowerMode = "FULL";
jest.mock("@/lib/shared/hooks/useClientPower", () => ({
  useClientPower: () => ({ mode: mockMode }),
}));

const fr = frTournament.live.sync;
const en = enTournament.live.sync;

beforeEach(() => {
  mockMode = "FULL";
});

describe("SyncModeBadge", () => {
  it.each([
    ["FULL", "PRIORITY", "PRIORITY"],
    ["FULL", "STANDARD", "STANDARD"],
    ["MATCH", "PRIORITY", "MATCH"],
    ["ECO", "STANDARD", "ECO"],
    ["SLEEP", "STANDARD", "SLEEP"],
  ] as const)("régime %s, palier %s : « %s »", (power, tier, expected) => {
    mockMode = power;
    const html = renderToStaticMarkup(<SyncModeBadge isLive tier={tier} />);
    expect(html).toContain(fr.modes[expected].label);
    expect(html).toContain(`data-sync-mode="${expected.toLowerCase()}"`);
  });

  it("flux non établi : relecture, en ambre", () => {
    const html = renderToStaticMarkup(<SyncModeBadge isLive={false} tier="STANDARD" />);
    expect(html).toContain(fr.modes.POLLING.label);
    expect(html).toContain("pill-warning");
  });

  it("jamais de rouge ni de zone live : le texte porte le sens", () => {
    for (const power of ["FULL", "MATCH", "ECO", "SLEEP"] as const) {
      mockMode = power;
      const html = renderToStaticMarkup(<SyncModeBadge isLive tier="PRIORITY" />);
      expect(html).not.toContain("pill-live");
      expect(html).not.toContain("aria-live");
    }
  });

  it("échec définitif : rien", () => {
    expect(renderToStaticMarkup(<SyncModeBadge isLive tier="STANDARD" fatal="UNAUTHORIZED" />)).toBe("");
  });
});

describe("SyncModeExplanation", () => {
  it("dit le mode courant avec la cadence du palier et liste les cinq autres", () => {
    const html = renderToStaticMarkup(<SyncModeExplanation isLive tier="PRIORITY" />);
    expect(html).toContain("à la seconde");
    expect(html.match(/<li>/g)).toHaveLength(SYNC_MODES.length - 1);
    expect(html).not.toContain(`<strong>${fr.modes.PRIORITY.label}</strong>`);
    expect(html).toContain(`<strong>${fr.modes.STANDARD.label}</strong>`);
  });

  it("palier standard : fenêtre de 20 secondes", () => {
    expect(renderToStaticMarkup(<SyncModeExplanation isLive tier="STANDARD" />)).toContain("toutes les 20 secondes au plus");
  });

  it("relecture : cadence de secours du palier, ou celle annoncée", () => {
    expect(renderToStaticMarkup(<SyncModeExplanation isLive={false} tier="PRIORITY" />)).toContain("toutes les 15 secondes au plus");
    expect(renderToStaticMarkup(<SyncModeExplanation isLive={false} tier="STANDARD" cadenceMs={120_000} />)).toContain("toutes les 2 minutes au plus");
  });

  it("échec définitif : rien", () => {
    expect(renderToStaticMarkup(<SyncModeExplanation isLive tier="STANDARD" fatal="TOURNAMENT_NOT_FOUND" />)).toBe("");
  });
});

describe("textes du mode de synchronisation", () => {
  it("français et anglais portent les mêmes clés, toutes renseignées", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    expect(Object.keys(en.modes).sort()).toEqual([...SYNC_MODES].sort());
    expect(Object.keys(fr.modes).sort()).toEqual([...SYNC_MODES].sort());
    for (const mode of SYNC_MODES) {
      for (const key of ["label", "now", "other"] as const) {
        expect(fr.modes[mode][key].length).toBeGreaterThan(0);
        expect(en.modes[mode][key].length).toBeGreaterThan(0);
      }
    }
    expect(fr.title).toBeTruthy();
    expect(en.title).toBeTruthy();
    expect(fr.others).toBeTruthy();
    expect(en.others).toBeTruthy();
  });

  it("le texte du mode courant porte l'espace {cadence} des deux côtés, sauf veille", () => {
    for (const mode of SYNC_MODES.filter((m) => m !== "SLEEP")) {
      expect(fr.modes[mode].now).toContain("{cadence}");
      expect(en.modes[mode].now).toContain("{cadence}");
    }
  });
});
