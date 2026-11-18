import { describe, expect, it } from "@jest/globals";
import type { ClientPowerMode } from "@/lib/shared/client-power";
import type { RefreshTier } from "@/lib/shared/refresh-tiers";
import {
  otherSyncModes,
  POLL_SYNC_MODES,
  resolveSyncMode,
  SYNC_MODES,
  syncModeBatchNote,
  syncModeOtherKey,
  syncModeTextKey,
  syncModeTierNote,
  type SyncModeInput,
} from "@/lib/shared/sync-mode";
import frTournament from "@/messages/fr/tournament.json";
import enTournament from "@/messages/en/tournament.json";
import { messageAt } from "@/lib/shared/scoped-text";

function input(overrides: Partial<SyncModeInput> = {}): SyncModeInput {
  return { tier: "STANDARD", power: "FULL", isLive: true, fatal: false, source: "STREAM", viewerMatch: false, ...overrides };
}

describe("resolveSyncMode", () => {
  it("échec définitif : aucun mode, quels que soient flux et régime", () => {
    expect(resolveSyncMode(input({ fatal: true, power: "MATCH", tier: "PRIORITY" }))).toBeNull();
    expect(resolveSyncMode(input({ fatal: true, isLive: false }))).toBeNull();
    expect(resolveSyncMode(input({ fatal: true, source: "POLL" }))).toBeNull();
  });

  it.each<[RefreshTier, ClientPowerMode]>([
    ["PRIORITY", "FULL"],
    ["STANDARD", "MATCH"],
    ["PRIORITY", "SLEEP"],
    ["STANDARD", "ECO"],
  ])("flux non établi (%s, %s) : relecture", (tier, power) => {
    expect(resolveSyncMode(input({ isLive: false, tier, power }))).toBe("POLLING");
  });

  it("page sans compte, lecture ratée : le mode ne change pas (pas de flux à annoncer coupé)", () => {
    expect(resolveSyncMode(input({ source: "POLL", isLive: false }))).toBe("STANDARD");
    expect(resolveSyncMode(input({ source: "POLL", isLive: false, power: "SLEEP" }))).toBe("SLEEP");
  });

  it("page sans compte : jamais prioritaire", () => {
    expect(resolveSyncMode(input({ source: "POLL", tier: "PRIORITY" }))).toBe("STANDARD");
  });

  it("onglet caché : veille, même prioritaire", () => {
    expect(resolveSyncMode(input({ power: "SLEEP", tier: "PRIORITY" }))).toBe("SLEEP");
  });

  it("rencontre en cours : match, même prioritaire", () => {
    expect(resolveSyncMode(input({ power: "MATCH", tier: "PRIORITY", viewerMatch: true }))).toBe("MATCH");
  });

  it("page sans animation : éco, pour les deux paliers", () => {
    expect(resolveSyncMode(input({ power: "ECO", tier: "PRIORITY" }))).toBe("ECO");
    expect(resolveSyncMode(input({ power: "ECO", tier: "STANDARD" }))).toBe("ECO");
  });

  it("régime complet : le palier décide", () => {
    expect(resolveSyncMode(input({ tier: "PRIORITY" }))).toBe("PRIORITY");
    expect(resolveSyncMode(input({ tier: "STANDARD" }))).toBe("STANDARD");
  });
});

describe("syncModeTextKey", () => {
  it("match tenu dans un autre onglet : le texte le dit", () => {
    expect(syncModeTextKey("MATCH", { source: "STREAM", viewerMatch: false })).toBe("nowElsewhere");
    expect(syncModeTextKey("MATCH", { source: "POLL", viewerMatch: false })).toBe("nowElsewhere");
  });

  it("match du lecteur dans ce tournoi : texte nominal", () => {
    expect(syncModeTextKey("MATCH", { source: "STREAM", viewerMatch: true })).toBe("now");
  });

  it("page sans compte : standard et veille parlent de relecture, pas de flux", () => {
    expect(syncModeTextKey("STANDARD", { source: "POLL", viewerMatch: false })).toBe("nowPoll");
    expect(syncModeTextKey("SLEEP", { source: "POLL", viewerMatch: false })).toBe("nowPoll");
    expect(syncModeTextKey("ECO", { source: "POLL", viewerMatch: false })).toBe("now");
  });

  it("page avec compte : texte nominal", () => {
    expect(syncModeTextKey("SLEEP", { source: "STREAM", viewerMatch: false })).toBe("now");
    expect(syncModeTextKey("STANDARD", { source: "STREAM", viewerMatch: false })).toBe("now");
  });
});

describe("syncModeBatchNote", () => {
  it("syncModeBatchNote_matchOnStream_true", () => {
    expect(syncModeBatchNote("MATCH", "STREAM")).toBe(true);
  });

  it("syncModeBatchNote_matchOnPollPage_false", () => {
    expect(syncModeBatchNote("MATCH", "POLL")).toBe(false);
  });

  it("syncModeBatchNote_otherModeOnStream_false", () => {
    expect(syncModeBatchNote("ECO", "STREAM")).toBe(false);
  });
});

describe("syncModeOtherKey", () => {
  it("page sans compte : standard et veille dans leur variante de relecture", () => {
    expect(syncModeOtherKey("STANDARD", "POLL")).toBe("otherPoll");
    expect(syncModeOtherKey("SLEEP", "POLL")).toBe("otherPoll");
    expect(syncModeOtherKey("ECO", "POLL")).toBe("other");
  });

  it("page avec compte : variante nominale", () => {
    expect(syncModeOtherKey("SLEEP", "STREAM")).toBe("other");
  });
});

describe("syncModeTierNote", () => {
  it("match et éco gardent le palier, qui se dit", () => {
    expect(syncModeTierNote("ECO", { source: "STREAM", tier: "PRIORITY" })).toBe("PRIORITY");
    expect(syncModeTierNote("MATCH", { source: "STREAM", tier: "STANDARD" })).toBe("STANDARD");
  });

  it("veille, relecture et paliers : rien à ajouter", () => {
    expect(syncModeTierNote("SLEEP", { source: "STREAM", tier: "PRIORITY" })).toBeNull();
    expect(syncModeTierNote("POLLING", { source: "STREAM", tier: "PRIORITY" })).toBeNull();
    expect(syncModeTierNote("PRIORITY", { source: "STREAM", tier: "PRIORITY" })).toBeNull();
  });

  it("page sans compte : aucun palier à rappeler", () => {
    expect(syncModeTierNote("ECO", { source: "POLL", tier: "STANDARD" })).toBeNull();
  });
});

describe("otherSyncModes", () => {
  it("régime complet prioritaire : les cinq autres, dans l'ordre", () => {
    expect(otherSyncModes("PRIORITY", { source: "STREAM", tier: "PRIORITY" })).toEqual([
      "STANDARD",
      "MATCH",
      "ECO",
      "SLEEP",
      "POLLING",
    ]);
  });

  it("éco d'un prioritaire : ni éco ni prioritaire (palier conservé, déjà dit)", () => {
    expect(otherSyncModes("ECO", { source: "STREAM", tier: "PRIORITY" })).toEqual(["STANDARD", "MATCH", "SLEEP", "POLLING"]);
  });

  it("page sans compte : seulement ses propres modes", () => {
    expect(otherSyncModes("STANDARD", { source: "POLL", tier: "STANDARD" })).toEqual(["ECO", "SLEEP"]);
    expect(otherSyncModes("MATCH", { source: "POLL", tier: "STANDARD" })).toEqual(["STANDARD", "ECO", "SLEEP"]);
  });
});

describe("textes atteignables", () => {
  /** Toute clé qu'un des helpers peut demander, pour chaque page. */
  const keys: string[] = [];
  for (const source of ["STREAM", "POLL"] as const) {
    for (const mode of SYNC_MODES) {
      keys.push(`live.sync.modes.${mode}.label`);
      for (const viewerMatch of [true, false]) keys.push(`live.sync.modes.${mode}.${syncModeTextKey(mode, { source, viewerMatch })}`);
      keys.push(`live.sync.modes.${mode}.${syncModeOtherKey(mode, source)}`);
    }
  }
  keys.push("live.sync.tierKept.PRIORITY", "live.sync.tierKept.STANDARD");

  it.each(keys.map((key) => [key]))("%s existe en français et en anglais", (key) => {
    expect(messageAt(frTournament, key)).toEqual(expect.any(String));
    expect(messageAt(enTournament, key)).toEqual(expect.any(String));
  });

  it("la page sans compte n'énumère que des modes qu'elle peut prendre", () => {
    expect(POLL_SYNC_MODES).not.toContain("PRIORITY");
    expect(POLL_SYNC_MODES).not.toContain("POLLING");
  });
});
