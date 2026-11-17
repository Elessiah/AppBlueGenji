import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { AUDIENCE_SUSPEND_GAP_MS, type AudienceBeaconEntry } from "@/lib/shared/audience";
import { AudienceTracker } from "@/lib/shared/audience-tracker";

/**
 * Suivi des pages vues dans le navigateur (`<AudienceBeacon />`, registre T19) :
 * la page vue part à son affichage (`t: 0`), son temps à sa clôture (`c: 1`).
 */

let clock = 0;
let visible = true;
let send: jest.Mock<(entries: AudienceBeaconEntry[]) => void>;

function tracker(referrer: string | null = "discord.com") {
  return new AudienceTracker({
    now: () => clock,
    isVisible: () => visible,
    device: () => "mobile",
    referrerHost: () => referrer,
    send,
  });
}

/** Avance l'horloge de `ms`, avec le tic d'une minute de `<AudienceBeacon />`. */
function readFor(t: AudienceTracker, ms: number) {
  const end = clock + ms;
  while (clock + 60_000 <= end) {
    clock += 60_000;
    t.tick();
  }
  clock = end;
}

beforeEach(() => {
  clock = 0;
  visible = true;
  send = jest.fn<(entries: AudienceBeaconEntry[]) => void>();
});

describe("AudienceTracker", () => {
  it("navigate_reportsOrAdminPath_sendsNothing", () => {
    const t = tracker();
    t.navigate("/signalements/42");
    clock = 120_000;
    t.navigate("/en/admin/utilisateurs");
    clock = 240_000;
    t.leave();

    expect(send).not.toHaveBeenCalled();
  });

  it("navigate_firstPage_sendsViewAtDisplayWithReferrer", () => {
    const t = tracker();
    t.navigate("/");
    clock = 5000;
    t.navigate("/classement");
    clock = 7000;
    t.leave();

    expect(send.mock.calls[0][0]).toEqual([
      { p: "/", t: 0, a: 7000, d: "mobile", f: 1, r: "discord.com" },
      { p: "/", t: 5000, a: 2000, d: "mobile", c: 1, o: 7000 },
      { p: "/classement", t: 0, a: 2000, d: "mobile" },
      { p: "/classement", t: 2000, a: 0, d: "mobile", c: 1, o: 2000 },
    ]);
  });

  it("leave_afterReading_sendsTimeAsContinuationDatedAtClose", () => {
    const t = tracker();
    t.navigate("/regles");
    clock = 90_000;
    t.hidden();

    expect(send.mock.calls[0][0][1]).toEqual({ p: "/regles", t: 90_000, a: 0, d: "mobile", c: 1, o: 90_000 });
  });

  it("finish_zeroVisibleTime_sendsNoTimeEntry", () => {
    const t = tracker();
    t.navigate("/");
    t.leave();

    expect(send.mock.calls[0][0]).toEqual([{ p: "/", t: 0, a: 0, d: "mobile", f: 1, r: "discord.com" }]);
  });

  it("navigate_samePage_ignored", () => {
    const t = tracker();
    t.navigate("/");
    t.navigate("/");
    t.leave();

    expect(send.mock.calls[0][0]).toHaveLength(1);
  });

  it("navigate_backgroundOpenedPage_viewSentAtFirstVisible", () => {
    visible = false;
    const t = tracker(null);
    t.navigate("/regles");
    clock = 10_000;
    t.visible();
    clock = 13_000;
    t.leave();

    expect(send.mock.calls[0][0]).toEqual([
      { p: "/regles", t: 0, a: 3000, d: "mobile", f: 1, r: null },
      { p: "/regles", t: 3000, a: 0, d: "mobile", c: 1, o: 3000 },
    ]);
  });

  it("visible_sameCountedPage_sendsOnlyContinuation", () => {
    const t = tracker();
    t.navigate("/equipes");
    clock = 4000;
    t.hidden();
    clock = 60_000;
    t.visible();
    clock = 61_000;
    t.leave();

    // La suite garde l'ouverture de la page (instant 0) : elle se range à son jour.
    expect(send.mock.calls[1][0]).toEqual([{ p: "/equipes", t: 1000, a: 0, d: "mobile", c: 1, o: 61_000 }]);
  });

  it("navigate_frequentationPage_sendsNothing", () => {
    const t = tracker();
    t.navigate("/frequentation");
    clock = 1000;
    t.leave();

    expect(send).not.toHaveBeenCalled();
  });

  it("tick_queueUnderTen_sendsOnTick", () => {
    const t = tracker();
    t.navigate("/");

    expect(t.pendingCount).toBe(1);
    expect(send).not.toHaveBeenCalled();

    t.tick();

    expect(send).toHaveBeenCalledTimes(1);
    expect(t.pendingCount).toBe(0);
  });

  it("enqueue_tenthEntry_sendsAtOnce", () => {
    const t = tracker();
    for (const path of ["/", "/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h", "/i"]) t.navigate(path);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toHaveLength(10);
  });
});

describe("AudienceTracker — tranches d'une longue lecture", () => {
  it("tick_visibleReadingPastCheckpoint_sendsChunkAndKeepsReading", () => {
    const t = tracker();
    t.navigate("/regles");
    readFor(t, 600_000);
    send.mockClear();
    readFor(t, 60_000);
    t.leave();

    expect(send.mock.calls.flatMap(([entries]) => entries)).toEqual([{ p: "/regles", t: 60_000, a: 0, d: "mobile", c: 1, o: 660_000 }]);
  });

  it("tick_tenMinutesRead_chunkSentWithItsTime", () => {
    const t = tracker();
    t.navigate("/regles");
    readFor(t, 600_000);

    expect(send.mock.calls.flatMap(([entries]) => entries).filter((entry) => entry.c === 1)).toEqual([
      { p: "/regles", t: 600_000, a: 0, d: "mobile", c: 1, o: 600_000 },
    ]);
  });

  it("tick_readingUnderCheckpoint_sendsNoChunk", () => {
    const t = tracker();
    t.navigate("/regles");
    clock = 540_000;
    t.tick();

    expect(send.mock.calls[0][0]).toEqual([{ p: "/regles", t: 0, a: 540_000, d: "mobile", f: 1, r: "discord.com" }]);
  });
});

describe("AudienceTracker — retour après une pause", () => {
  // 2026-11-16 10:00 à Paris (09:00 UTC).
  const MORNING = Date.parse("2026-11-16T09:00:00Z");

  it("visible_shortPauseSameDay_sendsContinuationOnly", () => {
    clock = MORNING;
    const t = tracker();
    t.navigate("/equipes");
    clock += 4000;
    t.hidden();
    send.mockClear();
    clock += 30 * 60_000 - 1;
    t.visible();
    clock += 1000;
    t.leave();

    expect(send.mock.calls[0][0]).toEqual([{ p: "/equipes", t: 1000, a: 0, d: "mobile", c: 1, o: 1_804_999 }]);
  });

  it("visible_pauseOfThirtyMinutes_sendsNewView", () => {
    clock = MORNING;
    const t = tracker();
    t.navigate("/equipes");
    clock += 4000;
    t.hidden();
    send.mockClear();
    clock += 30 * 60_000;
    t.visible();
    t.tick();

    expect(send.mock.calls[0][0]).toEqual([{ p: "/equipes", t: 0, a: 0, d: "mobile" }]);
  });

  it("visible_afterParisMidnight_sendsNewView", () => {
    // 23:55 à Paris, retour à 00:05.
    clock = Date.parse("2026-11-16T22:55:00Z");
    const t = tracker();
    t.navigate("/equipes");
    clock += 60_000;
    t.hidden();
    send.mockClear();
    clock += 9 * 60_000;
    t.visible();
    t.tick();

    expect(send.mock.calls[0][0]).toEqual([{ p: "/equipes", t: 0, a: 0, d: "mobile" }]);
  });
});

describe("AudienceTracker — veille onglet visible", () => {
  it("tick_afterSuspendGap_closesReadingAtLastTickAndResumesAsNewView", () => {
    clock = Date.parse("2026-11-16T09:00:00Z");
    const t = tracker();
    t.navigate("/regles");
    readFor(t, 120_000);
    send.mockClear();
    clock += 2 * 60 * 60_000;
    t.tick();

    expect(send.mock.calls[0][0]).toEqual([
      { p: "/regles", t: 120_000, a: 7_200_000, d: "mobile", c: 1, o: 7_320_000 },
      { p: "/regles", t: 0, a: 0, d: "mobile" },
    ]);
  });

  it("tick_exactlySuspendGap_keepsReading", () => {
    const t = tracker();
    t.navigate("/regles");
    clock = AUDIENCE_SUSPEND_GAP_MS;
    t.tick();

    // Seule la page vue part : ni tranche close, ni nouvelle page vue.
    expect(send.mock.calls[0][0]).toEqual([{ p: "/regles", t: 0, a: AUDIENCE_SUSPEND_GAP_MS, d: "mobile", f: 1, r: "discord.com" }]);
  });

  it("hidden_afterSilentSuspend_timeStopsAtLastTick", () => {
    const t = tracker();
    t.navigate("/regles");
    readFor(t, 60_000);
    send.mockClear();
    clock = 3 * 60 * 60_000;
    t.hidden();

    expect(send.mock.calls[0][0]).toEqual([{ p: "/regles", t: 60_000, a: 10_740_000, d: "mobile", c: 1, o: 10_800_000 }]);
  });
});
