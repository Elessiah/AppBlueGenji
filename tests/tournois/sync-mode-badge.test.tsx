import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientPowerMode } from "@/lib/shared/client-power";
import type { RefreshTier } from "@/lib/shared/refresh-tiers";
import { MATCH_BACKGROUND_RENDER_DELAY_MS, QUIET_STREAM_AFTER_MS } from "@/lib/shared/client-power";
import {
  SYNC_MODES,
  syncModeOtherKey,
  syncModeTextKey,
  type SyncMode,
  type SyncModeInput,
} from "@/lib/shared/sync-mode";
import { messageAt } from "@/lib/shared/scoped-text";
import frTournament from "@/messages/fr/tournament.json";
import enTournament from "@/messages/en/tournament.json";
import { SpectatorViewProvider } from "@/components/spectator-view";
import { TournamentPageTextProvider } from "@/components/i18n/tournament-page-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import { FR_TOURNAMENT_PAGE_TEXT, tournamentPageMessages } from "@/lib/shared/tournament-page-text";
import { readSource } from "../helpers/read-source";
import {
  SYNC_MODE_VARIANT,
  SyncModeBadge,
  SyncModeExplanation,
  syncModeNowTextKey,
  syncModeOtherTextKey,
  type SyncModeState,
} from "@/app/(secured)/tournois/[id]/_components/SyncModeBadge";
import { cadenceLabel } from "@/app/(secured)/tournois/[id]/_components/LiveIndicator";

let mockMode: ClientPowerMode = "FULL";
jest.mock("@/lib/shared/hooks/useClientPower", () => ({
  useClientPower: () => ({ mode: mockMode }),
}));

const fr = frTournament.live.sync;

beforeEach(() => {
  mockMode = "FULL";
});

function state(mode: SyncMode, overrides: Partial<SyncModeInput> = {}): SyncModeState {
  return {
    mode,
    input: { tier: "STANDARD", power: "FULL", isLive: true, fatal: false, source: "STREAM", viewerMatch: false, ...overrides },
  };
}

const spectator = (node: ReactElement) => renderToStaticMarkup(<SpectatorViewProvider>{node}</SpectatorViewProvider>);

describe("SyncModeBadge", () => {
  it.each<[ClientPowerMode, RefreshTier, SyncMode]>([
    ["FULL", "PRIORITY", "PRIORITY"],
    ["FULL", "STANDARD", "STANDARD"],
    ["MATCH", "PRIORITY", "MATCH"],
    ["ECO", "STANDARD", "ECO"],
    ["SLEEP", "STANDARD", "SLEEP"],
  ])("régime %s, palier %s : « %s »", (power, tier, expected) => {
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

  it("page sans compte, lecture ratée : reste en standard, sans ambre", () => {
    const html = spectator(<SyncModeBadge isLive={false} tier="STANDARD" />);
    expect(html).toContain(fr.modes.STANDARD.label);
    expect(html).not.toContain("pill-warning");
  });

  it("page sans compte : jamais prioritaire", () => {
    expect(spectator(<SyncModeBadge isLive tier="PRIORITY" />)).toContain(fr.modes.STANDARD.label);
  });

  it("variantes : ni bleu (témoin voisin) ni gris, l'ambre seulement pour le mode secours", () => {
    for (const mode of SYNC_MODES) {
      const variant = SYNC_MODE_VARIANT[mode];
      expect(["blue", "neutral", "live", "default"]).not.toContain(variant);
      expect(variant === "warning").toBe(mode === "POLLING");
    }
  });

  it("le libellé ne passe jamais à la ligne dans la pastille", () => {
    const html = renderToStaticMarkup(<SyncModeBadge isLive tier="PRIORITY" />);
    expect(html).toContain("badge");
    expect(readSource("app/(secured)/tournois/[id]/_components/SyncModeBadge.module.css")).toMatch(/white-space: nowrap/);
  });

  it("jamais de rouge ni de zone live, relecture comprise", () => {
    const htmls = [
      renderToStaticMarkup(<SyncModeBadge isLive tier="PRIORITY" />),
      renderToStaticMarkup(<SyncModeBadge isLive={false} tier="PRIORITY" />),
      spectator(<SyncModeBadge isLive={false} tier="STANDARD" />),
    ];
    for (const html of htmls) {
      expect(html).not.toContain("pill-live");
      expect(html).not.toContain("aria-live");
    }
  });

  it("échec définitif : rien", () => {
    expect(renderToStaticMarkup(<SyncModeBadge isLive tier="STANDARD" fatal="UNAUTHORIZED" />)).toBe("");
  });

  it("en anglais sous /en", () => {
    const html = renderToStaticMarkup(
      <TournamentPageTextProvider locale="en" messages={tournamentPageMessages(messagesFor("en"))}>
        <SyncModeBadge isLive tier="PRIORITY" />
      </TournamentPageTextProvider>,
    );
    expect(html).toContain(enTournament.live.sync.modes.PRIORITY.label);
  });
});

describe("SyncModeExplanation", () => {
  it("prioritaire : la cadence du palier, et les cinq autres modes", () => {
    const html = renderToStaticMarkup(<SyncModeExplanation state={state("PRIORITY", { tier: "PRIORITY" })} />);
    expect(html).toContain("à la seconde");
    expect(html.match(/<li>/g)).toHaveLength(SYNC_MODES.length - 1);
    expect(html).not.toContain(`<strong>${fr.modes.PRIORITY.label}</strong>`);
  });

  it("standard : fenêtre de 20 secondes, et la cadence prioritaire dans la liste", () => {
    const html = renderToStaticMarkup(<SyncModeExplanation state={state("STANDARD")} />);
    expect(html).toContain("toutes les 20 secondes au plus");
    expect(html).toContain("reçoivent les changements à la seconde");
  });

  it("relecture : cadence de secours du palier, ou celle annoncée", () => {
    expect(
      renderToStaticMarkup(<SyncModeExplanation state={state("POLLING", { tier: "PRIORITY", isLive: false })} />),
    ).toContain("toutes les 15 secondes au plus");
    expect(
      renderToStaticMarkup(<SyncModeExplanation state={state("POLLING", { isLive: false })} cadenceMs={120_000} />),
    ).toContain("toutes les 2 minutes au plus");
  });

  it("éco d'un prioritaire : dit qu'il reste servi en premier, et ne le liste pas comme un autre mode", () => {
    const html = renderToStaticMarkup(<SyncModeExplanation state={state("ECO", { tier: "PRIORITY", power: "ECO" })} />);
    expect(html).toContain(fr.tierKept.PRIORITY);
    expect(html).not.toContain(`<strong>${fr.modes.PRIORITY.label}</strong>`);
    expect(html).toContain(`<strong>${fr.modes.STANDARD.label}</strong>`);
  });

  it("match dans ce tournoi : en cours ou imminent", () => {
    const html = renderToStaticMarkup(
      <SyncModeExplanation state={state("MATCH", { tier: "PRIORITY", power: "MATCH", viewerMatch: true })} />,
    );
    expect(html).toContain("en cours ou imminent");
    expect(html).not.toContain("autre onglet");
  });

  it("match tenu dans un autre onglet : le texte le dit", () => {
    const html = renderToStaticMarkup(<SyncModeExplanation state={state("MATCH", { power: "MATCH" })} />);
    expect(html).toContain("autre onglet");
  });

  it("SyncModeExplanation_matchElsewhereStream_mentionsDelayFromConstant", () => {
    const delay = cadenceLabel(FR_TOURNAMENT_PAGE_TEXT, MATCH_BACKGROUND_RENDER_DELAY_MS);

    const html = renderToStaticMarkup(<SyncModeExplanation state={state("MATCH", { power: "MATCH" })} />);

    expect(html).toContain(`la page regroupe les changements ${delay}, sauf ceux de ton match`);
  });

  it("SyncModeExplanation_matchElsewherePoll_noBatchingClaim", () => {
    const html = renderToStaticMarkup(
      <SyncModeExplanation state={state("MATCH", { power: "MATCH", source: "POLL" })} cadenceMs={60_000} />,
    );

    expect(html).toContain("autre onglet");
    expect(html).not.toContain("regroupe");
  });

  it("SyncModeExplanation_sleep_minutesFromQuietConstant", () => {
    const minutes = Math.round(QUIET_STREAM_AFTER_MS / 60_000);

    const html = renderToStaticMarkup(<SyncModeExplanation state={state("SLEEP", { power: "SLEEP" })} />);

    expect(html).toContain(`Au bout de ${minutes} minute`);
  });

  it("page sans compte en veille : la relecture s'arrête, rien n'est reçu", () => {
    const html = renderToStaticMarkup(<SyncModeExplanation state={state("SLEEP", { source: "POLL", power: "SLEEP" })} />);
    expect(html).toContain("la page cesse de relire le tournoi et reprend dès ton retour");
    expect(html).not.toContain("sont reçus");
    expect(html).not.toContain(fr.modes.PRIORITY.label);
    expect(html).not.toContain(fr.modes.POLLING.label);
  });

  it("page sans compte : la cadence de relecture, pas de flux", () => {
    const html = renderToStaticMarkup(
      <SyncModeExplanation state={state("STANDARD", { source: "POLL" })} cadenceMs={60_000} />,
    );
    expect(html).toContain("toutes les minutes au plus, sans que tu aies à la recharger");
  });
});

describe("câblage de l'en-tête et de la source", () => {
  const header = readSource("app/(secured)/tournois/[id]/_components/TournamentHeader.tsx");
  const live = readSource("app/(secured)/tournois/[id]/_hooks/useTournamentLive.ts");

  it("membre : pastille et « i » du mode reçoivent le match du lecteur ; sans compte : la pastille Spectateur", () => {
    expect(header).toMatch(/<SyncModeHint [^>]*viewerMatch=\{viewerMatch\}/);
    expect(header).toMatch(/<SyncModeBadge [^>]*viewerMatch=\{viewerMatch\}/);
    expect(header).toMatch(/spectator \? \(\s*<SpectatorHint/);
  });

  it("pastille Spectateur : la phrase du témoin seulement hors lecture réussie (pas deux fois la cadence)", () => {
    expect(header).toContain("{(sync === null || !props.isLive) && <p>{liveText.title}</p>}");
  });

  it("le flux passe par applyStreamMessage (palier gardé sous flux calmé, testé dans live-state.test.ts)", () => {
    expect(live).toContain("commit(applyStreamMessage(stateRef.current, message, quietStream.isQuiet()));");
    expect(live).toContain("viewerMatch: matchFocus,");
  });
});

describe("clés des textes du mode", () => {
  const combos: Array<[SyncMode, SyncModeInput["source"], boolean]> = [];
  for (const mode of SYNC_MODES)
    for (const source of ["STREAM", "POLL"] as const) for (const viewerMatch of [true, false]) combos.push([mode, source, viewerMatch]);

  it.each(combos)("syncModeNowTextKey_%s_%s_viewerMatch=%s_resolvesOwnVariantNoFallback", (mode, source, viewerMatch) => {
    const variant = syncModeTextKey(mode, { source, viewerMatch });

    const key = syncModeNowTextKey(mode, variant);

    expect(key).toBe(`live.sync.modes.${mode}.${variant}`);
    expect(messageAt(frTournament, key)).toEqual(expect.any(String));
    expect(messageAt(enTournament, key)).toEqual(expect.any(String));
  });

  it.each(combos)("syncModeOtherTextKey_%s_%s_resolvesOwnVariant", (mode, source) => {
    const variant = syncModeOtherKey(mode, source);

    const key = syncModeOtherTextKey(mode, variant);

    expect(key).toBe(`live.sync.modes.${mode}.${variant}`);
    expect(messageAt(enTournament, key)).toEqual(expect.any(String));
  });

  it("syncModeNowTextKey_missingVariant_fallsBackToNow", () => {
    expect(syncModeNowTextKey("PRIORITY", "nowPoll")).toBe("live.sync.modes.PRIORITY.now");
  });
});
